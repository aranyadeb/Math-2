"use client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKETS, pageImagePath, pageThumbPath } from "../supabase/storage";
import { QUALITY_PRESETS, canvasToImageBlob, scaledCanvas, type QualityPreset } from "./image-compression";

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

/** Lazy-load PDF.js (heavy) only on the import screen. */
export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      return m;
    });
  }
  return pdfjsPromise;
}

const tasks = new WeakMap<PDFDocumentProxy, { destroy: () => Promise<void> }>();

export async function openPdf(file: File): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const pdf = await task.promise;
  tasks.set(pdf, task);
  return pdf;
}

export async function closePdf(pdf: PDFDocumentProxy): Promise<void> {
  await tasks.get(pdf)?.destroy();
}

/**
 * Page labels embedded in the PDF itself (rare for scans). Only useful when
 * they differ from plain 1..N numbering; stored as mapping_source "imported".
 */
export async function embeddedPageLabels(pdf: PDFDocumentProxy): Promise<string[] | null> {
  try {
    const labels = await pdf.getPageLabels();
    if (!labels || labels.length !== pdf.numPages) return null;
    if (labels.every((l, i) => l === String(i + 1))) return null;
    return labels.map((l) => l.trim());
  } catch {
    return null;
  }
}

export interface IngestProgress {
  total: number;
  done: number;
  failed: number[];
  uploadedBytes: number;
  avgBytesPerPage: number;
  current: number[];
  state: "running" | "paused" | "complete" | "error";
  message?: string;
}

export interface IngestControl {
  paused: boolean;
}

export function defaultConcurrency(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency ?? 4 : 4;
  const mem = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4 : 4;
  if (mem <= 2 || cores <= 2) return 1;
  if (mem <= 4 || cores <= 4) return 2;
  return 3;
}

async function renderPage(pdf: PDFDocumentProxy, index: number, preset: QualityPreset) {
  const s = QUALITY_PRESETS[preset];
  const page = await pdf.getPage(index);
  try {
    const base = page.getViewport({ scale: 1 });
    // Render at the target width (never below ~1.2x for tiny page boxes, to keep subscripts sharp).
    const scale = Math.max(1.2, s.maxWidth / base.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: false })!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas } as unknown as Parameters<typeof page.render>[0]).promise;
    const main = canvas.width > s.maxWidth ? scaledCanvas(canvas, s.maxWidth) : canvas;
    const full = await canvasToImageBlob(main, s.quality);
    const thumbCanvas = scaledCanvas(main, s.thumbWidth);
    const thumb = await canvasToImageBlob(thumbCanvas, s.thumbQuality);
    const dims = { width: main.width, height: main.height };
    // free memory promptly (important on phones)
    for (const c of [canvas, main, thumbCanvas]) { c.width = 0; c.height = 0; }
    return { full, thumb, ...dims };
  } finally {
    page.cleanup();
  }
}

/**
 * Resumable, progressive ingestion: pages already uploaded are skipped, a
 * small worker pool renders → compresses → uploads to private Storage →
 * upserts the book_pages row. Safe to call again after refresh or pause.
 */
export async function ingestBook(opts: {
  supabase: SupabaseClient;
  userId: string;
  bookId: string;
  pdf: PDFDocumentProxy;
  preset: QualityPreset;
  concurrency?: number;
  control: IngestControl;
  onProgress: (p: IngestProgress) => void;
  only?: number[];
}): Promise<IngestProgress> {
  const { supabase, userId, bookId, pdf, preset, control } = opts;
  const total = pdf.numPages;

  const uploaded = new Set<number>();
  let uploadedBytes = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("book_pages").select("pdf_page_index,upload_status,size_bytes").eq("book_id", bookId).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) if (r.upload_status === "uploaded") { uploaded.add(r.pdf_page_index); uploadedBytes += r.size_bytes ?? 0; }
    if (!data || data.length < 1000) break;
  }

  const embedded = await embeddedPageLabels(pdf);
  const queue = (opts.only ?? Array.from({ length: total }, (_, i) => i + 1)).filter((i) => !uploaded.has(i));
  const progress: IngestProgress = {
    total, done: uploaded.size, failed: [], uploadedBytes, avgBytesPerPage: uploaded.size ? uploadedBytes / uploaded.size : 0, current: [], state: "running",
  };
  const emit = () => opts.onProgress({ ...progress, failed: [...progress.failed], current: [...progress.current] });
  emit();

  await supabase.from("books").update({ ingestion_status: "in_progress", pdf_page_count: total, image_quality: preset }).eq("id", bookId);

  let lastBookUpdate = Date.now();
  const worker = async () => {
    while (queue.length && !control.paused) {
      const idx = queue.shift()!;
      progress.current.push(idx);
      emit();
      let ok = false;
      let lastErr = "";
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const r = await renderPage(pdf, idx, preset);
          const path = pageImagePath(userId, bookId, idx, r.full.ext);
          const tpath = pageThumbPath(userId, bookId, idx, r.thumb.ext);
          const up1 = await supabase.storage.from(BUCKETS.pages).upload(path, r.full.blob, { contentType: r.full.blob.type, upsert: true });
          if (up1.error) throw new Error(up1.error.message);
          const up2 = await supabase.storage.from(BUCKETS.pages).upload(tpath, r.thumb.blob, { contentType: r.thumb.blob.type, upsert: true });
          if (up2.error) throw new Error(up2.error.message);
          const { error } = await supabase.from("book_pages").upsert(
            {
              user_id: userId, book_id: bookId, pdf_page_index: idx, storage_path: path, thumbnail_path: tpath,
              size_bytes: r.full.blob.size + r.thumb.blob.size, width: r.width, height: r.height, upload_status: "uploaded",
              ...(embedded?.[idx - 1] ? { page_label: embedded[idx - 1], mapping_source: "imported", mapping_confidence: 0.9 } : {}),
            },
            { onConflict: "book_id,pdf_page_index" },
          );
          if (error) throw new Error(error.message);
          progress.uploadedBytes += r.full.blob.size + r.thumb.blob.size;
          ok = true;
        } catch (e) {
          lastErr = (e as Error).message;
          await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
        }
      }
      progress.current = progress.current.filter((c) => c !== idx);
      if (ok) progress.done++;
      else {
        progress.failed.push(idx);
        progress.message = `Page ${idx}: ${lastErr}`;
      }
      progress.avgBytesPerPage = progress.done ? progress.uploadedBytes / progress.done : 0;
      emit();
      if (Date.now() - lastBookUpdate > 4000) {
        lastBookUpdate = Date.now();
        await supabase.from("books").update({ uploaded_bytes: progress.uploadedBytes }).eq("id", bookId);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? defaultConcurrency()) }, worker));

  progress.state = control.paused ? "paused" : progress.done >= total ? "complete" : progress.failed.length ? "error" : "paused";
  await supabase.from("books").update({
    uploaded_bytes: progress.uploadedBytes,
    ingestion_status: progress.state === "complete" ? "complete" : progress.state === "error" ? "failed" : "paused",
  }).eq("id", bookId);
  emit();
  return progress;
}
