import { normalizeLabel, parseChapterReference, spokenToLabelCandidates } from "./page-label";

export interface PageRecordLite {
  id: string;
  pdf_page_index: number;
  page_label: string | null;
  chapter_label: string | null;
}

export interface AliasLite {
  alias: string;
  book_page_id: string;
}

export type PageResolution =
  | { status: "resolved"; page: PageRecordLite; label: string; via: "exact" | "alias" | "spoken" | "chapter" }
  | { status: "ambiguous"; candidates: { label: string; page: PageRecordLite }[] }
  | { status: "not_found"; tried: string[] };

export interface ResolveInput {
  pageReference: string | null | undefined;
  chapterReference?: string | null;
  transcriptContext?: string | null;
}

/**
 * Deterministic resolver from a user's page reference to a concrete book page.
 * The semantic page map is authoritative — the AI never replaces it here.
 *
 * Order:
 * 1. exact label match (after trivial normalisation)
 * 2. alias match
 * 3. chapter context ("chapter 4 page 33" -> "4.33")
 * 4. spoken-number candidates; exactly one existing -> resolved, several -> ambiguous
 */
export function resolvePageReferenceInMemory(
  input: ResolveInput,
  pages: PageRecordLite[],
  aliases: AliasLite[] = [],
): PageResolution {
  const ref = (input.pageReference ?? "").trim();
  if (!ref) return { status: "not_found", tried: [] };

  const byLabel = new Map<string, PageRecordLite[]>();
  for (const p of pages) {
    if (!p.page_label) continue;
    const k = normalizeLabel(p.page_label);
    const list = byLabel.get(k) ?? [];
    list.push(p);
    byLabel.set(k, list);
  }
  const lookup = (label: string) => byLabel.get(normalizeLabel(label)) ?? [];
  const one = (list: PageRecordLite[]) => (list.length > 0 ? list[0] : null);

  const norm = normalizeLabel(ref);
  const tried: string[] = [];

  // 1. exact
  tried.push(norm);
  const exact = one(lookup(norm));
  const chapter = parseChapterReference(input.chapterReference);

  // Chapter context with a bare page number ("chapter 4", "33") takes precedence
  // over an exact bare-number match only when the combined label exists.
  if (chapter) {
    const pageCands = spokenToLabelCandidates(ref);
    for (const pc of pageCands) {
      if (pc.includes(".")) continue;
      const combined = `${chapter}.${pc}`;
      tried.push(combined);
      const hit = one(lookup(combined));
      if (hit) return { status: "resolved", page: hit, label: hit.page_label!, via: "chapter" };
    }
    // chapter + page given, but page belongs to that chapter under a plain label
    const inChapter = pages.filter(
      (p) => p.chapter_label && normalizeLabel(p.chapter_label) === normalizeLabel(chapter),
    );
    for (const pc of pageCands) {
      const hit = inChapter.find((p) => p.page_label && normalizeLabel(p.page_label) === normalizeLabel(pc));
      if (hit) return { status: "resolved", page: hit, label: hit.page_label!, via: "chapter" };
    }
  }

  if (exact) return { status: "resolved", page: exact, label: exact.page_label!, via: "exact" };

  // 2. alias
  const alias = aliases.find((a) => normalizeLabel(a.alias) === norm);
  if (alias) {
    const page = pages.find((p) => p.id === alias.book_page_id);
    if (page) return { status: "resolved", page, label: page.page_label ?? String(page.pdf_page_index), via: "alias" };
  }

  // 4. spoken candidates
  const candidates = spokenToLabelCandidates(ref);
  const found: { label: string; page: PageRecordLite }[] = [];
  for (const c of candidates) {
    tried.push(c);
    const hit = one(lookup(c));
    if (hit && !found.some((f) => f.page.id === hit.id)) found.push({ label: hit.page_label!, page: hit });
  }
  if (found.length === 1) return { status: "resolved", page: found[0].page, label: found[0].label, via: "spoken" };
  if (found.length > 1) return { status: "ambiguous", candidates: found };
  return { status: "not_found", tried: [...new Set(tried)] };
}
