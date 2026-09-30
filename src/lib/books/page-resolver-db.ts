import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeLabel } from "./page-label";
import { resolvePageReferenceInMemory, type AliasLite, type PageRecordLite, type PageResolution } from "./page-resolver";

/**
 * DB-backed resolver. Exact label lookups hit the (book_id, page_label) index;
 * only when that fails do we load the book's (small) label map for spoken /
 * chapter / alias resolution. Pure logic lives in page-resolver.ts.
 */
export async function resolvePageReference(
  supabase: SupabaseClient,
  args: { bookId: string; pageReference: string | null; chapterReference?: string | null; transcriptContext?: string | null },
): Promise<PageResolution> {
  const ref = (args.pageReference ?? "").trim();
  if (!ref) return { status: "not_found", tried: [] };
  const cols = "id,pdf_page_index,page_label,chapter_label";

  if (!args.chapterReference) {
    const { data } = await supabase.from("book_pages").select(cols).eq("book_id", args.bookId).eq("page_label", normalizeLabel(ref)).limit(2);
    if (data && data.length === 1) {
      const p = data[0] as PageRecordLite;
      return { status: "resolved", page: p, label: p.page_label!, via: "exact" };
    }
  }

  const pages: PageRecordLite[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("book_pages").select(cols).eq("book_id", args.bookId).not("page_label", "is", null).order("pdf_page_index").range(from, from + 999);
    if (error) throw new Error(`Could not load page map: ${error.message}`);
    pages.push(...((data ?? []) as PageRecordLite[]));
    if (!data || data.length < 1000) break;
  }
  const { data: aliases } = await supabase.from("page_aliases").select("alias,book_page_id").eq("book_id", args.bookId);
  return resolvePageReferenceInMemory(
    { pageReference: ref, chapterReference: args.chapterReference ?? null, transcriptContext: args.transcriptContext ?? null },
    pages,
    (aliases ?? []) as AliasLite[],
  );
}
