import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, withErrors, jsonError } from "@/lib/api/handler";
import { buildQuestionCrop, downloadPageImage } from "@/lib/questions/detector";
import { requireUser } from "@/lib/supabase/server";
import type { QuestionCacheRow } from "@/lib/supabase/types";

export const runtime = "nodejs";

const BBox = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0.005).max(1), height: z.number().min(0.005).max(1) });
const Body = z.union([
  z.object({ action: z.literal("correct"), bbox: BBox, continuationBBox: BBox.nullable().optional() }),
  z.object({ action: z.literal("reset") }),
]);

/** Correct a question box (becomes permanent) or reset it so detection runs again. */
export const PATCH = withErrors(async (req: Request, ctx: { params: Promise<{ questionId: string }> }) => {
  const { questionId } = await ctx.params;
  if (!z.string().uuid().safeParse(questionId).success) return jsonError("Bad id", 400);
  const { supabase, user } = await requireUser();
  const body = await parseBody(req, Body);
  const { data } = await supabase.from("question_cache").select("*").eq("id", questionId).maybeSingle();
  if (!data) return jsonError("Question not found", 404);
  const q = data as QuestionCacheRow;
  if (body.action === "reset") {
    const { error } = await supabase.from("question_cache").delete().eq("id", q.id);
    if (error) return jsonError(error.message, 400);
    return NextResponse.json({ reset: true });
  }
  const upd = {
    bbox: body.bbox,
    manually_corrected: true,
    ...(body.continuationBBox !== undefined ? { continuation_bbox: body.continuationBBox } : {}),
  };
  const { data: updated, error } = await supabase.from("question_cache").update(upd).eq("id", q.id).select("*").single();
  if (error) return jsonError(error.message, 400);
  const row = updated as QuestionCacheRow;
  const { data: page } = await supabase.from("book_pages").select("storage_path").eq("id", row.book_page_id).single();
  const img = await downloadPageImage(supabase, (page as { storage_path: string }).storage_path);
  let next: Buffer | null = null;
  if (row.continuation_page_ids?.length && row.continuation_bbox) {
    const { data: np } = await supabase.from("book_pages").select("storage_path").eq("id", row.continuation_page_ids[0]).maybeSingle();
    if (np) next = await downloadPageImage(supabase, (np as { storage_path: string }).storage_path);
  }
  const crop = await buildQuestionCrop(supabase, user.id, row, img, next);
  return NextResponse.json({ question: { ...row, question_image_path: crop.path } });
});
