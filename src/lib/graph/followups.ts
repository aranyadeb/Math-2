import type { ParsedCommand } from "../commands/schema";
import { symbolicDerivative } from "./math/derivative";
import type { GraphDocument, GraphObject, GraphPatch } from "./schema";
import { uniqueId } from "./serializer";

type Fn = Extract<GraphObject, { type: "function" }>;

/** The "main" function of a document: first essential function from the question. */
export function primaryFunction(doc: GraphDocument): Fn | null {
  const fns = doc.objects.filter((o): o is Fn => o.type === "function");
  return fns.find((f) => f.source === "question" && f.group === "essential") ?? fns.find((f) => f.source !== "derived") ?? fns[0] ?? null;
}

/** Human-friendly display of a math.js expression ("6 * x" -> "6x", "x ^ 2" -> "x^2"). */
export function prettyExpr(expr: string): string {
  return expr
    .replace(/(\d)\s*\*\s*([a-zA-Z(])/g, "$1$2")
    .replace(/\s*\*\s*/g, "·")
    .replace(/\s*\^\s*/g, "^");
}

function nameOf(f: Fn): string {
  const m = /^([A-Za-z]\w*)\s*\(/.exec(f.displayLatex ?? "");
  return m ? m[1] : f.id;
}

function findTarget(doc: GraphDocument, target: string): GraphObject[] {
  const t = target.toLowerCase().replace(/\b(graph|curve|the|of|please|too|also)\b/g, "").trim();
  if (!t) return [];
  const byWords = (o: GraphObject) => {
    const hay = `${o.id} ${o.label ?? ""} ${o.displayLatex ?? ""} ${o.derivation ?? ""} ${o.type.replace(/_/g, " ")}`.toLowerCase();
    return hay.includes(t);
  };
  if (/second derivative/.test(t)) return doc.objects.filter((o) => /second derivative/i.test(o.derivation ?? "") || /''/.test(o.displayLatex ?? ""));
  if (/derivative/.test(t)) return doc.objects.filter((o) => /derivative/i.test(o.derivation ?? "") && !/second/i.test(o.derivation ?? ""));
  if (/tangent/.test(t)) return doc.objects.filter((o) => o.type === "tangent");
  if (/normal/.test(t)) return doc.objects.filter((o) => o.type === "normal");
  if (/integral|area/.test(t)) return doc.objects.filter((o) => o.type === "integral" || o.type === "area_between_curves");
  return doc.objects.filter(byWords);
}

export interface DeterministicFollowUp {
  patch: GraphPatch;
  reply: string;
}

/**
 * Handle simple follow-ups locally (no AI): derivatives via math.js,
 * tangents/normals at a given x, removals, group visibility, slider ranges.
 * Returns null when the request needs the model.
 */
export function deterministicFollowUp(doc: GraphDocument, cmd: ParsedCommand): DeterministicFollowUp | null {
  const f = primaryFunction(doc);
  switch (cmd.intent) {
    case "SHOW_DERIVATIVE":
    case "SHOW_SECOND_DERIVATIVE": {
      if (!f) return null;
      const d1 = symbolicDerivative(f.expression, f.variable ?? "x");
      if (!d1) return null;
      const second = cmd.intent === "SHOW_SECOND_DERIVATIVE";
      const expr = second ? symbolicDerivative(d1) : d1;
      if (!expr) return null;
      const n = nameOf(f);
      const already = doc.objects.find((o) => o.type === "function" && o.derivation === (second ? `Second derivative of ${n}` : `Derivative of ${n}`));
      if (already) return { patch: { operations: [{ op: "set_visibility", id: already.id, visible: true }] }, reply: `Showing ${n}${second ? "''" : "'"}(x) again.` };
      const obj: GraphObject = {
        type: "function", id: uniqueId(doc, second ? `d2${f.id}` : `d${f.id}`), expression: expr, variable: "x",
        displayLatex: `${n}${second ? "''" : "'"}(x) = ${prettyExpr(expr)}`, group: "supporting", visible: true, source: "derived",
        derivation: second ? `Second derivative of ${n}` : `Derivative of ${n}`, dashed: true,
      };
      return { patch: { operations: [{ op: "add", object: obj }] }, reply: `Added ${obj.displayLatex} (computed symbolically).` };
    }
    case "SHOW_TANGENT":
    case "SHOW_NORMAL": {
      if (!f || cmd.x_value === null) return null;
      const at = Number(cmd.x_value);
      if (!Number.isFinite(at)) return null;
      const kind = cmd.intent === "SHOW_TANGENT" ? "tangent" : "normal";
      const obj: GraphObject = {
        type: kind, id: uniqueId(doc, `${kind}_${String(at).replace(/[^0-9]/g, "_")}`), functionRef: f.id, at, draggable: true,
        group: "supporting", visible: true, source: "derived", derivation: `${kind === "tangent" ? "Tangent" : "Normal"} to ${nameOf(f)} at x = ${at}`,
        label: `${kind} at x=${at}`,
      };
      return { patch: { operations: [{ op: "add", object: obj }] }, reply: `Added the ${kind} to ${nameOf(f)} at x = ${at}. Drag the point to move it.` };
    }
    case "SHOW_ONLY_ESSENTIAL":
      return {
        patch: { operations: [
          { op: "set_group_visibility", group: "essential", visible: true },
          { op: "set_group_visibility", group: "supporting", visible: false },
          { op: "set_group_visibility", group: "exploration", visible: false },
        ] },
        reply: "Showing only the essential graphs.",
      };
    case "REMOVE_GRAPH": {
      if (!cmd.target) return null;
      const targets = findTarget(doc, cmd.target);
      if (!targets.length) return null;
      const userOwned = targets.filter((o) => o.source === "user");
      const ops = targets.map((o) => ({ op: "remove" as const, id: o.id }));
      return { patch: { operations: ops }, reply: `Removed ${targets.map((o) => o.displayLatex ?? o.label ?? o.id).join(", ")}.${userOwned.length ? " (including your own entries, as requested)" : ""}` };
    }
    case "CHANGE_PARAMETER": {
      if (!cmd.parameter_name) return null;
      const s = doc.objects.find((o) => o.type === "slider" && o.name === cmd.parameter_name);
      if (s) {
        return {
          patch: { operations: [{ op: "set_slider", name: cmd.parameter_name, min: cmd.parameter_min ?? undefined, max: cmd.parameter_max ?? undefined }] },
          reply: `Slider ${cmd.parameter_name} now ranges ${cmd.parameter_min ?? (s as { min: number }).min} to ${cmd.parameter_max ?? (s as { max: number }).max}.`,
        };
      }
      const min = cmd.parameter_min ?? -5, max = cmd.parameter_max ?? 5;
      const obj: GraphObject = { type: "slider", id: uniqueId(doc, `slider_${cmd.parameter_name}`), name: cmd.parameter_name, min, max, step: (max - min) / 100, value: Math.min(max, Math.max(min, 1)), group: "exploration", visible: true, source: "derived", derivation: "Requested parameter" };
      return { patch: { operations: [{ op: "add", object: obj }] }, reply: `Added a slider for ${cmd.parameter_name} from ${min} to ${max}.` };
    }
    case "SHOW_INTERSECTION": {
      const fns = doc.objects.filter((o): o is Fn => o.type === "function" && o.visible);
      if (fns.length < 1) return null;
      const obj: GraphObject = fns.length >= 2
        ? { type: "intersection_marker", id: uniqueId(doc, "meet"), refA: fns[0].id, refB: fns[1].id, group: "supporting", visible: true, source: "derived", derivation: `Intersections of ${nameOf(fns[0])} and ${nameOf(fns[1])}` }
        : { type: "intersection_marker", id: uniqueId(doc, "roots"), refA: fns[0].id, group: "supporting", visible: true, source: "derived", derivation: `Roots of ${nameOf(fns[0])}` };
      return { patch: { operations: [{ op: "add", object: obj }] }, reply: fns.length >= 2 ? "Marked the intersection points (found numerically)." : "Marked the x-intercepts (found numerically)." };
    }
    default:
      return null;
  }
}
