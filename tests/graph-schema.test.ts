import { describe, it, expect } from "vitest";
import { GraphDocument, GraphObject, GraphPatch, emptyDocument } from "@/lib/graph/schema";
import { applyPatch, parseGraphDocument, validateDocument, PatchError } from "@/lib/graph/validation";
import { mergeLiveState, restoreGraphDocument, serializeGraphDocument } from "@/lib/graph/serializer";
import { upgradeGraphDocument } from "@/lib/graph/versioning";
import { objectFromEntry } from "@/lib/graph/manual-entry";

const doc = (objects: unknown[]): GraphDocument => GraphDocument.parse({ version: 1, viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }, objects });

describe("GraphDocument schema", () => {
  it("accepts every required object type (acceptance math cases)", () => {
    const d = doc([
      { type: "function", id: "f", expression: "x^2" },
      { type: "function", id: "recip", expression: "1/x" },
      { type: "function", id: "absx", expression: "abs(x)" },
      { type: "implicit_curve", id: "circle", expression: "x^2 + y^2 = 25" },
      { type: "implicit_curve", id: "ellipse", expression: "x^2/9 + y^2/4 = 1" },
      { type: "parametric_curve", id: "cyc", xExpression: "t - sin(t)", yExpression: "1 - cos(t)", parameter: "t", min: 0, max: "2*pi" },
      { type: "polar_curve", id: "card", expression: "1 + cos(theta)" },
      { type: "integral", id: "area1", functionRef: "f", lower: 0, upper: 2, showValue: true, draggableBounds: true },
      { type: "function", id: "g", expression: "x" },
      { type: "area_between_curves", id: "ab", upperRef: "g", lowerRef: "f", from: 0, to: 1 },
      { type: "slider", id: "sa", name: "a", min: -10, max: 10, step: 0.1, value: 1 },
      { type: "function", id: "fam", expression: "x^2 + a*x + 1" },
      { type: "tangent", id: "t2", functionRef: "f", at: 2 },
      { type: "normal", id: "n2", functionRef: "f", at: 2 },
      { type: "point", id: "p", x: 1, y: "sqrt(2)" },
      { type: "movable_point", id: "mp", x: 1, y: 1, onFunctionRef: "f" },
      { type: "line", id: "l", p1: [0, 0], p2: [1, 1] },
      { type: "segment", id: "s", p1: [0, 0], p2: [1, 1] },
      { type: "ray", id: "r", p1: [0, 0], p2: [1, 1] },
      { type: "vertical_line", id: "vx", x: 2 },
      { type: "horizontal_line", id: "hy", y: 0 },
      { type: "inequality_region", id: "ineq", expression: "x^2", operator: ">=" },
      { type: "text_annotation", id: "txt", x: 0, y: 0, text: "hello" },
      { type: "intersection_marker", id: "im", refA: "f", refB: "g" },
      { type: "asymptote", id: "as", kind: "vertical", value: 0 },
    ]);
    expect(validateDocument(d)).toEqual([]);
    expect(d.objects.find((o) => o.id === "f")!.group).toBe("essential");
  });

  it("rejects script-like or unknown objects", () => {
    expect(GraphObject.safeParse({ type: "javascript", id: "x", code: "board.create()" }).success).toBe(false);
    expect(GraphObject.safeParse({ type: "function", id: "bad id!", expression: "x" }).success).toBe(false);
  });

  it("semantic validation catches bad refs, unknown symbols, unsafe functions", () => {
    const d = doc([
      { type: "function", id: "f", expression: "x^2 + k" },
      { type: "tangent", id: "t", functionRef: "nope", at: 1 },
      { type: "function", id: "h", expression: "import(x)" },
    ]);
    const msgs = validateDocument(d).map((i) => `${i.objectId}: ${i.message}`).join("\n");
    expect(msgs).toMatch(/f: .*Unknown symbol "k"/);
    expect(msgs).toMatch(/t: .*missing object "nope"/);
    expect(msgs).toMatch(/h: .*not allowed/);
  });

  it("parseGraphDocument pipeline rejects invalid AI output", () => {
    expect(parseGraphDocument({ version: 1, viewport: { xMin: 5, xMax: -5, yMin: 0, yMax: 1 }, objects: [] }).ok).toBe(false);
    expect(parseGraphDocument({ version: 2, viewport: { xMin: -5, xMax: 5, yMin: -1, yMax: 1 }, objects: [] }).ok).toBe(false);
  });

  it("serialization round-trips and restores slider state (cross-device restore)", () => {
    const d = doc([{ type: "slider", id: "sa", name: "a", min: -10, max: 10, step: 0.1, value: 1 }, { type: "function", id: "f", expression: "x^2 + a*x + 1" }]);
    const live = mergeLiveState(d, { params: { a: 3.5 }, viewport: { xMin: -2, xMax: 2, yMin: -1, yMax: 9 } });
    const stored = JSON.parse(JSON.stringify(serializeGraphDocument(live)));
    const restored = restoreGraphDocument(stored);
    expect((restored.objects[0] as { value: number }).value).toBe(3.5);
    expect(restored.viewport.xMax).toBe(2);
  });

  it("upgrades unversioned documents", () => {
    const d = upgradeGraphDocument({ viewport: { xMin: -1, xMax: 1, yMin: -1, yMax: 1 }, objects: [] });
    expect(d.version).toBe(1);
    expect(d.groups).toHaveLength(3);
  });
});

