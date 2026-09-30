import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectContinuation, detectQuestion } from "../ai/detect-question";
import { BUCKETS, questionCropPath } from "../supabase/storage";
import type { BBox, BookPageRow, QuestionCacheRow } from "../supabase/types";
import { normalizeQuestionLabel } from "./cache";
import { cropRegion, stackSegments } from "./crop";

export async function downloadPageImage(supabase: SupabaseClient, path: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(BUCKETS.pages).download(path);
  if (error || !data) throw new Error(`Could not load page image: ${error?.message ?? "missing"}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function downloadCrop(supabase: SupabaseClient, path: string): Promise<Buffer | null> {
  const { data } = await supabase.storage.from(BUCKETS.crops).download(path);
  return data ? Buffer.from(await data.arrayBuffer()) : null;
}

/** Build + upload the logical question image (may span two pages) and store its path. */
export async function buildQuestionCrop(
  supabase: SupabaseClient,
  userId: string,
  row: Pick<QuestionCacheRow, "id" | "book_id" | "bbox" | "continuation_bbox" | "continuation_page_ids">,
  pageImage: Buffer,
  nextPageImage?: Buffer | null,
): Promise<{ path: string; bytes: Buffer }> {
  const segments: Buffer[] = [];
  segments.push(await cropRegion(pageImage, row.bbox ?? { x: 0, y: 0, width: 1, height: 1 }));
  if (nextPageImage && row.continuation_bbox) segments.push(await cropRegion(nextPageImage, row.continuation_bbox));
  const bytes = await stackSegments(segments);
  const path = questionCropPath(userId, row.book_id, row.id);
  const { error } = await supabase.storage.from(BUCKETS.crops).upload(path, bytes, { contentType: "image/webp", upsert: true });
  if (error) throw new Error(`Could not store question crop: ${error.message}`);
  await supabase.from("question_cache").update({ question_image_path: path }).eq("id", row.id);
  return { path, bytes };
}

async function nextPage(supabase: SupabaseClient, page: BookPageRow): Promise<BookPageRow | null> {
  const { data } = await supabase.from("book_pages").select("*").eq("book_id", page.book_id).eq("pdf_page_index", page.pdf_page_index + 1).maybeSingle();
  return (data as BookPageRow | null) ?? null;
}

export type DetectionOutcome =
  | { status: "found"; rows: QuestionCacheRow[] }
  | { status: "not_found"; model: string };

/**
 * Lazy question detection: Gemini locates the question on the resolved page,
 * follows a continuation onto the next page if needed, and the result is
 * cached permanently (manual corrections override).
 */
export async function detectAndCacheQuestion(
  supabase: SupabaseClient,
  userId: string,
  page: BookPageRow,
  question: { label: string; exercise: string | null },
): Promise<DetectionOutcome> {
  const image = await downloadPageImage(supabase, page.storage_path);
  let det = await detectQuestion(image, { label: question.label, exercise: question.exercise, pageLabel: page.page_label ?? String(page.pdf_page_index) }, { supabase, userId });
  if (!det.matches.length || det.matches.every((m) => m.confidence < 0.5)) {
    const retry = await detectQuestion(image, { label: question.label, exercise: question.exercise, pageLabel: page.page_label ?? String(page.pdf_page_index) }, { supabase, userId, reasoning: true });
    if (retry.matches.length) det = retry;
  }
  if (!det.matches.length) return { status: "not_found", model: det.model };

  const rows: QuestionCacheRow[] = [];
  for (const m of det.matches) {
    let continuationIds: string[] | null = null;
    let continuationBBox: BBox | null = null;
    let text = m.question_text;
    let nextImage: Buffer | null = null;
    if (m.continues_to_next_page) {
      const np = await nextPage(supabase, page);
      if (np) {
        nextImage = await downloadPageImage(supabase, np.storage_path);
        const c = await detectContinuation(nextImage, { supabase, userId, questionText: m.question_text });
        if (c.found && c.bbox) {
          continuationIds = [np.id];
          continuationBBox = c.bbox;
          text = `${text}\n${c.text}`.trim();
        }
      }
    }
    const label = normalizeQuestionLabel(m.question_label);
    const fields = {
      exercise_label: m.exercise_label,
      question_label: label,
      bbox: m.bbox,
      question_text: text,
      continues_to_next_page: !!continuationIds,
      continuation_page_ids: continuationIds,
      continuation_bbox: continuationBBox,
      confidence: m.confidence,
    };
    let existingQ = supabase.from("question_cache").select("*").eq("book_page_id", page.id).eq("question_label", label);
    existingQ = m.exercise_label ? existingQ.eq("exercise_label", m.exercise_label) : existingQ.is("exercise_label", null);
    const existing = await existingQ.limit(1).maybeSingle();
    let row: QuestionCacheRow;
    if (existing.data) {
      row = existing.data as QuestionCacheRow;
      if (!row.manually_corrected) {
        const up = await supabase.from("question_cache").update(fields).eq("id", row.id).select("*").single();
        if (up.error) throw new Error(`Could not cache question: ${up.error.message}`);
        row = up.data as QuestionCacheRow;
      }
    } else {
      const ins = await supabase.from("question_cache").insert({ ...fields, user_id: userId, book_id: page.book_id, book_page_id: page.id }).select("*").single();
      if (ins.error) throw new Error(`Could not cache question: ${ins.error.message}`);
      row = ins.data as QuestionCacheRow;
    }
    try {
      const crop = await buildQuestionCrop(supabase, userId, row, image, nextImage);
      row = { ...row, question_image_path: crop.path };
    } catch {
      // crop is an optimisation; the full page remains available
    }
    rows.push(row);
  }
  return { status: "found", rows };
}
