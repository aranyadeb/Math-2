import type JXG from "jsxgraph";
import type { GraphDocument, GraphObject } from "../schema";
import { compileExpression, evalNum } from "../parser";

export type El = JXG.GeometryElement;

export interface RenderContext {
  board: JXG.Board;
  doc: GraphDocument;
  /** Live slider values. Mutated by the slider UI; curves read it on every update. */
  params: Record<string, number>;
  /** Evaluator for function objects by id (includes current slider values). */
  fn: (id: string) => ((x: number) => number) | null;
  /** Called when the user drags something that should persist (debounced by the caller). */
  onObjectChange: (id: string, changes: Record<string, unknown>) => void;
  /** Non-fatal render problems surfaced to the UI. */
  warn: (id: string, message: string) => void;
  colorFor: (obj: GraphObject) => string;
  /** Elements already rendered for another object (render order follows dependencies). */
  elementsOf: (id: string) => El[];
  dark: boolean;
}

export type Renderer<T extends GraphObject = GraphObject> = (ctx: RenderContext, obj: T) => El[];

export function create(board: JXG.Board, type: string, parents: unknown[], attrs: Record<string, unknown> = {}): El {
  return (board.create as unknown as (t: string, p: unknown[], a?: Record<string, unknown>) => El)(type, parents, attrs);
}

export function paramNames(ctx: RenderContext): string[] {
  return Object.keys(ctx.params);
}

/** Compile an expression in one variable into a closure reading live slider params. */
export function liveFn(ctx: RenderContext, expression: string, variable: string): (v: number) => number {
  const c = compileExpression(expression, [variable, ...paramNames(ctx)]);
  return (v: number) => c.evaluate({ ...ctx.params, [variable]: v });
}

export function liveFn2(ctx: RenderContext, expression: string, a: string, b: string): (x: number, y: number) => number {
  const c = compileExpression(expression, [a, b, ...paramNames(ctx)]);
  return (x: number, y: number) => c.evaluate({ ...ctx.params, [a]: x, [b]: y });
}

/** Evaluate a numeric field against live params (so bounds like "a" follow sliders). */
export function liveNum(ctx: RenderContext, v: number | string): () => number {
  if (typeof v === "number") return () => v;
  return () => evalNum(v, ctx.params);
}

export function baseAttrs(ctx: RenderContext, obj: GraphObject, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    strokeColor: ctx.colorFor(obj),
    // Curves must never be filled; shaded regions set their own fill explicitly.
    fillColor: "none",
    fillOpacity: 0,
    strokeWidth: obj.group === "essential" ? 2.5 : 2,
    highlight: false,
    name: obj.label ?? "",
    withLabel: false,
    // Model/user-provided names are untrusted: never let JSXGraph render them as HTML.
    label: { display: "internal", parse: false, useMathJax: false, useKatex: false },
    ...extra,
  };
}

export const fmtNum = (n: number, d = 4): string => {
  if (!Number.isFinite(n)) return "undefined";
  const r = Number(n.toFixed(d));
  return Object.is(r, -0) ? "0" : String(r);
};
