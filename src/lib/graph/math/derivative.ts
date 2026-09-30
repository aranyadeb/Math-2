import { math, normalizeExpression, compileExpression } from "../parser";

/**
 * Symbolic derivative via math.js. Returns null when math.js cannot
 * differentiate (e.g. abs at a kink is fine symbolically but some functions
 * are unsupported) — callers may then fall back to numeric slopes or Gemini.
 */
export function symbolicDerivative(expression: string, variable = "x"): string | null {
  try {
    const d = math.derivative(normalizeExpression(expression), variable);
    const simplified = math.simplify(d);
    return simplified.toString({ implicit: "show" });
  } catch {
    return null;
  }
}

/** Central-difference numeric derivative (with a Richardson step for accuracy). */
export function numericDerivative(f: (x: number) => number, x: number, h = 1e-4): number {
  const d1 = (f(x + h) - f(x - h)) / (2 * h);
  const d2 = (f(x + h / 2) - f(x - h / 2)) / h;
  const r = (4 * d2 - d1) / 3;
  return Number.isFinite(r) ? r : Number.NaN;
}

export type SlopeInfo =
  | { kind: "finite"; slope: number; y: number }
  | { kind: "vertical"; y: number }
  | { kind: "undefined"; reason: string };

/**
 * Slope of f at a. Distinguishes vertical tangents (|f'| → ∞ with f continuous)
 * from genuinely undefined derivatives (corners, discontinuities, outside domain).
 */
export function slopeAt(expression: string, a: number, scope: Record<string, number> = {}, variable = "x"): SlopeInfo {
  const f = compileExpression(expression, [variable, ...Object.keys(scope)]);
  const F = (x: number) => f.evaluate({ ...scope, [variable]: x });
  const y = F(a);
  if (!Number.isFinite(y)) return { kind: "undefined", reason: `f(${fmt(a)}) is not defined` };

  // Continuity check
  const eps = 1e-10;
  const yl = F(a - eps), yr = F(a + eps);
  const scale = Math.max(1, Math.abs(y));
  const leftOk = Number.isFinite(yl), rightOk = Number.isFinite(yr);
  if ((leftOk && Math.abs(yl - y) > 1e-3 * scale) || (rightOk && Math.abs(yr - y) > 1e-3 * scale)) {
    return { kind: "undefined", reason: `f is not continuous at x = ${fmt(a)}` };
  }

  const h1 = 1e-3, h2 = 1e-6;
  const L1 = (y - F(a - h1)) / h1, L2 = (y - F(a - h2)) / h2;
  const R1 = (F(a + h1) - y) / h1, R2 = (F(a + h2) - y) / h2;
  const leftFinite = Number.isFinite(L1) && Number.isFinite(L2);
  const rightFinite = Number.isFinite(R1) && Number.isFinite(R2);
  const blowsUp = (d1: number, d2: number) => Math.abs(d2) > 1e3 && Math.abs(d2) > 5 * Math.abs(d1);

  if (leftFinite && rightFinite && blowsUp(L1, L2) && blowsUp(R1, R2) && Math.sign(L2) === Math.sign(R2)) {
    return { kind: "vertical", y };
  }
  if (leftFinite && rightFinite && Math.abs(L2 - R2) > 1e-3 * Math.max(1, Math.abs(L2), Math.abs(R2))) {
    return { kind: "undefined", reason: `f has a corner or cusp at x = ${fmt(a)} (left slope ${fmt(L2)}, right slope ${fmt(R2)})` };
  }

  let slope: number | null = null;
  const sym = symbolicDerivative(expression, variable);
  if (sym) {
    try {
      const d = compileExpression(sym, [variable, ...Object.keys(scope)]).evaluate({ ...scope, [variable]: a });
      if (Number.isFinite(d)) slope = d;
    } catch { /* fall back to numeric */ }
  }
  if (slope === null) {
    if (leftFinite && rightFinite) slope = (L2 + R2) / 2;
    else if (leftFinite) slope = L2;
    else if (rightFinite) slope = R2;
    else return { kind: "undefined", reason: "derivative could not be evaluated" };
  }
  if (Math.abs(slope) > 1e8) return { kind: "vertical", y };
  return { kind: "finite", slope, y };
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export interface LineEquation {
  kind: "slope" | "vertical";
  /** y = m x + c when kind = slope */
  m?: number;
  c?: number;
  /** x = x0 when vertical */
  x0?: number;
  latex: string;
}

export function tangentLine(info: SlopeInfo, a: number): LineEquation | null {
  if (info.kind === "undefined") return null;
  if (info.kind === "vertical") return { kind: "vertical", x0: a, latex: `x = ${fmt(a)}` };
  const m = info.slope, c = info.y - m * a;
  return { kind: "slope", m, c, latex: `y = ${fmt(m)}x ${c >= 0 ? "+" : "-"} ${fmt(Math.abs(c))}` };
}

export function normalLine(info: SlopeInfo, a: number): LineEquation | null {
  if (info.kind === "undefined") return null;
  if (info.kind === "vertical") {
    // normal to a vertical tangent is horizontal
    return { kind: "slope", m: 0, c: info.y, latex: `y = ${fmt(info.y)}` };
  }
  if (Math.abs(info.slope) < 1e-12) return { kind: "vertical", x0: a, latex: `x = ${fmt(a)}` };
  const m = -1 / info.slope, c = info.y - m * a;
  return { kind: "slope", m, c, latex: `y = ${fmt(m)}x ${c >= 0 ? "+" : "-"} ${fmt(Math.abs(c))}` };
}
