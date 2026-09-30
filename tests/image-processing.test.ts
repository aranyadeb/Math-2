import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { headerFooterStrip } from "@/lib/ai/detect-page-label";
import { cropRegion, stackSegments } from "@/lib/questions/crop";
import { estimateStorageBytes, formatBytes } from "@/lib/books/image-compression";

async function page(w = 1400, h = 1980) {
  return sharp({ create: { width: w, height: h, channels: 3, background: "#ffffff" } }).webp().toBuffer();
}

describe("server image processing", () => {
  it("builds a compact header+footer strip for page-label detection", async () => {
    const out = await headerFooterStrip(await page());
    const m = await sharp(out).metadata();
    expect(m.format).toBe("webp");
    expect(m.width).toBe(1000);
    expect(m.height!).toBeLessThan(400); // two 12% strips, downscaled
    const full = await sharp(await headerFooterStrip(await page(), "full")).metadata();
    expect(full.width).toBe(900);
  });

  it("crops a normalised bbox and stacks continuation segments", async () => {
    const img = await page(1000, 1000);
    const a = await cropRegion(img, { x: 0.1, y: 0.8, width: 0.8, height: 0.2 });
    const b = await cropRegion(img, { x: 0.1, y: 0, width: 0.6, height: 0.1 });
    const ma = await sharp(a).metadata();
    expect(ma.width).toBeGreaterThanOrEqual(800);
    expect(ma.height).toBeLessThanOrEqual(212);
    const stacked = await sharp(await stackSegments([a, b])).metadata();
    expect(stacked.height).toBe(ma.height! + (await sharp(b).metadata()).height! + 16);
  });

  it("estimates storage", () => {
    expect(estimateStorageBytes(900, "balanced")).toBeGreaterThan(200e6);
    expect(estimateStorageBytes(900, "economy")).toBeLessThan(estimateStorageBytes(900, "high"));
    expect(formatBytes(482 * 1024 * 1024)).toBe("482 MB");
  });
});
