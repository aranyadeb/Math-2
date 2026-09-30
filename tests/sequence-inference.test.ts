import { describe, it, expect } from "vitest";
import { inferSequence, stepLabel, applyPattern, planMappingSamples, fromRoman, type MappingEntry } from "@/lib/books/sequence-inference";

const e = (i: number, label: string | null, source: MappingEntry["mapping_source"] = null, conf: number | null = null): MappingEntry =>
  ({ pdf_page_index: i, page_label: label, chapter_label: null, mapping_source: source, mapping_confidence: conf });

describe("sequence inference", () => {
  it("fills a gap between consistent anchors", () => {
    const out = inferSequence([e(185, "4.31", "ai_visual", 0.99), e(186, null), e(187, "4.33", "ai_visual", 0.99)]);
    expect(out[1]).toMatchObject({ page_label: "4.32", mapping_source: "sequence_inferred", chapter_label: "4" });
  });
  it("does not infer across chapter resets", () => {
    const out = inferSequence([e(10, "4.40", "ai_visual", 0.99), e(11, null), e(12, "5.1", "ai_visual", 0.99)]);
    expect(out[1].page_label).toBeNull();
  });
  it("does not infer when the step is inconsistent", () => {
    const out = inferSequence([e(10, "20", "ai_visual", 0.99), e(11, null), e(12, "25", "ai_visual", 0.99)]);
    expect(out[1].page_label).toBeNull();
  });
  it("never overwrites manual labels", () => {
    const out = inferSequence([e(1, "1", "manual", 1), e(2, "X", "manual", 1), e(3, "3", "manual", 1)]);
    expect(out[1].page_label).toBe("X");
  });
  it("steps roman numerals and patterns", () => {
    expect(stepLabel("xiv", 1)).toBe("xv");
    expect(stepLabel("4.9", 1)).toBe("4.10");
    expect(fromRoman("xiv")).toBe(14);
    expect(applyPattern(157, 159, "4.1").map((x) => x.page_label)).toEqual(["4.1", "4.2", "4.3"]);
  });
  it("plans sparse samples", () => {
    const plan = planMappingSamples([], 900, { sampleEvery: 10, maxBatch: 200 });
    expect(plan.length).toBeLessThanOrEqual(91);
    expect(plan[0]).toBe(1);
  });
});