describe("GraphPatch", () => {
  const base = doc([
    { type: "function", id: "f", expression: "x^3 - 3*x" },
    { type: "function", id: "u", expression: "sin(x)", source: "user" },
    { type: "slider", id: "sa", name: "a", min: -1, max: 1, value: 0 },
  ]);
  it("validates patch schema", () => {
    expect(GraphPatch.safeParse({ operations: [{ op: "explode" }] }).success).toBe(false);
    expect(GraphPatch.safeParse({ operations: [{ op: "add", object: { type: "function", id: "df", expression: "3*x^2 - 3" } }] }).success).toBe(true);
  });
  it("applies add / visibility / slider ops", () => {
    const next = applyPatch(base, { operations: [
      { op: "add", object: GraphObject.parse({ type: "function", id: "df", expression: "3*x^2 - 3", source: "derived", derivation: "Derivative of f" }) },
      { op: "set_visibility", id: "f", visible: false },
      { op: "set_slider", name: "a", min: -5, max: 5, value: 7 },
    ] });
    expect(next.objects).toHaveLength(4);
    expect(next.objects.find((o) => o.id === "f")!.visible).toBe(false);
    expect(next.objects.find((o) => o.id === "sa")).toMatchObject({ min: -5, max: 5, value: 5 });
    expect(base.objects).toHaveLength(3); // immutable
  });
  it("protects user-created objects", () => {
    expect(() => applyPatch(base, { operations: [{ op: "remove", id: "u" }] })).toThrow(PatchError);
    expect(applyPatch(base, { operations: [{ op: "remove", id: "u" }] }, { allowUserChanges: true }).objects).toHaveLength(2);
  });
  it("rejects patches that leave the document invalid", () => {
    expect(() => applyPatch(base, { operations: [{ op: "add", object: GraphObject.parse({ type: "tangent", id: "t", functionRef: "zz", at: 1 }) }] })).toThrow(PatchError);
  });
});

describe("manual entry", () => {
  it("creates user objects without AI", () => {
    const d = emptyDocument();
    const r = objectFromEntry(d, "x^2 + y^2 = 25");
    expect(r.ok && r.object.type).toBe("implicit_curve");
    expect(r.ok && r.object.source).toBe("user");
    const bad = objectFromEntry(d, "z = q");
    expect(bad.ok).toBe(false);
  });
});
