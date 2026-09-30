import { compareLabels } from "./page-label";

export type MappingSource = "ai_visual" | "sequence_inferred" | "manual" | "imported";

export interface MappingEntry {
  pdf_page_index: number;
  page_label: string | null;
  chapter_label: string | null;
  mapping_source: MappingSource | null;
  mapping_confidence: number | null;
  manually_verified?: boolean;
}

/** A label pattern that supports stepping: plain integers, "C.N" chapter-page, or roman numerals. */
type Pattern =
  | { kind: "int"; value: number }
  | { kind: "chapter"; chapter: string; sep: string; value: number }
  | { kind: "roman"; value: number; upper: boolean };

const ROMAN: [number, string][] = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

export function toRoman(n: number): string {
  let out = "";
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out;
}

export function fromRoman(s: string): number | null {
  const str = s.toLowerCase();
  if (!/^[ivxlcdm]+$/.test(str)) return null;
  let i = 0, n = 0;
  for (const [v, sym] of ROMAN) while (str.startsWith(sym, i)) { n += v; i += sym.length; }
  return i === str.length && toRoman(n) === str ? n : null;
}

export function parsePattern(label: string): Pattern | null {
  if (/^\d+$/.test(label)) return { kind: "int", value: Number(label) };
  const m = /^([0-9A-Za-z]+)([.\-])(\d+)$/.exec(label);
  if (m) return { kind: "chapter", chapter: m[1], sep: m[2], value: Number(m[3]) };
  const r = fromRoman(label);
  if (r !== null) return { kind: "roman", value: r, upper: label === label.toUpperCase() };
  return null;
}

export function stepLabel(label: string, delta: number): string | null {
  const p = parsePattern(label);
  if (!p) return null;
  const v = p.value + delta;
  if (v < 1) return null;
  if (p.kind === "int") return String(v);
  if (p.kind === "chapter") return `${p.chapter}${p.sep}${v}`;
  const r = toRoman(v);
  return p.upper ? r.toUpperCase() : r;
}

function samePattern(a: Pattern, b: Pattern): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "chapter" && b.kind === "chapter") return a.chapter === b.chapter && a.sep === b.sep;
  return true;
}

/**
 * Fill gaps between two trusted anchors when the step is perfectly consistent.
 * Anchors: manual, imported, or AI-visual with confidence ≥ minAnchorConfidence.
 * Never overwrites manual/AI-detected entries; inferred entries are marked
 * "sequence_inferred". Returns the updated entries (a new array).
 */
export function inferSequence(entries: MappingEntry[], minAnchorConfidence = 0.8): MappingEntry[] {
  const sorted = [...entries].sort((a, b) => a.pdf_page_index - b.pdf_page_index);
  const isAnchor = (e: MappingEntry) =>
    !!e.page_label &&
    (e.mapping_source === "manual" || e.mapping_source === "imported" || e.manually_verified ||
      (e.mapping_source === "ai_visual" && (e.mapping_confidence ?? 0) >= minAnchorConfidence));

  const anchors = sorted.filter(isAnchor);
  const byIndex = new Map(sorted.map((e) => [e.pdf_page_index, { ...e }]));

  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i], b = anchors[i + 1];
    const gap = b.pdf_page_index - a.pdf_page_index;
    if (gap <= 1) continue;
    const pa = parsePattern(a.page_label!), pb = parsePattern(b.page_label!);
    if (!pa || !pb || !samePattern(pa, pb)) continue;
    if (pb.value - pa.value !== gap) continue; // not a clean run — leave for review
    for (let k = 1; k < gap; k++) {
      const idx = a.pdf_page_index + k;
      const cur = byIndex.get(idx);
      if (!cur) continue;
      if (cur.mapping_source === "manual" || cur.manually_verified) continue;
      if (cur.mapping_source === "ai_visual" && cur.page_label && (cur.mapping_confidence ?? 0) >= minAnchorConfidence) continue;
      const label = stepLabel(a.page_label!, k)!;
      byIndex.set(idx, {
        ...cur,
        page_label: label,
        chapter_label: cur.chapter_label ?? a.chapter_label ?? (pa.kind === "chapter" ? pa.chapter : null),
        mapping_source: "sequence_inferred",
        mapping_confidence: Math.min(a.mapping_confidence ?? 1, b.mapping_confidence ?? 1) * 0.95,
      });
    }
  }
  return [...byIndex.values()].sort((a, b) => a.pdf_page_index - b.pdf_page_index);
}

