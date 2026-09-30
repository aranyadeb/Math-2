import { classifyEntry } from "./parser";
import type { GraphDocument, GraphObject } from "./schema";
import { uniqueId } from "./serializer";

/** Convert a typed entry into a user-owned GraphObject without any AI call. */
export function objectFromEntry(doc: GraphDocument, raw: string): { ok: true; object: GraphObject } | { ok: false; reason: string } {
  const params = doc.objects.filter((o) => o.type === "slider").map((o) => (o as Extract<GraphObject, { type: "slider" }>).name);
  const c = classifyEntry(raw, params);
  const common = { group: "exploration" as const, visible: true, source: "user" as const, displayLatex: raw.trim() };
  switch (c.kind) {
    case "function":
      return { ok: true, object: { ...common, type: "function", id: uniqueId(doc, c.name ?? "u"), expression: c.expression, variable: "x" } };
    case "implicit":
      return { ok: true, object: { ...common, type: "implicit_curve", id: uniqueId(doc, "implicit"), expression: c.expression } };
    case "vertical_line":
      return { ok: true, object: { ...common, type: "vertical_line", id: uniqueId(doc, "vline"), x: c.x } };
    case "horizontal_line":
      return { ok: true, object: { ...common, type: "horizontal_line", id: uniqueId(doc, "hline"), y: c.y } };
    case "polar":
      return { ok: true, object: { ...common, type: "polar_curve", id: uniqueId(doc, "polar"), expression: c.expression, parameter: "theta", min: 0, max: "2*pi" } };
    case "inequality":
      return { ok: true, object: { ...common, type: "inequality_region", id: uniqueId(doc, "region"), expression: c.expression, operator: c.operator, variable: c.variable } };
    case "point":
      return { ok: true, object: { ...common, type: "point", id: uniqueId(doc, "pt"), x: c.x, y: c.y } };
    default:
      return { ok: false, reason: c.reason };
  }
}
