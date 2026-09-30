export type QualityPreset = "economy" | "balanced" | "high";

export interface QualitySettings {
  /** Target width in CSS px for the full page image. */
  maxWidth: number;
  /** WebP quality 0..1 */
  quality: number;
  thumbWidth: number;
  thumbQuality: number;
  /** Rough average bytes per page for a scanned maths page (used by the estimator). */
  estBytesPerPage: number;
}

// Empirically, 1400px wide WebP at q≈0.72 keeps exponents, subscripts and minus
// signs legible on dense scanned maths pages while averaging ~180–300 KB/page.
export const QUALITY_PRESETS: Record<QualityPreset, QualitySettings> = {
  economy: { maxWidth: 1100, quality: 0.6, thumbWidth: 160, thumbQuality: 0.5, estBytesPerPage: 140_000 },
  balanced: { maxWidth: 1400, quality: 0.72, thumbWidth: 180, thumbQuality: 0.55, estBytesPerPage: 240_000 },
  high: { maxWidth: 1900, quality: 0.85, thumbWidth: 200, thumbQuality: 0.6, estBytesPerPage: 480_000 },
};

export function estimateStorageBytes(pageCount: number, preset: QualityPreset, measuredAvg?: number): number {
  const s = QUALITY_PRESETS[preset];
  const per = measuredAvg && measuredAvg > 0 ? measuredAvg : s.estBytesPerPage;
  const thumb = 8_000;
  return Math.round(pageCount * (per + thumb));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Browser-only: encode a canvas as WebP (falls back to JPEG where WebP encoding is unsupported, e.g. old Safari). */
export async function canvasToImageBlob(canvas: HTMLCanvasElement, quality: number): Promise<{ blob: Blob; ext: "webp" | "jpg" }> {
  const webp = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", quality));
  if (webp && webp.type === "image/webp") return { blob: webp, ext: "webp" };
  const jpg = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
  if (!jpg) throw new Error("Could not encode page image");
  return { blob: jpg, ext: "jpg" };
}

export function scaledCanvas(src: HTMLCanvasElement, width: number): HTMLCanvasElement {
  const ratio = width / src.width;
  const c = document.createElement("canvas");
  c.width = Math.round(width);
  c.height = Math.round(src.height * ratio);
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
