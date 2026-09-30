import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuestionCacheRow } from "../supabase/types";

export function normalizeQuestionLabel(label: string): string {
  return label.trim().toLowerCase().replace(/^(q|question|no\.?)\s*/i, "").replace(/\s+/g, "").replace(/[.)]$/, "");
}

/** Cached questions for a page + label (possibly several, under different exercises). */
export async function findCachedQuestions(
  supabase: SupabaseClient,
  bookPageId: string,
  questionLabel: string,
  exerciseLabel?: string | null,
): Promise<QuestionCacheRow[]> {
  let q = supabase.from("question_cache").select("*").eq("book_page_id", bookPageId).eq("question_label", normalizeQuestionLabel(questionLabel));
  if (exerciseLabel) q = q.ilike("exercise_label", `%${exerciseLabel.replace(/[%_]/g, "")}%`);
  const { data, error } = await q;
  if (error) throw new Error(`Question cache lookup failed: ${error.message}`);
  return (data ?? []) as QuestionCacheRow[];
}
