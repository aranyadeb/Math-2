import "server-only";
import sharp from "sharp";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateStructured, imagePart, textPart } from "./client";
import { modelFor } from "./models";
import { DETECT_PAGE_LABEL_SYSTEM } from "./prompts";

export const PageLabelResult = z.object({
  visible_page_label: z.string().nullable(),
  chapter_label: z.string().nullable().optional().default(null),
  chapter_title: z.string().nullable().optional().default(null),
  section_label: z.string().nullable().optional().default(null),
  confidence: z.number().min(0).max(1),
  evidence_region: z.string().nullable().optional().default(null),
});
export type PageLabelResult = z.infer<typeof PageLabelResult>;

const JSON_SCHEMA = {
  type: "object",
  properties: {
    visible_page_label: { type: ["string", "null"] },
    chapter_label: { type: ["string", "null"] },
    chapter_title: { type: ["string", "null"] },
    section_label: { type: ["string", "null"] },
    confidence: { type: "number" },
    evidence_region: { type: ["string", "null"] },
  },
  required: ["visible_page_label", "confidence"],
};

/**
 * Build a compact image of the header and footer strips (top 12% + bottom 12%)
 * at reduced width — page numbers live there in almost every textbook and this
 * cuts image tokens substantially. `full` sends the whole page downscaled.
 */
export async function headerFooterStrip(image: Buffer, mode: "strips" | "full" = "strips"): Promise<Buffer> {
  const img = sharp(image);
  const meta = await img.metadata();
  const W = meta.width ?? 1000, H = meta.height ?? 1400;
  if (mode === "full") return sharp(image).resize({ width: Math.min(W, 900) }).webp({ quality: 70 }).toBuffer();
  const band = Math.round(H * 0.12);
  const top = await sharp(image).extract({ left: 0, top: 0, width: W, height: band }).toBuffer();
  const bottom = await sharp(image).extract({ left: 0, top: H - band, width: W, height: band }).toBuffer();
  const gap = 12;
  return sharp({ create: { width: W, height: band * 2 + gap, channels: 3, background: "#808080" } })
    .composite([{ input: top, top: 0, left: 0 }, { input: bottom, top: band + gap, left: 0 }])
    .resize({ width: Math.min(W, 1000) })
    .webp({ quality: 75 })
    .toBuffer();
}

export async function detectPageLabel(
  image: Buffer,
  pdfPageIndex: number,
  ctx: { supabase: SupabaseClient; userId: string; neighbourHint?: string | null; mode?: "strips" | "full" },
): Promise<PageLabelResult & { model: string }> {
  const model = modelFor("fast");
  const strip = await headerFooterStrip(image, ctx.mode ?? "strips");
  const r = await generateStructured(
    { task: "detect_page_label", model, supabase: ctx.supabase, userId: ctx.userId },
    {
      system: DETECT_PAGE_LABEL_SYSTEM,
      parts: [
        imagePart(strip, "image/webp"),
        textPart(
          `${ctx.mode === "full" ? "Full page (downscaled)." : "Top strip and bottom strip of the page, separated by a grey bar."} This is PDF page ${pdfPageIndex} (the PDF index is NOT the printed label).` +
            (ctx.neighbourHint ? ` Nearby pages were labelled ${ctx.neighbourHint}; use this only to read ambiguous digits, never to invent a label that is not printed.` : ""),
        ),
      ],
      schema: PageLabelResult,
      jsonSchema: JSON_SCHEMA,
    },
  );
  const label = r.data.visible_page_label?.trim() || null;
  return { ...r.data, visible_page_label: label, model };
}
