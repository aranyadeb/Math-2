import type JXG from "jsxgraph";
import type { GraphDocument, GraphObject, GraphObjectType } from "./schema";
import type { El, RenderContext, Renderer } from "./renderers/context";
import { liveFn } from "./renderers/context";
import { renderFunction, renderImplicit, renderParametric, renderPolar } from "./renderers/curves";
import {
  renderAsymptote, renderHorizontal, renderLine, renderMovablePoint, renderPoint, renderRay, renderSegment, renderText, renderVertical,
} from "./renderers/points-lines";
import { renderAreaBetween, renderInequality, renderIntegral, renderIntersections, renderNormal, renderTangent } from "./renderers/calculus";

/** Sliders are rendered as accessible HTML range inputs in the sidebar (touch-friendly); nothing on the board. */
const renderSlider: Renderer = () => [];

const RENDERERS: { [K in GraphObjectType]: Renderer<Extract<GraphObject, { type: K }>> } = {
  function: renderFunction,
  implicit_curve: renderImplicit,
  parametric_curve: renderParametric,
  polar_curve: renderPolar,
  point: renderPoint,
  movable_point: renderMovablePoint,
  line: renderLine,
  segment: renderSegment,
  ray: renderRay,
  vertical_line: renderVertical,
  horizontal_line: renderHorizontal,
  tangent: renderTangent,
  normal: renderNormal,
  integral: renderIntegral,
  area_between_curves: renderAreaBetween,
  inequality_region: renderInequality,
  slider: renderSlider,
  text_annotation: renderText,
  intersection_marker: renderIntersections,
  asymptote: renderAsymptote,
};

// Background layers first so curves draw on top of shaded regions.
const ORDER: Record<GraphObjectType, number> = {
  slider: 0, inequality_region: 1, area_between_curves: 2, integral: 3,
  function: 4, implicit_curve: 4, parametric_curve: 4, polar_curve: 4, asymptote: 4,
  line: 5, segment: 5, ray: 5, vertical_line: 5, horizontal_line: 5, tangent: 6, normal: 6,
  point: 7, movable_point: 7, intersection_marker: 8, text_annotation: 9,
};

const LIGHT = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#be185d", "#4d7c0f"];
const DARK = ["#60a5fa", "#f87171", "#4ade80", "#c084fc", "#fb923c", "#22d3ee", "#f472b6", "#a3e635"];

export interface RenderOptions {
  dark?: boolean;
  onObjectChange?: (id: string, changes: Record<string, unknown>) => void;
  onWarning?: (id: string, message: string) => void;
}

export interface RenderHandle {
  params: Record<string, number>;
  elements: Map<string, El[]>;
  /** Re-evaluate all dependent curves after slider changes (cheap). */
  update: () => void;
}

import { isShown } from "./renderer-visibility";
export { isShown };

/**
 * Render a GraphDocument onto an existing board. Application code owns all
 * rendering; the document is purely declarative data.
 */
export function renderGraphDocument(board: JXG.Board, doc: GraphDocument, opts: RenderOptions = {}): RenderHandle {
  const params: Record<string, number> = {};
  for (const o of doc.objects) if (o.type === "slider") params[o.name] = o.value;
  const palette = opts.dark ? DARK : LIGHT;
  const colorIndex = new Map<string, number>();
  const elements = new Map<string, El[]>();
  const fnCache = new Map<string, (x: number) => number>();

  const ctx: RenderContext = {
    board,
    doc,
    params,
    dark: !!opts.dark,
    onObjectChange: opts.onObjectChange ?? (() => {}),
    warn: opts.onWarning ?? (() => {}),
    colorFor: (o) => {
      if (o.color) return o.color;
      const refId = (o as { functionRef?: string }).functionRef;
      const key = refId && (o.type === "integral") ? refId : o.id;
      if (!colorIndex.has(key)) colorIndex.set(key, colorIndex.size);
      return palette[colorIndex.get(key)! % palette.length];
    },
    elementsOf: (id) => elements.get(id) ?? [],
    fn: (id) => {
      if (fnCache.has(id)) return fnCache.get(id)!;
      const o = doc.objects.find((x) => x.id === id);
      if (!o) return null;
      let f: ((x: number) => number) | null = null;
      try {
        if (o.type === "function") f = liveFn(ctx, o.expression, o.variable ?? "x");
        else if (o.type === "inequality_region") f = liveFn(ctx, o.expression, o.variable === "y" ? "x" : "y");
        else if (o.type === "asymptote" && o.expression) f = liveFn(ctx, o.expression, "x");
      } catch (e) {
        ctx.warn(id, (e as Error).message);
        return null;
      }
      if (f) fnCache.set(id, f);
      return f;
    },
  };

  const sorted = [...doc.objects].sort((a, b) => ORDER[a.type] - ORDER[b.type]);
  // Functions must be rendered before gliders/tangents referencing their graph element,
  // but after regions for z-order. JSXGraph layers handle z; we render functions first then the rest.
  const functionsFirst = [...sorted.filter((o) => o.type === "function"), ...sorted.filter((o) => o.type !== "function")];

  board.suspendUpdate();
  try {
    for (const o of functionsFirst) {
      if (!isShown(doc, o) && o.type !== "function") continue;
      try {
        const r = RENDERERS[o.type] as Renderer;
        const els = r(ctx, o);
        if (!isShown(doc, o)) for (const e of els) e.setAttribute({ visible: false });
        // Keep shaded regions beneath curves.
        if (o.type === "integral" || o.type === "area_between_curves" || o.type === "inequality_region") {
          for (const e of els) if ((e as unknown as { elType?: string }).elType === "curve") e.setAttribute({ layer: 2 });
        }
        elements.set(o.id, els);
      } catch (e) {
        ctx.warn(o.id, (e as Error).message);
      }
    }
  } finally {
    board.unsuspendUpdate();
  }

  return { params, elements, update: () => board.update() };
}

/** Read the current viewport from the board (for persistence). */
export function readViewport(board: JXG.Board): GraphDocument["viewport"] {
  const [xMin, yMax, xMax, yMin] = board.getBoundingBox();
  const r = (n: number) => Number(n.toFixed(4));
  return { xMin: r(xMin), xMax: r(xMax), yMin: r(yMin), yMax: r(yMax) };
}
