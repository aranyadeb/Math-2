import { compileExpression, evalNum, ExpressionError, implicitToZeroForm } from "./parser";
import { GraphDocument, GraphObject, GraphPatch, type NumOrExpr } from "./schema";

export interface ValidationIssue {
  objectId: string | null;
  message: string;
}

const REF_TYPES = new Set(["function"]);

/**
 * Semantic validation after Zod: every expression parses with the whitelist,
 * every reference points at an existing object of the right type, ids are
 * unique, constant fields evaluate to finite numbers, slider ranges are sane.
 */
export function validateDocument(doc: GraphDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  const byId = new Map<string, GraphObject>();
  const sliders = doc.objects.filter((o) => o.type === "slider").map((o) => (o as Extract<GraphObject, { type: "slider" }>).name);
  const sliderScope = Object.fromEntries(
    doc.objects.filter((o) => o.type === "slider").map((o) => [(o as Extract<GraphObject, { type: "slider" }>).name, (o as Extract<GraphObject, { type: "slider" }>).value]),
  );

  for (const o of doc.objects) {
    if (ids.has(o.id)) issues.push({ objectId: o.id, message: `Duplicate object id "${o.id}"` });
    ids.add(o.id);
    byId.set(o.id, o);
  }

  const num = (o: GraphObject, field: string, v: NumOrExpr | undefined) => {
    if (v === undefined) return;
    try {
      const n = evalNum(v, sliderScope);
      if (!Number.isFinite(n)) issues.push({ objectId: o.id, message: `${field} does not evaluate to a finite number` });
    } catch (e) {
      issues.push({ objectId: o.id, message: `${field}: ${(e as Error).message}` });
    }
  };
  const expr = (o: GraphObject, field: string, e: string, vars: string[]) => {
    try {
      compileExpression(e, [...vars, ...sliders]);
    } catch (err) {
      issues.push({ objectId: o.id, message: `${field}: ${err instanceof ExpressionError ? err.message : String(err)}` });
    }
  };
  const ref = (o: GraphObject, field: string, id: string | undefined) => {
    if (!id) return;
    const t = byId.get(id);
    if (!t) issues.push({ objectId: o.id, message: `${field} refers to missing object "${id}"` });
    else if (!REF_TYPES.has(t.type)) issues.push({ objectId: o.id, message: `${field} must refer to a function, "${id}" is ${t.type}` });
  };

  for (const o of doc.objects) {
    switch (o.type) {
      case "function":
        expr(o, "expression", o.expression, [o.variable ?? "x"]);
        if (o.domain) { num(o, "domain.min", o.domain.min); num(o, "domain.max", o.domain.max); }
        break;
      case "implicit_curve":
        try { expr(o, "expression", implicitToZeroForm(o.expression), ["x", "y"]); }
        catch (e) { issues.push({ objectId: o.id, message: (e as Error).message }); }
        break;
      case "parametric_curve":
        expr(o, "xExpression", o.xExpression, [o.parameter]);
        expr(o, "yExpression", o.yExpression, [o.parameter]);
        num(o, "min", o.min); num(o, "max", o.max);
        break;
      case "polar_curve":
        expr(o, "expression", o.expression, [o.parameter]);
        num(o, "min", o.min); num(o, "max", o.max);
        break;
      case "point": case "text_annotation":
        num(o, "x", o.x); num(o, "y", o.y);
        break;
      case "movable_point":
        ref(o, "onFunctionRef", o.onFunctionRef);
        break;
      case "line": case "segment": case "ray":
        num(o, "p1.x", o.p1[0]); num(o, "p1.y", o.p1[1]); num(o, "p2.x", o.p2[0]); num(o, "p2.y", o.p2[1]);
        break;
      case "vertical_line": num(o, "x", o.x); break;
      case "horizontal_line": num(o, "y", o.y); break;
      case "tangent": case "normal":
        ref(o, "functionRef", o.functionRef); num(o, "at", o.at);
        break;
      case "integral":
        ref(o, "functionRef", o.functionRef); num(o, "lower", o.lower); num(o, "upper", o.upper);
        break;
      case "area_between_curves":
        ref(o, "upperRef", o.upperRef); ref(o, "lowerRef", o.lowerRef); num(o, "from", o.from); num(o, "to", o.to);
        break;
      case "inequality_region":
        expr(o, "expression", o.expression, [o.variable === "y" ? "x" : "y"]);
        break;
      case "slider":
        if (o.max <= o.min) issues.push({ objectId: o.id, message: "slider max must exceed min" });
        if (o.value < o.min || o.value > o.max) issues.push({ objectId: o.id, message: "slider value outside range" });
        break;
      case "intersection_marker":
        ref(o, "refA", o.refA); ref(o, "refB", o.refB); num(o, "from", o.from); num(o, "to", o.to);
        break;
      case "asymptote":
        if (o.kind === "oblique") {
          if (!o.expression) issues.push({ objectId: o.id, message: "oblique asymptote needs expression" });
          else expr(o, "expression", o.expression, ["x"]);
        } else if (o.value === undefined) issues.push({ objectId: o.id, message: `${o.kind} asymptote needs value` });
        else num(o, "value", o.value);
        break;
    }
  }
  return issues;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: ValidationIssue[] };

