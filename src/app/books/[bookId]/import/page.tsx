"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useApp } from "@/components/layout/app-state";
import { Button, Card, Label, Notice, ProgressBar, Select, Spinner } from "@/components/ui/primitives";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { QUALITY_PRESETS, estimateStorageBytes, formatBytes, type QualityPreset } from "@/lib/books/image-compression";
import { defaultConcurrency, ingestBook, openPdf, type IngestControl, type IngestProgress } from "@/lib/books/ingestion";
import { clearPendingFile, takePendingFile } from "@/lib/books/pending-file";
import type { BookRow } from "@/lib/supabase/types";

const PRESET_LABEL: Record<QualityPreset, string> = { economy: "Economy", balanced: "Balanced", high: "High clarity" };

export default function ImportPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = use(params);
  const { user, refreshBooks, prefs } = useApp();
  const [book, setBook] = useState<BookRow | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preset, setPreset] = useState<QualityPreset>(prefs.ui_preferences.defaultQuality ?? "balanced");
  const [concurrency, setConcurrency] = useState(2);
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [existing, setExisting] = useState<{ uploaded: number; bytes: number }>({ uploaded: 0, bytes: 0 });
  const control = useRef<IngestControl>({ paused: false });

  const loadBook = useCallback(async () => {
    const sb = getBrowserSupabase();
    const { data } = await sb.from("books").select("*").eq("id", bookId).maybeSingle();
    if (data) {
      setBook(data as BookRow);
      if ((data as BookRow).uploaded_bytes > 0) setPreset((data as BookRow).image_quality);
    }
    const { count } = await sb.from("book_pages").select("id", { count: "exact", head: true }).eq("book_id", bookId).eq("upload_status", "uploaded");
    setExisting({ uploaded: count ?? 0, bytes: (data as BookRow | null)?.uploaded_bytes ?? 0 });
  }, [bookId]);

  useEffect(() => {
    setConcurrency(defaultConcurrency());
    loadBook();
  }, [loadBook]);

  const acceptFile = useCallback(async (f: File, b: BookRow) => {
    setFileError(null);
    if (b.source_filename && (f.name !== b.source_filename || (b.source_size_bytes && f.size !== b.source_size_bytes))) {
      setFileError(`This doesn't look like the original file (${b.source_filename}, ${formatBytes(b.source_size_bytes ?? 0)}). Pick the same PDF to resume.`);
      return;
    }
    try {
      const doc = await openPdf(f);
      if (b.pdf_page_count && doc.numPages !== b.pdf_page_count) {
        setFileError(`Page count differs (${doc.numPages} vs ${b.pdf_page_count}).`);
        return;
      }
      setPdf(doc);
    } catch (e) {
      setFileError((e as Error).message);
    }
  }, []);

  // Pick up the file chosen on the previous screen (same tab, no refresh)
  useEffect(() => {
    if (!book || pdf) return;
    const f = takePendingFile(bookId);
    if (f) acceptFile(f, book);
  }, [book, bookId, pdf, acceptFile]);

  const start = async () => {
    if (!pdf || !user || !book) return;
    control.current.paused = false;
    setRunning(true);
    try {
      const r = await ingestBook({ supabase: getBrowserSupabase(), userId: user.id, bookId, pdf, preset, concurrency, control: control.current, onProgress: setProgress });
      if (r.state === "complete") {
        clearPendingFile(bookId);
        const sb = getBrowserSupabase();
        const { data: first } = await sb.from("book_pages").select("thumbnail_path").eq("book_id", bookId).eq("pdf_page_index", 1).maybeSingle();
        if (first?.thumbnail_path) await sb.from("books").update({ cover_path: first.thumbnail_path }).eq("id", bookId);
      }
    } catch (e) {
      setProgress((p) => (p ? { ...p, state: "error", message: (e as Error).message } : null));
    } finally {
      setRunning(false);
      await loadBook();
      refreshBooks();
    }
  };

  const retryFailed = async () => {
    if (!pdf || !user || !progress?.failed.length) return;
    control.current.paused = false;
    setRunning(true);
    try {
      await ingestBook({ supabase: getBrowserSupabase(), userId: user.id, bookId, pdf, preset, concurrency: 1, control: control.current, onProgress: setProgress, only: progress.failed });
    } finally {
      setRunning(false);
      loadBook();
    }
  };

  // Warn before leaving while uploading
  useEffect(() => {
    if (!running) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [running]);

  if (!book) return <div className="flex h-[50vh] items-center justify-center"><Spinner /></div>;
  const total = book.pdf_page_count;
  const done = progress?.done ?? existing.uploaded;
  const uploadedBytes = progress?.uploadedBytes ?? existing.bytes;
  const measured = progress?.avgBytesPerPage || (existing.uploaded ? existing.bytes / existing.uploaded : 0);
  const estimate = done > 5 ? Math.round(uploadedBytes + (total - done) * measured) : estimateStorageBytes(total, preset);
  const complete = done >= total && total > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div>
        <Link href={`/books/${bookId}`} className="text-sm text-accent">← {book.title}</Link>
        <h1 className="text-xl font-semibold">Prepare pages</h1>
        <p className="text-sm text-muted">Pages are rendered in this browser and uploaded to your private storage. You can pause and resume any time — finished pages are never uploaded twice.</p>
      </div>

      <Card className="space-y-4 p-4">
        {!pdf && !complete ? (
          <div>
            <Label htmlFor="pdf">{existing.uploaded ? `Select ${book.source_filename ?? "the same PDF"} to resume` : "Select the PDF"}</Label>
            <input id="pdf" type="file" accept="application/pdf" onChange={(e) => e.target.files?.[0] && acceptFile(e.target.files[0], book)} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-sm" />
            {fileError ? <Notice tone="error" className="mt-2">{fileError}</Notice> : null}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="q">Image quality</Label>
            <Select id="q" value={preset} disabled={running || existing.uploaded > 0} onChange={(e) => setPreset(e.target.value as QualityPreset)} className="w-full">
              {(Object.keys(QUALITY_PRESETS) as QualityPreset[]).map((p) => (
                <option key={p} value={p}>{PRESET_LABEL[p]} — {QUALITY_PRESETS[p].maxWidth}px</option>
              ))}
            </Select>
            {existing.uploaded > 0 ? <p className="mt-1 text-xs text-muted">Quality is fixed once upload has started (keeps pages consistent).</p> : null}
          </div>
          <div>
            <Label htmlFor="c">Pages at a time</Label>
            <Select id="c" value={concurrency} disabled={running} onChange={(e) => setConcurrency(Number(e.target.value))} className="w-full">
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </div>
        </div>

        <div className="rounded-lg bg-surface-2 p-3 text-sm">
          <p>Estimated cloud storage: <strong>{formatBytes(estimate)}</strong></p>
          <p className="text-muted">Uploaded so far: {formatBytes(uploadedBytes)}</p>
        </div>

        <div className="space-y-1">
          <ProgressBar value={total ? (done / total) * 100 : 0} label="Import progress" />
          <p className="text-sm" aria-live="polite">
            {done} / {total} pages ({total ? Math.floor((done / total) * 100) : 0}%)
            {progress?.failed.length ? <span className="text-danger"> · {progress.failed.length} failed</span> : null}
            {progress?.current.length ? <span className="text-muted"> · working on {progress.current.join(", ")}</span> : null}
          </p>
          {progress?.message ? <p className="text-xs text-muted">{progress.message}</p> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {!complete ? (
            running ? (
              <Button onClick={() => { control.current.paused = true; }}>{control.current.paused ? "Pausing…" : "Pause"}</Button>
            ) : (
              <Button variant="primary" disabled={!pdf} onClick={start}>{existing.uploaded ? "Resume" : "Start"}</Button>
            )
          ) : null}
          {progress?.failed.length && !running ? <Button onClick={retryFailed}>Retry failed pages</Button> : null}
          {complete ? <Link href={`/books/${bookId}/mapping`}><Button variant="primary">Next: map page numbers</Button></Link> : null}
        </div>
      </Card>
    </div>
  );
}
