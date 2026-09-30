import { describe, it, expect, vi } from "vitest";
import { buildDocumentFromAI, GraphAIResponse } from "@/lib/graph/ai-pipeline";
import { deterministicFollowUp } from "@/lib/graph/followups";
import { applyPatch } from "@/lib/graph/validation";
import { emptyCommand } from "@/lib/commands/schema";
import { GraphDocument } from "@/lib/graph/schema";
import { compileExpression } from "@/lib/graph/parser";

const resp = (objects: unknown[], extra: Record<string, unknown> = {}) =>
  GraphAIResponse.parse({ questionSummary: "q", confidence: 0.95, viewport: { xMin: -5, xMax: 5, yMin: -10, yMax: 10 }, objects, explanation: "e", ...extra });

describe("AI graph pipeline", () => {
  it("accepts a valid response unchanged", async () => {
    const r = await buildDocumentFromAI(resp([{ type: "function", id: "f", expression: "x^3 - 3*x + 1", group: "essential" }]), {}, null);
    expect(r.document.objects).toHaveLength(1);
    expect(r.dropped).toHaveLength(0);
  });

  it("adds missing sliders for parameters deterministically (Acceptance 97)", async () => {
    const r = await buildDocumentFromAI(resp([{ type: "function", id: "f", expression: "x^2 + a*x + 1" }]), {}, null);
    expect(r.document.objects.some((o) => o.type === "slider" && o.name === "a")).toBe(true);
    expect(r.autoFixes[0]).toMatch(/slider/);
  });

  it("repairs ONLY the invalid object, bounded retries", async () => {
    const repair = vi.fn(async (obj: unknown) => ({ ...(obj as object), expression: "x^2" }));
    const r = await buildDocumentFromAI(resp([
      { type: "function", id: "ok", expression: "sin(x)" },
      { type: "function", id: "bad", expression: "x^^2" },
    ]), {}, repair);
    expect(repair).toHaveBeenCalledTimes(1);
    expect((repair.mock.calls[0][0] as { id: string }).id).toBe("bad");
    expect(r.document.objects.map((o) => o.id).sort()).toEqual(["bad", "ok"]);
  });

  it("drops objects that cannot be repaired, and their dependents", async () => {
    const repair = vi.fn(async () => null);
    const r = await buildDocumentFromAI(resp([
      { type: "function", id: "f", expression: "eval('x')" },
      { type: "tangent", id: "t", functionRef: "f", at: 1 },
      { type: "function", id: "g", expression: "x" },
    ]), {}, repair);
    expect(r.document.objects.map((o) => o.id)).toEqual(["g"]);
    expect(r.dropped.length).toBeGreaterThanOrEqual(2);
  });

  it("never loops forever on a repair that keeps failing", async () => {
    const repair = vi.fn(async (obj: unknown) => obj);
    await buildDocumentFromAI(resp([{ type: "function", id: "f", expression: "x^^2" }]), {}, repair, { maxRepairRounds: 2 });
    expect(repair.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("falls back to a computed viewport when the model's is invalid", async () => {
    const r = await buildDocumentFromAI(resp([{ type: "function", id: "f", expression: "x^2" }], { viewport: { xMin: 1, xMax: 0 } }), {}, null);
    expect(r.document.viewport.xMax).toBeGreaterThan(r.document.viewport.xMin);
  });
});

describe("deterministic follow-ups", () => {
  const d = GraphDocument.parse({
    version: 1, viewport: { xMin: -3, xMax: 3, yMin: -5, yMax: 5 },
    objects: [{ type: "function", id: "f", expression: "x^3 - 3*x", displayLatex: "f(x)=x^3-3x", source: "question" }],
  });

  it("derivative computed by math.js (Acceptance 93)", () => {
    const r = deterministicFollowUp(d, { ...emptyCommand("SHOW_DERIVATIVE") })!;
    const next = applyPatch(d, r.patch);
    const df = next.objects.find((o) => o.id === "df") as { expression: string; source: string };
    expect(df.source).toBe("derived");
    const c = compileExpression(df.expression, ["x"]);
    expect(c.evaluate({ x: 2 })).toBe(9);
  });

  it("second derivative, tangent, remove, essential-only", () => {
    let doc = applyPatch(d, deterministicFollowUp(d, emptyCommand("SHOW_SECOND_DERIVATIVE"))!.patch);
    const d2 = doc.objects.find((o) => /Second derivative/.test(o.derivation ?? "")) as { expression: string };
    expect(compileExpression(d2.expression, ["x"]).evaluate({ x: 2 })).toBe(12);
    doc = applyPatch(doc, deterministicFollowUp(doc, { ...emptyCommand("SHOW_TANGENT"), x_value: "2" })!.patch);
    expect(doc.objects.some((o) => o.type === "tangent" && o.at === 2)).toBe(true);
    doc = applyPatch(doc, deterministicFollowUp(doc, { ...emptyCommand("REMOVE_GRAPH"), target: "second derivative" })!.patch);
    expect(doc.objects.some((o) => /Second derivative/.test(o.derivation ?? ""))).toBe(false);
    doc = applyPatch(doc, deterministicFollowUp(doc, emptyCommand("SHOW_ONLY_ESSENTIAL"))!.patch);
    expect(doc.groups.filter((g) => g.visible).map((g) => g.id)).toEqual(["essential"]);
  });

  it("returns null for requests needing the model", () => {
    expect(deterministicFollowUp(d, emptyCommand("EXPLAIN"))).toBeNull();
  });
});
