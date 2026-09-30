"use client";
import { memo, useMemo } from "react";
import { compileExpression, evalNum, implicitToZeroForm } from "@/lib/graph/parser";
import type { GraphDocument } from "@/lib/graph/schema";
import { isShown } from "@/lib/graph/renderer-visibility";

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2"];

/**
 * Lightweight static SVG thumbnail of a GraphDocument — no JSXGraph board is
 * created for history cards.
 */
export const GraphPreview = memo(function GraphPreview({ doc, className }: { doc: GraphDocument; className?: string }) {
  const paths = useMemo(() => {
    const { xMin, xMax, yMin, yMax } = doc.viewport;
    const W = 160, H = 100;
    const sx = (x: number) => ((x - xMin) / (xMax - xMin)) * W;
    const sy = (y: number) => H - ((y - yMin) / (yMax - yMin)) * H;
    const params: Record<string, number> = {};
    for (const o of doc.objects) if (o.type === "slider") params[o.name] = o.value;
    const out: { d: string; color: string; dash?: boolean }[] = [];
    let ci = 0;
    const poly = (pts: [number, number][]) => {
      let d = "", pen = false;
      for (const [x, y] of pts) {
        if (!Number.isFinite(y) || !Number.isFinite(x) || y < yMin - (yMax - yMin) || y > yMax + (yMax - yMin)) { pen = false; continue; }
        d += `${pen ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
        pen = true;
      }
      return d;
    };
    for (const o of doc.objects) {
      if (!isShown(doc, o)) continue;
      try {
        const color = o.color ?? COLORS[ci++ % COLORS.length];
        if (o.type === "function") {
          const c = compileExpression(o.expression, ["x", ...Object.keys(params)]);
          const pts: [number, number][] = [];
          for (let i = 0; i <= 120; i++) { const x = xMin + ((xMax - xMin) * i) / 120; pts.push([x, c.evaluate({ ...params, x })]); }
          out.push({ d: poly(pts), color, dash: !!o.dashed });
        } else if (o.type === "parametric_curve" || o.type === "polar_curve") {
          const lo = evalNum(o.min, params), hi = evalNum(o.max, params);
          const pts: [number, number][] = [];
          if (o.type === "parametric_curve") {
            const X = compileExpression(o.xExpression, [o.parameter, ...Object.keys(params)]);
            const Y = compileExpression(o.yExpression, [o.parameter, ...Object.keys(params)]);
            for (let i = 0; i <= 160; i++) { const t = lo + ((hi - lo) * i) / 160; pts.push([X.evaluate({ ...params, [o.parameter]: t }), Y.evaluate({ ...params, [o.parameter]: t })]); }
          } else {
            const R = compileExpression(o.expression, [o.parameter, ...Object.keys(params)]);
            for (let i = 0; i <= 160; i++) { const t = lo + ((hi - lo) * i) / 160; const r = R.evaluate({ ...params, [o.parameter]: t }); pts.push([r * Math.cos(t), r * Math.sin(t)]); }
          }
          out.push({ d: poly(pts), color });
        } else if (o.type === "implicit_curve") {
          // coarse marching squares: draw cell segments where F changes sign
          const F = compileExpression(implicitToZeroForm(o.expression), ["x", "y", ...Object.keys(params)]);
          const N = 48; let d = "";
          const gx = (i: number) => xMin + ((xMax - xMin) * i) / N, gy = (j: number) => yMin + ((yMax - yMin) * j) / N;
          const v: number[][] = [];
          for (let i = 0; i <= N; i++) { v[i] = []; for (let j = 0; j <= N; j++) v[i][j] = F.evaluate({ ...params, x: gx(i), y: gy(j) }); }
          for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
            const e: [number, number][] = [];
            const edge = (a: number, b: number, x0: number, y0: number, x1: number, y1: number) => {
              if (Number.isFinite(a) && Number.isFinite(b) && Math.sign(a) !== Math.sign(b)) { const t = a / (a - b); e.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]); }
            };
            edge(v[i][j], v[i + 1][j], gx(i), gy(j), gx(i + 1), gy(j));
            edge(v[i + 1][j], v[i + 1][j + 1], gx(i + 1), gy(j), gx(i + 1), gy(j + 1));
            edge(v[i][j + 1], v[i + 1][j + 1], gx(i), gy(j + 1), gx(i + 1), gy(j + 1));
            edge(v[i][j], v[i][j + 1], gx(i), gy(j), gx(i), gy(j + 1));
            if (e.length >= 2) d += `M${sx(e[0][0]).toFixed(1)},${sy(e[0][1]).toFixed(1)}L${sx(e[1][0]).toFixed(1)},${sy(e[1][1]).toFixed(1)}`;
          }
          out.push({ d, color });
        } else if (o.type === "vertical_line") {
          const x = evalNum(o.x, params); out.push({ d: `M${sx(x)},0L${sx(x)},${H}`, color, dash: true });
        } else if (o.type === "horizontal_line") {
          const y = evalNum(o.y, params); out.push({ d: `M0,${sy(y)}L${W},${sy(y)}`, color, dash: true });
        }
      } catch { /* skip invalid in preview */ }
    }
    const axes = `${yMin < 0 && yMax > 0 ? `M0,${sy(0)}L${W},${sy(0)}` : ""}${xMin < 0 && xMax > 0 ? `M${sx(0)},0L${sx(0)},${H}` : ""}`;
    return { out, axes, W, H };
  }, [doc]);
  return (
    <svg viewBox={`0 0 ${paths.W} ${paths.H}`} className={className} aria-hidden preserveAspectRatio="none">
      <path d={paths.axes} stroke="currentColor" strokeOpacity={0.35} strokeWidth={0.8} fill="none" />
      {paths.out.map((p, i) => <path key={i} d={p.d} stroke={p.color} strokeWidth={1.6} fill="none" strokeDasharray={p.dash ? "3 2" : undefined} />)}
    </svg>
  );
});
