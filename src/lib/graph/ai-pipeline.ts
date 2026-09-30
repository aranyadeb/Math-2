import { z } from "zod";
import { freeSymbols, implicitToZeroForm } from "./parser";
import { DEFAULT_GROUPS, GraphDocument, GraphObject, Viewport } from "./schema";
import { validateDocument, type ValidationIssue } from "./validation";
import { compileExpression } from "./parser";
import { suggestYRange } from "./math/sampling";

/** Loose envelope for the model's graph response; objects are validated individually. */
export const GraphAIResponse = z.object({
  questionSummary: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.5),
  needsReasoningFallback: z.boolean().default(false),
  viewport: z.unknown().optional(),
  objects: z.array(z.unknown()).max(60).default([]),
  explanation: z.string().default(""),
  solutionConnection: z.string().default(""),
  solution: z.string().nullable().optional().default(null),
});
export type GraphAIResponse = z.infer<typeof GraphAIResponse>;

export type RepairFn = (object: unknown, error: string, otherIds: string[]) => Promise<unknown | null>;

export interface PipelineResult {
  document: GraphDocument;
  dropped: { object: unknown; error: string }[];
  repaired: string[];
  autoFixes: string[];
}

const RESERVED = new Set(["x", "y", "t", "theta", "r"]);

/**
 * Deterministic fixes before any AI repair:
 * - free parameters without a slider get one (so y = x^2 + a x + 1 works)
 * - "|x|" etc. are normalised by the parser itself
 */
function autoFix(objects: GraphObject[], fixes: string[]): GraphObject[] {
  const sliderNames = new Set(objects.filter((o) => o.type === "slider").map((o) => (o as Extract<GraphObject, { type: "slider" }>).name));
  const needed = new Set<string>();
  const exprs = (o: GraphObject): string[] => {
    switch (o.type) {
      case "function": case "polar_curve": case "inequality_region": return [o.expression];
      case "implicit_curve": return [implicitToZeroForm(o.expression)];
      case "parametric_curve": return [o.xExpression, o.yExpression];
      default: return [];
    }
  };
  for (const o of objects) {
    for (const e of exprs(o)) {
      try {
        for (const s of freeSymbols(e)) if (!RESERVED.has(s) && /^[a-zA-Z]$|^[a-z][a-z0-9_]*$/.test(s) && s.length <= 6 && !sliderNames.has(s)) needed.add(s);
      } catch { /* parse errors handled by validation */ }
    }
  }
  const out = [...objects];
  for (const name of needed) {
    // Only add sliders for symbols that aren't function-like words
    if (["sin", "cos", "tan", "log", "exp", "sqrt", "abs", "pi", "e"].includes(name)) continue;
    out.push(GraphObject.parse({ type: "slider", id: `slider_${name}`, name, min: -5, max: 5, step: 0.1, value: 1, group: "exploration", source: "derived", derivation: `Parameter ${name} appears in the question` }));
    fixes.push(`Added slider for parameter "${name}"`);
  }
  return out;
}

export function fallbackViewport(objects: GraphObject[]): Viewport {
  const fns = objects.filter((o) => o.type === "function").map((o) => {
    try {
      const c = compileExpression((o as Extract<GraphObject, { type: "function" }>).expression, ["x"]);
      return (x: number) => c.evaluate({ x });
    } catch {
      return () => NaN;
    }
  });
  const xMin = -10, xMax = 10;
  const { yMin, yMax } = fns.length ? suggestYRange(fns, xMin, xMax) : { yMin: -7, yMax: 7 };
  return { xMin, xMax, yMin, yMax };
}

/**
 * Model response → Zod per object → deterministic fixes → semantic validation
 * → targeted repair of ONLY invalid objects (bounded) → drop what still fails.
 */
export async function buildDocumentFromAI(
  response: GraphAIResponse,
  meta: GraphDocument["metadata"],
  repair: RepairFn | null,
  opts: { maxRepairRounds?: number; maxRepairs?: number } = {},
): Promise<PipelineResult> {
  const maxRounds = opts.maxRepairRounds ?? 2;
  let repairBudget = opts.maxRepairs ?? 6;
  const dropped: PipelineResult["dropped"] = [];
  const repaired: string[] = [];
  const autoFixes: string[] = [];

  const vp = Viewport.safeParse(response.viewport);
  let pending: { raw: unknown; error: string | null }[] = response.objects.map((raw) => ({ raw, error: null }));
  let valid: GraphObject[] = [];

  for (let round = 0; round <= maxRounds; round++) {
    const invalid: { raw: unknown; error: string }[] = [];
    for (const p of pending) {
      const r = GraphObject.safeParse(p.raw);
      if (r.success) valid.push(r.data);
      else invalid.push({ raw: p.raw, error: r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    }
    // de-duplicate ids (keep first)
    const seen = new Set<string>();
    valid = valid.filter((o) => (seen.has(o.id) ? (invalid.push({ raw: o, error: `duplicate id "${o.id}"` }), false) : (seen.add(o.id), true)));
    if (round === 0) valid = autoFix(valid, autoFixes);

    const doc: GraphDocument = { version: 1, viewport: vp.success ? vp.data : fallbackViewport(valid), objects: valid, groups: DEFAULT_GROUPS.map((g) => ({ ...g })), metadata: meta };
    const issues = validateDocument(doc);
    const badIds = new Set(issues.map((i) => i.objectId).filter(Boolean) as string[]);
    const semanticallyBad = valid.filter((o) => badIds.has(o.id)).map((o) => ({ raw: o as unknown, error: issueText(issues, o.id) }));
    valid = valid.filter((o) => !badIds.has(o.id));
    const toFix = [...invalid, ...semanticallyBad];
    if (!toFix.length) break;

    if (!repair || round === maxRounds) {
      dropped.push(...toFix.map((t) => ({ object: t.raw, error: t.error })));
      break;
    }
    pending = [];
    for (const t of toFix) {
      if (repairBudget <= 0) { dropped.push({ object: t.raw, error: t.error }); continue; }
      repairBudget--;
      const fixed = await repair(t.raw, t.error, valid.map((o) => o.id)).catch(() => null);
      if (fixed) {
        pending.push({ raw: fixed, error: null });
        const id = (fixed as { id?: string }).id;
        if (id) repaired.push(id);
      } else dropped.push({ object: t.raw, error: t.error });
    }
    if (!pending.length) break;
  }

  // Drop dependents of dropped functions (e.g. tangent to an invalid f).
  let changed = true;
  while (changed) {
    changed = false;
    const doc: GraphDocument = { version: 1, viewport: vp.success ? vp.data : fallbackViewport(valid), objects: valid, groups: DEFAULT_GROUPS.map((g) => ({ ...g })), metadata: meta };
    const issues = validateDocument(doc);
    if (issues.length) {
      const bad = new Set(issues.map((i) => i.objectId));
      for (const o of valid) if (bad.has(o.id)) dropped.push({ object: o, error: issueText(issues, o.id) });
      valid = valid.filter((o) => !bad.has(o.id));
      changed = valid.length > 0 && issues.length > 0;
    }
  }

  const document = GraphDocument.parse({
    version: 1,
    viewport: vp.success ? vp.data : fallbackViewport(valid),
    objects: valid,
    groups: DEFAULT_GROUPS,
    metadata: meta,
  });
  return { document, dropped, repaired, autoFixes };
}

function issueText(issues: ValidationIssue[], id: string): string {
  return issues.filter((i) => i.objectId === id).map((i) => i.message).join("; ");
}
