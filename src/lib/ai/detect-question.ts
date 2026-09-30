import "server-only";
import sharp from "sharp";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateStructured, imagePart, textPart } from "./client";
import { modelFor } from "./models";
import { DETECT_CONTINUATION_SYSTEM, DETECT_QUESTION_SYSTEM } from "./prompts";

export const BBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.01).max(1),
  height: z.number().min(0.01).max(1),
});

/**
 * Gemini vision models are trained on box_2d = [ymin, xmin, ymax, xmax] on a
 * 0..1000 scale and drift to it even when asked for 0..1 x/y/width/height, so
 * that is the format we request. A plain 0..1 `bbox` is still accepted.
 */
const Box2d = z.array(z.number().min(0).max(1000)).length(4);
export function box2dToBBox([ymin, xmin, ymax, xmax]: number[]): z.infer<typeof BBoxSchema> {
  const x = Math.min(xmin, xmax) / 1000, y = Math.min(ymin, ymax) / 1000;
  return { x, y, width: Math.max(0.01, Math.abs(xmax - xmin) / 1000), height: Math.max(0.01, Math.abs(ymax - ymin) / 1000) };
}
const ModelBox = { box_2d: Box2d.optional(), bbox: BBoxSchema.optional() };
function withBBox<T extends { box_2d?: number[]; bbox?: z.infer<typeof BBoxSchema> }>(m: T) {
  const { box_2d, bbox, ...rest } = m;
  return { ...rest, bbox: box_2d ? box2dToBBox(box_2d) : bbox };
}

const Match = z.object({
  question_label: z.string(),
  exercise_label: z.string().nullable().optional().default(null),
  ...ModelBox,
  continues_to_next_page: z.boolean().default(false),
  question_text: z.string().default(""),
  // Models sometimes overshoot 0..1 (e.g. 1.98 or 95); clamp rather than drop a good match.
  confidence: z.preprocess((v) => (typeof v === "number" ? Math.max(0, Math.min(1, v)) : v), z.number().min(0).max(1)),
})
  .refine((m) => m.box_2d || m.bbox, { message: "box_2d is required" })
  .transform((m) => withBBox(m) as Omit<typeof m, "box_2d" | "bbox"> & { bbox: z.infer<typeof BBoxSchema> });
export const QuestionDetection = z.object({ matches: z.array(Match).max(6) });
export type QuestionMatch = z.infer<typeof Match>;

const Continuation = z
  .object({ found: z.boolean(), box_2d: Box2d.nullable().optional(), bbox: BBoxSchema.nullable().optional(), text: z.string().default("") })
  .transform(({ box_2d, bbox, ...rest }) => ({ ...rest, bbox: box_2d ? box2dToBBox(box_2d) : (bbox ?? null) }));

const BOX_2D_JSON = { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 };
const DETECTION_JSON = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question_label: { type: "string" }, exercise_label: { type: ["string", "null"] }, box_2d: BOX_2D_JSON,
          continues_to_next_page: { type: "boolean" }, question_text: { type: "string" }, confidence: { type: "number" },
        },
        required: ["question_label", "box_2d", "continues_to_next_page", "question_text", "confidence"],
      },
    },
  },
  required: ["matches"],
};

/** Clamp bbox into the page. */
export function clampBBox(b: z.infer<typeof BBoxSchema>): z.infer<typeof BBoxSchema> {
  const x = Math.max(0, Math.min(1, b.x)), y = Math.max(0, Math.min(1, b.y));
  return { x, y, width: Math.max(0.01, Math.min(1 - x, b.width)), height: Math.max(0.01, Math.min(1 - y, b.height)) };
}

async function pageForModel(image: Buffer): Promise<Buffer> {
  // ~1400px wide keeps small maths legible while bounding tokens.
  return sharp(image).resize({ width: 1400, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
}

export async function detectQuestion(
  image: Buffer,
  question: { label: string; exercise?: string | null; pageLabel: string },
  ctx: { supabase: SupabaseClient; userId: string; reasoning?: boolean },
): Promise<{ matches: QuestionMatch[]; model: string }> {
  const model = modelFor(ctx.reasoning ? "reasoning" : "fast");
  const r = await generateStructured(
    { task: "detect_question", model, supabase: ctx.supabase, userId: ctx.userId, fallbackReason: ctx.reasoning ? "question not found by fast model" : null },
    {
      system: DETECT_QUESTION_SYSTEM,
      parts: [
        imagePart(await pageForModel(image), "image/webp"),
        textPart(`Find question ${JSON.stringify(question.label)}${question.exercise ? ` in ${JSON.stringify(question.exercise)}` : ""} on textbook page ${JSON.stringify(question.pageLabel)}.`),
      ],
      schema: QuestionDetection,
      jsonSchema: DETECTION_JSON,
    },
  );
  const want = question.label.replace(/[^0-9a-z]/gi, "").toLowerCase();
  const matches = r.data.matches
    .filter((m) => m.question_label.replace(/[^0-9a-z]/gi, "").toLowerCase().startsWith(want.replace(/[a-z]+$/, "")))
    .map((m) => ({ ...m, bbox: clampBBox(m.bbox) }));
  return { matches, model };
}

export async function detectContinuation(
  image: Buffer,
  ctx: { supabase: SupabaseClient; userId: string; questionText: string },
): Promise<z.infer<typeof Continuation>> {
  const model = modelFor("fast");
  const r = await generateStructured(
    { task: "detect_continuation", model, supabase: ctx.supabase, userId: ctx.userId },
    {
      system: DETECT_CONTINUATION_SYSTEM,
      parts: [imagePart(await pageForModel(image), "image/webp"), textPart(`The question so far: ${ctx.questionText.slice(0, 1500)}`)],
      schema: Continuation,
    },
  );
  return { ...r.data, bbox: r.data.bbox ? clampBBox(r.data.bbox) : null };
}
