import type { ObjOf } from "../schema";
import { slopeAt } from "../math/derivative";
import { integrate } from "../math/integrate";
import { areaBetween } from "../math/area-between";
import { findIntersections, findRoots } from "../math/intersections";
import { baseAttrs, create, fmtNum, liveNum, type El, type Renderer } from "./context";

type Pt = { X: () => number; Y: () => number };

/** Find the function object's expression for symbolic work. */
function exprOf(ctx: Parameters<Renderer>[0], id: string): string | null {
  const o = ctx.doc.objects.find((x) => x.id === id);
  return o && o.type === "function" ? o.expression : null;
}

function tangentOrNormal(kind: "tangent" | "normal"): Renderer<ObjOf<"tangent"> | ObjOf<"normal">> {
  return (ctx, o) => {
    const f = ctx.fn(o.functionRef);
    const expr = exprOf(ctx, o.functionRef);
    if (!f || !expr) { ctx.warn(o.id, `${kind}: function "${o.functionRef}" not found`); return []; }
    const at0 = liveNum(ctx, o.at)();
    const color = ctx.colorFor(o);
    const out: El[] = [];
    const graph = ctx.elementsOf(o.functionRef)[0];
    let xa: () => number = liveNum(ctx, o.at);
    let touch: El;
    if (o.draggable && graph) {
      // Glider constrained to the curve: the tangent follows as it is dragged.
      touch = create(ctx.board, "glider", [at0, f(at0), graph], { size: 4, strokeColor: color, fillColor: color, name: "", highlight: false });
      xa = () => (touch as unknown as Pt).X();
      touch.on("up", () => ctx.onObjectChange(o.id, { at: Number(xa().toFixed(4)) }));
    } else {
      touch = create(ctx.board, "point", [() => xa(), () => f(xa())], { size: 3, fixed: true, strokeColor: color, fillColor: color, name: "", highlight: false });
    }
    out.push(touch);

    const scopeExpr = expr;
    // Line through (a, f(a)) with direction determined by slope info, recomputed live.
    const lineInfo = () => {
      const a = xa();
      const s = slopeAt(scopeExpr, a, ctx.params);
      if (s.kind === "undefined") return null;
      if (kind === "tangent") return s.kind === "vertical" ? { a, y: s.y, vertical: true, m: 0 } : { a, y: s.y, vertical: false, m: s.slope };
      if (s.kind === "vertical") return { a, y: s.y, vertical: false, m: 0 };
      if (Math.abs(s.slope) < 1e-12) return { a, y: s.y, vertical: true, m: 0 };
      return { a, y: s.y, vertical: false, m: -1 / s.slope };
    };
    const P2 = [
      () => { const i = lineInfo(); return i ? (i.vertical ? i.a : i.a + 1) : NaN; },
      () => { const i = lineInfo(); return i ? (i.vertical ? i.y + 1 : i.y + i.m) : NaN; },
    ];
    const P1 = [() => lineInfo()?.a ?? NaN, () => lineInfo()?.y ?? NaN];
    out.push(create(ctx.board, "line", [P1, P2], baseAttrs(ctx, o, { dash: kind === "normal" ? 2 : 0, strokeWidth: 1.8 })));
    const init = lineInfo();
    if (!init) ctx.warn(o.id, `The ${kind} is undefined at x = ${fmtNum(at0)} (derivative does not exist there).`);
    return out;
  };
}

export const renderTangent = tangentOrNormal("tangent") as Renderer<ObjOf<"tangent">>;
export const renderNormal = tangentOrNormal("normal") as Renderer<ObjOf<"normal">>;

