"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Input, Label, Notice, ProgressBar, Spinner, cx } from "@/components/ui/primitives";
import { postJSON } from "@/components/command/use-command";
import { signedUrls } from "@/hooks/use-signed-url";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { BUCKETS } from "@/lib/supabase/storage";
import { applyPattern, findDuplicateLabels, needsReview } from "@/lib/books/sequence-inference";
import type { BookPageRow, BookRow } from "@/lib/supabase/types";
import type { MappingProgress } from "@/lib/books/mapping-service";

const ROW_H = 72;
const SOURCE_LABEL: Record<string, string> = { ai_visual: "AI", sequence_inferred: "inferred", manual: "manual", imported: "imported" };

export default function MappingPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = use(params);
  const sb = getBrowserSupabase();
  const [book, setBook] = useState<BookRow | null>(null);
  const [pages, setPages] = useState<BookPageRow[] | null>(null);
  const [filter, setFilter] = useState<"all" | "review">("all");
  const [auto, setAuto] = useState<{ running: boolean; last?: MappingProgress; error?: string }>({ running: false });
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [scrollTop, setScrollTop] = useState(0);
  const [pattern, setPattern] = useState({ from: "", to: "", start: "", chapter: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const stopRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data: b } = await sb.from("books").select("*").eq("id", bookId).maybeSingle();
    setBook(b as BookRow | null);
    const all: BookPageRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await sb.from("book_pages").select("*").eq("book_id", bookId).order("pdf_page_index").range(from, from + 999);
      all.push(...((data ?? []) as BookPageRow[]));
      if (!data || data.length < 1000) break;
    }
    setPages(all);
  }, [sb, bookId]);
  useEffect(() => { load(); }, [load]);

  const dupes = useMemo(() => (pages ? findDuplicateLabels(pages) : new Map<string, number[]>()), [pages]);
  const rows = useMemo(() => {
    if (!pages) return [];
    return filter === "all" ? pages : pages.filter((p) => needsReview(p) || (p.page_label && dupes.has(p.page_label)));
  }, [pages, filter, dupes]);

  // Virtualised window
  const viewH = 560;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 4);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + 4);
  const visible = rows.slice(first, last);

  useEffect(() => {
    const paths = visible.map((p) => p.thumbnail_path).filter((p): p is string => !!p && !thumbs[p]);
    if (!paths.length) return;
    signedUrls(BUCKETS.pages, paths).then((m) => setThumbs((t) => ({ ...t, ...m })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first, last, rows]);

  const runAuto = async (pdfPageIndexes?: number[]) => {
    stopRef.current = false;
    setAuto({ running: true });
    let failures = 0;
    try {
      for (let i = 0; i < 200 && !stopRef.current; i++) {
        const r = await postJSON<MappingProgress>(`/api/books/${bookId}/map`, pdfPageIndexes ? { pdfPageIndexes } : { batchSize: 12 });
        setAuto({ running: true, last: r });
        failures = r.errors.length && r.detected === 0 && r.processed > 0 ? failures + 1 : 0;
        if (failures >= 3) throw new Error(r.errors.slice(0, 3).join("; "));
        if (pdfPageIndexes || r.status !== "in_progress" || r.processed === 0) break;
        if (i % 3 === 2) await load();
      }
      setAuto((a) => ({ ...a, running: false }));
    } catch (e) {
      setAuto((a) => ({ ...a, running: false, error: (e as Error).message }));
    }
    await load();
  };

  const saveRow = async (p: BookPageRow, patch: Partial<BookPageRow>) => {
    const upd = { ...patch, mapping_source: "manual" as const, mapping_confidence: 1, manually_verified: true };
    setPages((ps) => ps?.map((x) => (x.id === p.id ? { ...x, ...upd } : x)) ?? null);
    const { error } = await sb.from("book_pages").update(upd).eq("id", p.id);
    if (error) setMsg(error.message);
  };

  const verify = async (p: BookPageRow) => {
    setPages((ps) => ps?.map((x) => (x.id === p.id ? { ...x, manually_verified: true } : x)) ?? null);
    await sb.from("book_pages").update({ manually_verified: true }).eq("id", p.id);
  };

  const applyBulk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pages) return;
    const from = Number(pattern.from), to = Number(pattern.to);
    if (!(from >= 1 && to >= from)) return setMsg("Enter a valid PDF page range.");
    let labels;
    try { labels = applyPattern(from, to, pattern.start.trim()); } catch (err) { return setMsg((err as Error).message); }
    const byIdx = new Map(pages.map((p) => [p.pdf_page_index, p]));
    const updates = labels.filter((l) => byIdx.has(l.pdf_page_index)).map((l) => {
      const p = byIdx.get(l.pdf_page_index)!;
      return {
        id: p.id, user_id: p.user_id, book_id: p.book_id, pdf_page_index: p.pdf_page_index, storage_path: p.storage_path, upload_status: p.upload_status,
        page_label: l.page_label, chapter_label: pattern.chapter.trim() || (l.page_label.includes(".") ? l.page_label.split(".")[0] : p.chapter_label),
        mapping_source: "manual", mapping_confidence: 1, manually_verified: true,
      };
    });
    for (let i = 0; i < updates.length; i += 200) {
      const { error } = await sb.from("book_pages").upsert(updates.slice(i, i + 200), { onConflict: "id" });
      if (error) return setMsg(error.message);
    }
    setMsg(`Applied labels to ${updates.length} pages.`);
    load();
  };

  const markComplete = async () => {
    await sb.from("books").update({ page_mapping_status: "complete" }).eq("id", bookId);
    load();
  };

  if (!pages || !book) return <div className="flex h-[50vh] items-center justify-center"><Spinner /></div>;
  const labelled = pages.filter((p) => p.page_label).length;
  const reviewCount = pages.filter(needsReview).length;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div>
        <Link href={`/books/${bookId}`} className="text-sm text-accent">← {book.title}</Link>
        <h1 className="text-xl font-semibold">Page mapping</h1>
        <p className="text-sm text-muted">Maps each PDF page to the page number printed in the book (e.g. PDF 187 → “4.33”). Manual edits always win.</p>
      </div>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {auto.running ? (
            <Button onClick={() => { stopRef.current = true; }}>Stop</Button>
          ) : (
            <Button variant="primary" onClick={() => runAuto()} disabled={!pages.length}>{labelled ? "Continue automatic mapping" : "Detect page numbers"}</Button>
          )}
          {book.page_mapping_status !== "complete" && labelled > 0 ? <Button onClick={markComplete}>Mark mapping as done</Button> : null}
          <span className="text-sm text-muted">{labelled}/{pages.length} labelled · {reviewCount} to review · status: {book.page_mapping_status.replace("_", " ")}</span>
        </div>
        {auto.running || auto.last ? (
          <div className="space-y-1">
            <ProgressBar value={(labelled / Math.max(1, pages.length)) * 100} label="Mapping progress" />
            {auto.last ? <p className="text-xs text-muted" aria-live="polite">Last batch: {auto.last.processed} pages read by AI, {auto.last.detected} labels found, {auto.last.inferred} inferred from sequence.{auto.running ? " Working…" : ""}</p> : null}
          </div>
        ) : null}
        {auto.error ? <Notice tone="error">{auto.error}</Notice> : null}
        {dupes.size ? <Notice tone="warn">Duplicate labels: {[...dupes.entries()].slice(0, 6).map(([l, idx]) => `“${l}” on PDF ${idx.join(", ")}`).join("; ")}. Please review.</Notice> : null}
      </Card>

      <Card className="p-4">
        <form onSubmit={applyBulk} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-5">
          <div><Label htmlFor="bf">From PDF page</Label><Input id="bf" inputMode="numeric" value={pattern.from} onChange={(e) => setPattern({ ...pattern, from: e.target.value })} /></div>
          <div><Label htmlFor="bt">To PDF page</Label><Input id="bt" inputMode="numeric" value={pattern.to} onChange={(e) => setPattern({ ...pattern, to: e.target.value })} /></div>
          <div><Label htmlFor="bs">First label</Label><Input id="bs" placeholder="4.1 or 233 or xiv" value={pattern.start} onChange={(e) => setPattern({ ...pattern, start: e.target.value })} /></div>
          <div><Label htmlFor="bc">Chapter (optional)</Label><Input id="bc" value={pattern.chapter} onChange={(e) => setPattern({ ...pattern, chapter: e.target.value })} /></div>
          <Button type="submit">Apply pattern</Button>
        </form>
        {msg ? <p className="mt-2 text-sm text-muted">{msg}</p> : null}
      </Card>

      <div className="flex gap-2">
        <Button size="sm" variant={filter === "all" ? "primary" : "secondary"} onClick={() => setFilter("all")}>All pages</Button>
        <Button size="sm" variant={filter === "review" ? "primary" : "secondary"} onClick={() => setFilter("review")}>Needs review ({reviewCount})</Button>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[3.5rem_3.5rem_1fr_5rem] gap-2 border-b border-border px-3 py-2 text-xs font-medium text-muted sm:grid-cols-[4rem_4rem_1fr_1fr_5rem_6rem_6rem]">
          <span>PDF</span><span>Preview</span><span>Page label</span><span className="hidden sm:block">Chapter</span><span>Conf.</span><span className="hidden sm:block">Source</span><span className="hidden sm:block" />
        </div>
        <div ref={listRef} className="overflow-auto" style={{ height: Math.min(viewH, rows.length * ROW_H + 2) }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
          <div style={{ height: rows.length * ROW_H, position: "relative" }}>
            {visible.map((p, i) => (
              <MappingRow
                key={p.id}
                page={p}
                top={(first + i) * ROW_H}
                thumb={p.thumbnail_path ? thumbs[p.thumbnail_path] : undefined}
                duplicate={!!p.page_label && dupes.has(p.page_label)}
                bookId={bookId}
                onSave={saveRow}
                onVerify={verify}
                onRedetect={() => runAuto([p.pdf_page_index])}
              />
            ))}
          </div>
        </div>
        {!rows.length ? <p className="p-4 text-sm text-muted">{filter === "review" ? "Nothing needs review." : "No pages uploaded yet."}</p> : null}
      </Card>
    </div>
  );
}