/** JSON → Zod → semantic validation. */
export function parseGraphDocument(raw: unknown): ParseResult<GraphDocument> {
  const r = GraphDocument.safeParse(raw);
  if (!r.success) {
    return { ok: false, errors: r.error.issues.map((i) => ({ objectId: objectIdFromPath(raw, i.path), message: `${i.path.join(".")}: ${i.message}` })) };
  }
  const issues = validateDocument(r.data);
  return issues.length ? { ok: false, errors: issues } : { ok: true, value: r.data };
}

function objectIdFromPath(raw: unknown, path: PropertyKey[]): string | null {
  if (path[0] !== "objects" || typeof path[1] !== "number") return null;
  const objs = (raw as { objects?: { id?: unknown }[] })?.objects;
  const id = objs?.[path[1]]?.id;
  return typeof id === "string" ? id : null;
}

// ---------------------------------------------------------------------------
// Patch application
// ---------------------------------------------------------------------------
export class PatchError extends Error {}

/**
 * Apply a validated patch immutably. User-created objects are never removed
 * or altered unless `allowUserChanges` (the user explicitly asked).
 */
export function applyPatch(doc: GraphDocument, patch: GraphPatch, opts: { allowUserChanges?: boolean } = {}): GraphDocument {
  const parsed = GraphPatch.parse(patch);
  let objects = doc.objects.map((o) => ({ ...o })) as GraphObject[];
  let groups = doc.groups.map((g) => ({ ...g }));
  let viewport = { ...doc.viewport };
  const find = (id: string) => objects.find((o) => o.id === id);
  const guardUser = (o: GraphObject) => {
    if (o.source === "user" && !opts.allowUserChanges) throw new PatchError(`Refusing to modify user-created object "${o.id}"`);
  };

  for (const op of parsed.operations) {
    switch (op.op) {
      case "add": {
        if (find(op.object.id)) {
          // Adding an existing id = replace (unless user-owned)
          const existing = find(op.object.id)!;
          guardUser(existing);
          objects = objects.map((o) => (o.id === op.object.id ? op.object : o));
        } else objects.push(op.object);
        break;
      }
      case "remove": {
        const o = find(op.id);
        if (!o) throw new PatchError(`Cannot remove missing object "${op.id}"`);
        guardUser(o);
        objects = objects.filter((x) => x.id !== op.id);
        break;
      }
      case "update": {
        const o = find(op.id);
        if (!o) throw new PatchError(`Cannot update missing object "${op.id}"`);
        guardUser(o);
        const { id: _i, type: _t, ...changes } = op.changes as Record<string, unknown>;
        void _i; void _t;
        const merged = GraphObject.safeParse({ ...o, ...changes });
        if (!merged.success) throw new PatchError(`Invalid update for "${op.id}": ${merged.error.issues[0]?.message}`);
        objects = objects.map((x) => (x.id === op.id ? merged.data : x));
        break;
      }
      case "set_visibility": {
        const o = find(op.id);
        if (!o) throw new PatchError(`Cannot change visibility of missing object "${op.id}"`);
        objects = objects.map((x) => (x.id === op.id ? { ...x, visible: op.visible } : x));
        break;
      }
      case "set_group_visibility":
        groups = groups.map((g) => (g.id === op.group ? { ...g, visible: op.visible } : g));
        break;
      case "set_slider": {
        const s = objects.find((o) => o.type === "slider" && o.name === op.name) as Extract<GraphObject, { type: "slider" }> | undefined;
        if (!s) throw new PatchError(`No slider named "${op.name}"`);
        const next = { ...s };
        if (op.min !== undefined) next.min = op.min;
        if (op.max !== undefined) next.max = op.max;
        if (op.step !== undefined) next.step = op.step;
        if (op.value !== undefined) next.value = op.value;
        next.value = Math.min(next.max, Math.max(next.min, next.value));
        objects = objects.map((o) => (o.id === s.id ? next : o));
        break;
      }
      case "set_viewport":
        viewport = { ...op.viewport };
        break;
    }
  }
  const next: GraphDocument = { ...doc, objects, groups, viewport };
  const issues = validateDocument(next);
  if (issues.length) throw new PatchError(issues.map((i) => `${i.objectId ?? "document"}: ${i.message}`).join("; "));
  return next;
}

/** Remove all objects referencing a removed id (e.g. tangent of deleted f). */
export function dependentsOf(doc: GraphDocument, id: string): string[] {
  return doc.objects
    .filter((o) => {
      const r = o as Record<string, unknown>;
      return ["functionRef", "upperRef", "lowerRef", "refA", "refB", "onFunctionRef"].some((k) => r[k] === id);
    })
    .map((o) => o.id);
}