export const renderIntegral: Renderer<ObjOf<"integral">> = (ctx, o) => {
  const f = ctx.fn(o.functionRef);
  if (!f) { ctx.warn(o.id, `integral: function "${o.functionRef}" not found`); return []; }
  const color = ctx.colorFor(o);
  const out: El[] = [];
  let lo: () => number = liveNum(ctx, o.lower);
  let hi: () => number = liveNum(ctx, o.upper);
  if (o.draggableBounds) {
    const xAxis = (ctx.board as unknown as { defaultAxes?: { x: El } }).defaultAxes?.x;
    const mk = (v: number) => xAxis
      ? create(ctx.board, "glider", [v, 0, xAxis], { size: 4, name: "", strokeColor: color, fillColor: color, highlight: false })
      : create(ctx.board, "point", [v, 0], { size: 4, name: "", strokeColor: color, fillColor: color });
    const gA = mk(lo()), gB = mk(hi());
    lo = () => (gA as unknown as Pt).X();
    hi = () => (gB as unknown as Pt).X();
    const save = () => ctx.onObjectChange(o.id, { lower: Number(lo().toFixed(4)), upper: Number(hi().toFixed(4)) });
    gA.on("up", save); gB.on("up", save);
    out.push(gA, gB);
  }
  // Shaded region: polygon under the curve, built from samples each update.
  const region = create(ctx.board, "curve", [[0], [0]], {
    fillColor: color, fillOpacity: 0.25, strokeWidth: 0, highlight: false, hasInnerPoints: false,
  });
  (region as unknown as { updateDataArray: () => void }).updateDataArray = function (this: { dataX: number[]; dataY: number[] }) {
    const a = lo(), b = hi();
    const xs: number[] = [a], ys: number[] = [0];
    const N = 200;
    for (let i = 0; i <= N; i++) {
      const x = a + ((b - a) * i) / N;
      const y = f(x);
      if (Number.isFinite(y)) { xs.push(x); ys.push(y); }
      else { xs.push(x); ys.push(0); } // break at gaps (rendered at the axis)
    }
    xs.push(b); ys.push(0);
    this.dataX = xs; this.dataY = ys;
  };
  out.push(region);
  // bound markers
  out.push(create(ctx.board, "segment", [[lo, 0], [lo, () => f(lo())]], { strokeColor: color, dash: 2, strokeWidth: 1, highlight: false, fixed: true }));
  out.push(create(ctx.board, "segment", [[hi, 0], [hi, () => f(hi())]], { strokeColor: color, dash: 2, strokeWidth: 1, highlight: false, fixed: true }));
  if (o.showValue) {
    const label = () => {
      const r = integrate(f, lo(), hi(), 1e-8);
      return r.ok ? `∫ from ${fmtNum(lo(), 3)} to ${fmtNum(hi(), 3)} = ${fmtNum(r.value, 5)}` : `∫ undefined: ${r.reason ?? ""}`;
    };
    out.push(create(ctx.board, "text", [() => (lo() + hi()) / 2, () => { const m = f((lo() + hi()) / 2); return Number.isFinite(m) ? m / 2 : 0; }, label], {
      display: "internal", parse: false, fixed: true, anchorX: "middle", fontSize: 13, strokeColor: color, highlight: false, cssClass: "jxg-value",
    }));
  }
  return out;
};

export const renderAreaBetween: Renderer<ObjOf<"area_between_curves">> = (ctx, o) => {
  const f = ctx.fn(o.upperRef), g = ctx.fn(o.lowerRef);
  if (!f || !g) { ctx.warn(o.id, "area: referenced curve not found"); return []; }
  const color = ctx.colorFor(o);
  const bb = () => ctx.board.getBoundingBox();
  const compute = () => {
    const [x0, , x1] = bb();
    return areaBetween(f, g, {
      from: o.from !== undefined ? liveNum(ctx, o.from)() : undefined,
      to: o.to !== undefined ? liveNum(ctx, o.to)() : undefined,
      searchMin: Math.min(x0, -20), searchMax: Math.max(x1, 20),
    });
  };
  let cached = compute();
  if (!cached.ok) ctx.warn(o.id, cached.reason ?? "Could not determine the region between the curves");
  // Region = union of pieces; each piece polygon is f from→to then g back.
  const region = create(ctx.board, "curve", [[0], [0]], { fillColor: color, fillOpacity: 0.28, strokeWidth: 0, highlight: false, hasInnerPoints: false });
  (region as unknown as { updateDataArray: () => void }).updateDataArray = function (this: { dataX: number[]; dataY: number[] }) {
    cached = compute();
    const xs: number[] = [], ys: number[] = [];
    if (cached.ok) {
      for (const p of cached.pieces) {
        const N = 120;
        for (let i = 0; i <= N; i++) { const x = p.from + ((p.to - p.from) * i) / N; xs.push(x); ys.push(f(x)); }
        for (let i = N; i >= 0; i--) { const x = p.from + ((p.to - p.from) * i) / N; xs.push(x); ys.push(g(x)); }
        xs.push(NaN); ys.push(NaN); // separate pieces
      }
    }
    this.dataX = xs; this.dataY = ys;
  };
  const out: El[] = [region];
  if (o.showValue) {
    out.push(create(ctx.board, "text", [
      () => (cached.ok ? (cached.from + cached.to) / 2 : 0),
      () => { if (!cached.ok) return 0; const m = (cached.from + cached.to) / 2; return (f(m) + g(m)) / 2; },
      () => (cached.ok ? `Area = ${fmtNum(cached.total, 5)}` : ""),
    ], { display: "internal", parse: false, fixed: true, anchorX: "middle", fontSize: 13, strokeColor: color, highlight: false }));
  }
  return out;
};