/**
 * Pick which PDF pages should be sent to Gemini next.
 * Pass 1: evenly spaced samples. Pass 2: pages bordering unresolved gaps or
 * discontinuities (chapter starts / resets). Pass 4: random verification of inferred runs.
 */
export function planMappingSamples(
  entries: MappingEntry[],
  pageCount: number,
  opts: { sampleEvery?: number; maxBatch?: number; verifyFraction?: number; seed?: number } = {},
): number[] {
  const sampleEvery = opts.sampleEvery ?? 10;
  const maxBatch = opts.maxBatch ?? 40;
  const known = new Map(entries.map((e) => [e.pdf_page_index, e]));
  // "attempted" = a label has been looked at by AI or a human (inferred labels don't count).
  const attempted = (i: number) => {
    const e = known.get(i);
    return !!e && (e.mapping_source === "ai_visual" || e.mapping_source === "manual" || e.mapping_source === "imported" || !!e.manually_verified);
  };
  const inferred = inferSequence(entries);
  const inferredMap = new Map(inferred.map((e) => [e.pdf_page_index, e]));
  const hasLabel = (i: number) => !!inferredMap.get(i)?.page_label;
  const want = new Set<number>();

  // Pass 1: sampling across the book (skips pages already labelled by inference)
  for (let i = 1; i <= pageCount; i += sampleEvery) if (!attempted(i) && !hasLabel(i)) want.add(i);
  if (pageCount > 0 && !attempted(pageCount) && !hasLabel(pageCount)) want.add(pageCount);

  // Pass 2: probe gaps that inference could not bridge (chapter starts, resets, discontinuities)
  const labelled = inferred.filter((e) => e.page_label);
  for (let i = 0; i + 1 < labelled.length; i++) {
    const a = labelled[i], b = labelled[i + 1];
    if (b.pdf_page_index - a.pdf_page_index > 1) {
      const mid = Math.floor((a.pdf_page_index + b.pdf_page_index) / 2);
      if (!attempted(mid)) want.add(mid);
      if (!attempted(a.pdf_page_index + 1)) want.add(a.pdf_page_index + 1);
      if (!attempted(b.pdf_page_index - 1)) want.add(b.pdf_page_index - 1);
    }
  }

  // Pass 4: verify a fixed, deterministic subset of inferred pages (hash of the index),
  // so repeated planning never snowballs into verifying everything.
  const verifyEvery = Math.max(2, Math.round(1 / (opts.verifyFraction ?? 0.03)));
  const seed = opts.seed ?? 12345;
  for (const e of inferred) {
    if (e.mapping_source !== "sequence_inferred" || attempted(e.pdf_page_index)) continue;
    const h = ((e.pdf_page_index * 2654435761 + seed) >>> 0) % verifyEvery;
    if (h === 0) want.add(e.pdf_page_index);
  }
  return [...want].sort((a, b) => a - b).slice(0, maxBatch);
}

/** Pages that should be shown to the user for review (Pass 5). */
export function needsReview(e: MappingEntry): boolean {
  if (e.mapping_source === "manual" || e.manually_verified) return false;
  if (!e.page_label) return true;
  return (e.mapping_confidence ?? 0) < 0.75;
}

/** Detect duplicate labels (a strong sign of a mapping error). */
export function findDuplicateLabels(entries: MappingEntry[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const e of entries) {
    if (!e.page_label) continue;
    const list = m.get(e.page_label) ?? [];
    list.push(e.pdf_page_index);
    m.set(e.page_label, list);
  }
  for (const [k, v] of m) if (v.length < 2) m.delete(k);
  return m;
}

/** Apply a user pattern such as start label "4.1" from PDF page 157 through 190. */
export function applyPattern(startIndex: number, endIndex: number, startLabel: string): { pdf_page_index: number; page_label: string }[] {
  if (!parsePattern(startLabel)) throw new Error(`Label "${startLabel}" is not a steppable pattern`);
  const out: { pdf_page_index: number; page_label: string }[] = [];
  for (let i = startIndex; i <= endIndex; i++) out.push({ pdf_page_index: i, page_label: stepLabel(startLabel, i - startIndex)! });
  return out;
}

export { compareLabels };
