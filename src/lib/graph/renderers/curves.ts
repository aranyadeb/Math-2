import type { ObjOf } from "../schema";
import { implicitToZeroForm } from "../parser";
import { baseAttrs, create, liveFn, liveFn2, liveNum, type Renderer } from "./context";

export const renderFunction: Renderer<ObjOf<"function">> = (ctx, o) => {
  const f = liveFn(ctx, o.expression, o.variable ?? "x");
  const parents: unknown[] = [f];
  if (o.domain) parents.push(liveNum(ctx, o.domain.min), liveNum(ctx, o.domain.max));
  return [create(ctx.board, "functiongraph", parents, baseAttrs(ctx, o, { dash: o.dashed ? 2 : 0 }))];
};

export const renderImplicit: Renderer<ObjOf<"implicit_curve">> = (ctx, o) => {
  const F = liveFn2(ctx, implicitToZeroForm(o.expression), "x", "y");
  return [create(ctx.board, "implicitcurve", [F], baseAttrs(ctx, o, { resolution_outer: 20, resolution_inner: 20 }))];
};

export const renderParametric: Renderer<ObjOf<"parametric_curve">> = (ctx, o) => {
  const X = liveFn(ctx, o.xExpression, o.parameter);
  const Y = liveFn(ctx, o.yExpression, o.parameter);
  return [create(ctx.board, "curve", [X, Y, liveNum(ctx, o.min), liveNum(ctx, o.max)], baseAttrs(ctx, o))];
};

export const renderPolar: Renderer<ObjOf<"polar_curve">> = (ctx, o) => {
  const R = liveFn(ctx, o.expression, o.parameter);
  const lo = liveNum(ctx, o.min), hi = liveNum(ctx, o.max);
  // Explicit conversion keeps negative r handled correctly (r<0 points opposite).
  const X = (t: number) => R(t) * Math.cos(t);
  const Y = (t: number) => R(t) * Math.sin(t);
  return [create(ctx.board, "curve", [X, Y, lo, hi], baseAttrs(ctx, o, { numberPointsHigh: 1600 }))];
};