export const renderIntersections: Renderer<ObjOf<"intersection_marker">> = (ctx, o) => {
  const f = ctx.fn(o.refA);
  if (!f) { ctx.warn(o.id, `intersection: "${o.refA}" not found`); return []; }
  const g = o.refB ? ctx.fn(o.refB) : () => 0; // no refB = x-axis (roots)
  if (!g) { ctx.warn(o.id, `intersection: "${o.refB}" not found`); return []; }
  const [x0, , x1] = ctx.board.getBoundingBox();
  const a = o.from !== undefined ? liveNum(ctx, o.from)() : x0;
  const b = o.to !== undefined ? liveNum(ctx, o.to)() : x1;
  const pts = o.refB ? findIntersections(f, g, a, b) : findRoots(f, a, b).map((x) => ({ x, y: 0 }));
  const color = ctx.colorFor(o);
  return pts.slice(0, 30).map((p) =>
    create(ctx.board, "point", [p.x, p.y], {
      fixed: true, size: 3, strokeColor: color, fillColor: "#ffffff", name: `(${fmtNum(p.x, 3)}, ${fmtNum(p.y, 3)})`,
      withLabel: true, label: { offset: [6, 10], fontSize: 11, display: "internal", parse: false }, highlight: false,
    }),
  );
};

export const renderInequality: Renderer<ObjOf<"inequality_region">> = (ctx, o) => {
  const color = ctx.colorFor(o);
  const h = o.variable === "y" ? ctx.fn(o.id) : ctx.fn(o.id); // expression in x (or y) compiled by fn()
  if (!h) return [];
  const above = o.operator === ">" || o.operator === ">=";
  const strict = o.operator === ">" || o.operator === "<";
  const region = create(ctx.board, "curve", [[0], [0]], { fillColor: color, fillOpacity: 0.18, strokeWidth: 0, highlight: false, hasInnerPoints: false });
  (region as unknown as { updateDataArray: () => void }).updateDataArray = function (this: { dataX: number[]; dataY: number[] }) {
    const [x0, y1, x1, y0] = ctx.board.getBoundingBox();
    const N = 300;
    const xs: number[] = [], ys: number[] = [];
    if (o.variable === "y") {
      const edge = above ? y1 + (y1 - y0) : y0 - (y1 - y0);
      // piecewise polygons between gaps
      let run: number[] = [];
      const flush = () => {
        if (run.length > 1) {
          for (const x of run) { xs.push(x); ys.push(clamp(h(x), y0, y1)); }
          for (let k = run.length - 1; k >= 0; k--) { xs.push(run[k]); ys.push(edge); }
          xs.push(NaN); ys.push(NaN);
        }
        run = [];
      };
      for (let i = 0; i <= N; i++) {
        const x = x0 + ((x1 - x0) * i) / N;
        if (Number.isFinite(h(x))) run.push(x); else flush();
      }
      flush();
    } else {
      const edge = above ? x1 + (x1 - x0) : x0 - (x1 - x0);
      for (let i = 0; i <= N; i++) { const y = y0 + ((y1 - y0) * i) / N; xs.push(clampX(h(y), x0, x1)); ys.push(y); }
      for (let i = N; i >= 0; i--) { const y = y0 + ((y1 - y0) * i) / N; xs.push(edge); ys.push(y); }
    }
    this.dataX = xs; this.dataY = ys;
  };
  const boundary = o.variable === "y"
    ? create(ctx.board, "functiongraph", [h], baseAttrs(ctx, o, { dash: strict ? 2 : 0 }))
    : create(ctx.board, "curve", [h, (t: number) => t, -1e3, 1e3], baseAttrs(ctx, o, { dash: strict ? 2 : 0 }));
  return [region, boundary];
};

function clamp(v: number, lo: number, hi: number) {
  const span = hi - lo;
  return Math.max(lo - span, Math.min(hi + span, v));
}
const clampX = clamp;