function MappingRow({ page, top, thumb, duplicate, bookId, onSave, onVerify, onRedetect }: {
  page: BookPageRow; top: number; thumb?: string; duplicate: boolean; bookId: string;
  onSave: (p: BookPageRow, patch: Partial<BookPageRow>) => void; onVerify: (p: BookPageRow) => void; onRedetect: () => void;
}) {
  const [label, setLabel] = useState(page.page_label ?? "");
  const [chapter, setChapter] = useState(page.chapter_label ?? "");
  useEffect(() => { setLabel(page.page_label ?? ""); setChapter(page.chapter_label ?? ""); }, [page.page_label, page.chapter_label]);
  const commit = () => {
    const l = label.trim() || null, c = chapter.trim() || null;
    if (l !== page.page_label || c !== page.chapter_label) onSave(page, { page_label: l, chapter_label: c });
  };
  const review = needsReview(page);
  return (
    <div
      className={cx("absolute inset-x-0 grid grid-cols-[3.5rem_3.5rem_1fr_5rem] items-center gap-2 border-b border-border px-3 sm:grid-cols-[4rem_4rem_1fr_1fr_5rem_6rem_6rem]", (review || duplicate) && "bg-warn/5")}
      style={{ top, height: ROW_H }}
    >
      <span className="font-mono text-sm">{page.pdf_page_index}</span>
      <Link href={`/books/${bookId}/page/${page.id}`} aria-label={`Open PDF page ${page.pdf_page_index}`} className="block h-14 w-10 overflow-hidden rounded border border-border bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover object-top" loading="lazy" /> : null}
      </Link>
      <Input aria-label={`Page label for PDF page ${page.pdf_page_index}`} value={label} onChange={(e) => setLabel(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className={cx("h-9 font-mono", duplicate && "border-warn")} placeholder="—" />
      <Input aria-label={`Chapter for PDF page ${page.pdf_page_index}`} value={chapter} onChange={(e) => setChapter(e.target.value)} onBlur={commit} className="hidden h-9 sm:block" placeholder="—" />
      <span className="text-sm">{page.mapping_confidence !== null && page.page_label ? `${Math.round(page.mapping_confidence * 100)}%` : "—"}</span>
      <span className="hidden text-xs text-muted sm:block">{page.manually_verified && page.mapping_source !== "manual" ? "verified" : page.mapping_source ? SOURCE_LABEL[page.mapping_source] : "—"}</span>
      <span className="hidden gap-1 sm:flex">
        {!page.manually_verified && page.page_label ? <Button size="sm" variant="ghost" onClick={() => onVerify(page)} aria-label="Mark verified">✓</Button> : null}
        {page.mapping_source !== "manual" ? <Button size="sm" variant="ghost" onClick={onRedetect} aria-label="Re-run detection">↻</Button> : null}
      </span>
    </div>
  );
}
