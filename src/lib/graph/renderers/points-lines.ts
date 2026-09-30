import type { ObjOf } from "../schema";
import { baseAttrs, create, liveNum, type Renderer } from "./context";

export const renderPoint: Renderer<ObjOf<"point">> = (ctx, o) => {
  const x = liveNum(ctx, o.x), y = liveNum(ctx, o.y);
  return [create(ctx.board, "point", [x, y], baseAttrs(ctx, o, { fixed: true, size: 3, fillColor: ctx.colorFor(o), fillOpacity: 1, withLabel: !!o.label, name: o.label ?? "" }))];
};

export const renderMovablePoint: Renderer<ObjOf<"movable_point">> = (ctx, o) => {
  const attrs = baseAttrs(ctx, o, { size: 4, fillColor: ctx.colorFor(o), fillOpacity: 1, withLabel: !!o.label, name: o.label ?? "" });
  let p;
  if (o.onFunctionRef) {
    const f = ctx.fn(o.onFunctionRef);
    if (!f) return [];
    const graph = ctx.elementsOf(o.onFunctionRef)[0];
    if (graph) p = create(ctx.board, "glider", [o.x, f(o.x), graph], attrs);
    else p = create(ctx.board, "point", [o.x, f(o.x)], attrs);
  } else p = create(ctx.board, "point", [o.x, o.y], attrs);
  p.on("up", () => {
    const pt = p as unknown as { X: () => number; Y: () => number };
    ctx.onObjectChange(o.id, { x: pt.X(), y: pt.Y() });
  });
  return [p];
};

const twoPoint = (kind: "line" | "segment" | "ray", straightFirst: boolean, straightLast: boolean): Renderer<ObjOf<"line" | "segment" | "ray">> =>
  (ctx, o) => {
    const p1 = [liveNum(ctx, o.p1[0]), liveNum(ctx, o.p1[1])];
    const p2 = [liveNum(ctx, o.p2[0]), liveNum(ctx, o.p2[1])];
    void kind;
    return [create(ctx.board, "line", [p1, p2], baseAttrs(ctx, o, { straightFirst, straightLast }))];
  };
export const renderLine = twoPoint("line", true, true) as Renderer<ObjOf<"line">>;
export const renderSegment = twoPoint("segment", false, false) as Renderer<ObjOf<"segment">>;
export const renderRay = twoPoint("ray", false, true) as Renderer<ObjOf<"ray">>;

export const renderVertical: Renderer<ObjOf<"vertical_line">> = (ctx, o) => {
  const x = liveNum(ctx, o.x);
  return [create(ctx.board, "line", [[x, 0], [x, 1]], baseAttrs(ctx, o, { dash: o.dashed ? 2 : 0 }))];
};

export const renderHorizontal: Renderer<ObjOf<"horizontal_line">> = (ctx, o) => {
  const y = liveNum(ctx, o.y);
  return [create(ctx.board, "line", [[0, y], [1, y]], baseAttrs(ctx, o, { dash: o.dashed ? 2 : 0 }))];
};

export const renderText: Renderer<ObjOf<"text_annotation">> = (ctx, o) => {
  // Text is rendered as plain text (display: 'internal' + no HTML) to avoid injection.
  const t = create(ctx.board, "text", [liveNum(ctx, o.x), liveNum(ctx, o.y), o.text], {
    fixed: true, display: "internal", parse: false, useMathJax: false, useKatex: false, fontSize: 13,
    strokeColor: ctx.colorFor(o), highlight: false,
  });
  return [t];
};

export const renderAsymptote: Renderer<ObjOf<"asymptote">> = (ctx, o) => {
  const attrs = baseAttrs(ctx, o, { dash: 3, strokeWidth: 1.5 });
  if (o.kind === "vertical" && o.value !== undefined) {
    const x = liveNum(ctx, o.value);
    return [create(ctx.board, "line", [[x, 0], [x, 1]], attrs)];
  }
  if (o.kind === "horizontal" && o.value !== undefined) {
    const y = liveNum(ctx, o.value);
    return [create(ctx.board, "line", [[0, y], [1, y]], attrs)];
  }
  if (o.kind === "oblique" && o.expression) {
    const f = ctx.fn(o.id);
    if (f) return [create(ctx.board, "functiongraph", [f], attrs)];
  }
  return [];
};
