import "server-only";
import sharp from "sharp";
import type { BBox } from "../supabase/types";

const PAD = 0.012;

/** Crop a normalised bbox (with a little padding) from a page image. */
export async function cropRegion(image: Buffer, bbox: BBox): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  const W = meta.width ?? 1, H = meta.height ?? 1;
  const x0 = Math.max(0, bbox.x - PAD), y0 = Math.max(0, bbox.y - PAD);
  const x1 = Math.min(1, bbox.x + bbox.width + PAD), y1 = Math.min(1, bbox.y + bbox.height + PAD);
  const left = Math.floor(x0 * W), top = Math.floor(y0 * H);
  const width = Math.max(1, Math.min(W - left, Math.ceil((x1 - x0) * W)));
  const height = Math.max(1, Math.min(H - top, Math.ceil((y1 - y0) * H)));
  return sharp(image).extract({ left, top, width, height }).png().toBuffer();
}

/** Stack the question's segments vertically (page N bottom + page N+1 top) into one logical image. */
export async function stackSegments(segments: Buffer[]): Promise<Buffer> {
  if (segments.length === 1) return sharp(segments[0]).webp({ quality: 85 }).toBuffer();
  const metas = await Promise.all(segments.map((s) => sharp(s).metadata()));
  const width = Math.max(...metas.map((m) => m.width ?? 1));
  const gap = 16;
  const height = metas.reduce((a, m) => a + (m.height ?? 1), 0) + gap * (segments.length - 1);
  let top = 0;
  const composite = segments.map((s, i) => {
    const c = { input: s, top, left: 0 };
    top += (metas[i].height ?? 1) + gap;
    return c;
  });
  return sharp({ create: { width, height, channels: 3, background: "#ffffff" } }).composite(composite).webp({ quality: 85 }).toBuffer();
}
