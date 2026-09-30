import { describe, expect, it } from "vitest";
import { box2dToBBox, QuestionDetection } from "@/lib/ai/detect-question";

describe("question detection boxes", () => {
  it("converts Gemini box_2d [ymin, xmin, ymax, xmax] on 0..1000 to a 0..1 bbox", () => {
    const b = box2dToBBox([409, 101, 492, 701]);
    expect(b.x).toBeCloseTo(0.101);
    expect(b.y).toBeCloseTo(0.409);
    expect(b.width).toBeCloseTo(0.6);
    expect(b.height).toBeCloseTo(0.083);
  });

  it("accepts box_2d or a plain 0..1 bbox, and rejects a match with neither", () => {
    const base = { question_label: "22", continues_to_next_page: false, question_text: "22. ...", confidence: 0.9 };
    const r = QuestionDetection.parse({ matches: [{ ...base, box_2d: [400, 100, 500, 900] }, { ...base, bbox: { x: 0.1, y: 0.4, width: 0.8, height: 0.1 } }] });
    expect(r.matches[0].bbox).toEqual({ x: 0.1, y: 0.4, width: 0.8, height: 0.1 });
    expect(r.matches[1].bbox).toEqual({ x: 0.1, y: 0.4, width: 0.8, height: 0.1 });
    expect("box_2d" in r.matches[0]).toBe(false);
    expect(QuestionDetection.safeParse({ matches: [base] }).success).toBe(false);
  });
});

describe("question detection confidence", () => {
  it("clamps an out-of-range confidence instead of rejecting the match", () => {
    const m = { question_label: "22", box_2d: [400, 100, 500, 900], question_text: "" };
    const r = QuestionDetection.parse({ matches: [{ ...m, confidence: 1.98 }, { ...m, confidence: -0.2 }] });
    expect(r.matches.map((x) => x.confidence)).toEqual([1, 0]);
  });
});
