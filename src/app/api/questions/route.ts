import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, withErrors, jsonError } from "@/lib/api/handler";
import { normalizeQuestionLabel } from "@/lib/questions/cache";
import { buildQuestionCrop, downloadPageImage } from "@/lib/questions/detector";
import { requireUser } from "@/lib/supabase/server";
import type { BookPageRow, QuestionCacheRow } from "@/lib/supabase/types";

export const runtime = "nodejs";

const BBox = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0.005).max(1), height: z.number().min(0.005).max(1) });
const Body = z.object({
  bookPageId: z.string().uuid(),
  questionLabel: z.string().min(1).max(40),
  exerciseLabel: z.string().max(80).nullable().optional(),
  bbox: BBox,
});

/** Manually mark a question the AI could not find. Manual boxes are authoritative. */
export const POST = withErrors(async (req: Request) => {
  const { supabase, user } = await requireUser();
  const body = await parseBody(req, Body);
  const { data: page } = await supabase.from("book_pages").select("*").eq("id", body.bookPageId).maybeSingle();
  if (!page) return jsonError("Page not found", 404);
  const p = page as BookPageRow;
  const label = normalizeQuestionLabel(body.questionLabel);
  let existing = supabase.from("question_cache").select("*").eq("book_page_id", p.id).eq("question_label", label);
  existing = body.exerciseLabel ? existing.eq("exercise_label", body.exerciseLabel) : existing.is("exercise_label", null);
  const found = await existing.limit(1).maybeSingle();
  const fields = { bbox: body.bbox, manually_corrected: true, confidence: 1, continues_to_next_page: false, continuation_page_ids: null, continuation_bbox: null };
  const res = found.data
    ? await supabase.from("question_cache").update(fields).eq("id", (found.data as QuestionCacheRow).id).select("*").single()
    : await supabase.from("question_cache").insert({ ...fields, user_id: user.id, book_id: p.book_id, book_page_id: p.id, question_label: label, exercise_label: body.exerciseLabel ?? null }).select("*").single();
  if (res.error) return jsonError(res.error.message, 400);
  const row = res.data as QuestionCacheRow;
  const img = await downloadPageImage(supabase, p.storage_path);
  const crop = await buildQuestionCrop(supabase, user.id, row, img, null);
  return NextResponse.json({ question: { ...row, question_image_path: crop.path } });
});
