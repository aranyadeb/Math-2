import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectPageLabel } from "../ai/detect-page-label";
import { downloadPageImage } from "../questions/detector";
import type { BookPageRow } from "../supabase/types";
import { findDuplicateLabels, inferSequence, needsReview, planMappingSamples, type MappingEntry } from "./sequence-inference";

async function loadPages(supabase: SupabaseClient, bookId: string): Promise<BookPageRow[]> {
  const out: BookPageRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("book_pages").select("*").eq("book_id", bookId).order("pdf_page_index").range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as BookPageRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export interface MappingProgress {
  processed: number;
  detected: number;
  inferred: number;
  remaining: number;
  reviewCount: number;
  duplicates: string[];
  status: "in_progress" | "needs_review" | "complete";
  errors: string[];
}

/**
 * One bounded mapping pass: detect labels on the planned sample pages
 * (header/footer strips only), then fill obvious runs by sequence inference.
 * The client calls this repeatedly until status != in_progress.
 */
export async function runMappingBatch(
  supabase: SupabaseClient,
  userId: string,
  bookId: string,
  opts: { batchSize?: number; pdfPageIndexes?: number[] } = {},
): Promise<MappingProgress> {
  const pages = (await loadPages(supabase, bookId)).filter((p) => p.upload_status === "uploaded");
  const byIndex = new Map(pages.map((p) => [p.pdf_page_index, p]));
  const toEntry = (p: BookPageRow): MappingEntry => ({
    pdf_page_index: p.pdf_page_index, page_label: p.page_label, chapter_label: p.chapter_label,
    mapping_source: p.mapping_source, mapping_confidence: p.mapping_confidence, manually_verified: p.manually_verified,
  });

  const maxIndex = pages.length ? pages[pages.length - 1].pdf_page_index : 0;
  const plan = (opts.pdfPageIndexes ?? planMappingSamples(pages.map(toEntry), maxIndex, { sampleEvery: maxIndex > 400 ? 12 : 8, maxBatch: 400 }))
    .filter((i) => byIndex.has(i) && !byIndex.get(i)!.manually_verified && byIndex.get(i)!.mapping_source !== "manual");
  const batch = plan.slice(0, opts.batchSize ?? 12);

  await supabase.from("books").update({ page_mapping_status: "in_progress" }).eq("id", bookId);

  const errors: string[] = [];
  let detected = 0;
  await pool(batch, 4, async (idx) => {
    const p = byIndex.get(idx)!;
    try {
      const img = await downloadPageImage(supabase, p.storage_path);
      let r = await detectPageLabel(img, idx, { supabase, userId });
      if (!r.visible_page_label || r.confidence < 0.6) {
        // Numbering printed elsewhere (e.g. side margin) — retry once with the whole page.
        const full = await detectPageLabel(img, idx, { supabase, userId, mode: "full" });
        if (full.visible_page_label && full.confidence >= r.confidence) r = full;
      }
      const upd = {
        page_label: r.visible_page_label,
        chapter_label: r.chapter_label ?? (r.visible_page_label && /^[0-9A-Za-z]+[.\-]\d+$/.test(r.visible_page_label) ? r.visible_page_label.split(/[.\-]/)[0] : null),
        chapter_title: r.chapter_title,
        section_label: r.section_label,
        mapping_source: "ai_visual" as const,
        mapping_confidence: Math.max(0.001, r.confidence),
      };
      const { error } = await supabase.from("book_pages").update(upd).eq("id", p.id);
      if (error) throw new Error(error.message);
      Object.assign(p, upd);
      if (r.visible_page_label) detected++;
    } catch (e) {
      errors.push(`PDF ${idx}: ${(e as Error).message}`);
    }
  });

  // Sequence inference over the whole map
  const inferredEntries = inferSequence(pages.map(toEntry));
  const changed: BookPageRow[] = [];
  for (const e of inferredEntries) {
    const p = byIndex.get(e.pdf_page_index)!;
    if (e.mapping_source === "sequence_inferred" && (p.page_label !== e.page_label || p.mapping_source !== "sequence_inferred")) {
      changed.push({ ...p, page_label: e.page_label, chapter_label: e.chapter_label, mapping_source: "sequence_inferred", mapping_confidence: e.mapping_confidence });
    }
  }
  for (let i = 0; i < changed.length; i += 200) {
    const chunk = changed.slice(i, i + 200).map((p) => ({
      id: p.id, user_id: userId, book_id: bookId, pdf_page_index: p.pdf_page_index, storage_path: p.storage_path,
      page_label: p.page_label, chapter_label: p.chapter_label, mapping_source: p.mapping_source, mapping_confidence: p.mapping_confidence,
      upload_status: p.upload_status,
    }));
    const { error } = await supabase.from("book_pages").upsert(chunk, { onConflict: "id" });
    if (error) errors.push(`inference save: ${error.message}`);
    for (const c of changed.slice(i, i + 200)) Object.assign(byIndex.get(c.pdf_page_index)!, c);
  }

  const finalEntries = pages.map(toEntry);
  const remainingPlan = planMappingSamples(finalEntries, maxIndex, { sampleEvery: maxIndex > 400 ? 12 : 8, maxBatch: 400 })
    .filter((i) => byIndex.has(i) && !byIndex.get(i)!.manually_verified);
  const reviewCount = finalEntries.filter(needsReview).length;
  const duplicates = [...findDuplicateLabels(finalEntries).keys()];
  const status: MappingProgress["status"] = remainingPlan.length > 0 && !opts.pdfPageIndexes ? "in_progress" : reviewCount > 0 || duplicates.length ? "needs_review" : "complete";
  await supabase.from("books").update({ page_mapping_status: status }).eq("id", bookId);
  return { processed: batch.length, detected, inferred: changed.length, remaining: remainingPlan.length, reviewCount, duplicates, status, errors };
}
