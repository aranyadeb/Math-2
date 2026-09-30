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

const Match = z.object({
  question_label: z.string(),
  exercise_label: z.string().nullable().optional().default(null),
  bbox: BBoxSchema,
  continues_to_next_page: z.boolean().default(false),
  question_text: z.string().default(""),
  confidence: z.number().min(0).max(1),
});
export const QuestionDetection = z.object({ matches: z.array(Match).max(6) });
export type QuestionMatch = z.infer<typeof Match>;

const Continuation = z.object({ found: z.boolean(), bbox: BBoxSchema.nullable().optional().default(null), text: z.string().default("") });

const BBOX_JSON = { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } }, required: ["x", "y", "width", "height"] };
const DETECTION_JSON = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question_label: { type: "string" }, exercise_label: { type: ["string", "null"] }, bbox: BBOX_JSON,
          continues_to_next_page: { type: "boolean" }, question_text: { type: "string" }, confidence: { type: "number" },
        },
        required: ["question_label", "bbox", "continues_to_next_page", "question_text", "confidence"],
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
