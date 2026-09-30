import { integrate } from "./integrate";
import { findIntersections } from "./intersections";

export interface AreaPiece {
  from: number;
  to: number;
  /** which function is on top in this piece */
  top: "f" | "g";
  area: number;
}

export interface AreaBetweenResult {
  from: number;
  to: number;
  pieces: AreaPiece[];
  total: number;
  ok: boolean;
  reason?: string;
}

/**
 * ∫[a,b] |f(x) − g(x)| dx, split at every crossing so each piece has a single
 * top curve. When bounds are omitted, uses the outermost intersections inside
 * [searchMin, searchMax] (the "enclosed region").
 */
export function areaBetween(
  f: (x: number) => number,
  g: (x: number) => number,
  opts: { from?: number; to?: number; searchMin?: number; searchMax?: number },
): AreaBetweenResult {
  let a = opts.from, b = opts.to;
  const sMin = opts.searchMin ?? -50, sMax = opts.searchMax ?? 50;
  if (a === undefined || b === undefined) {
    const pts = findIntersections(f, g, a ?? sMin, b ?? sMax);
    if (pts.length < (a === undefined && b === undefined ? 2 : 1)) {
      return { from: Number.NaN, to: Number.NaN, pieces: [], total: Number.NaN, ok: false, reason: "The curves do not enclose a region; specify bounds" };
    }
    if (a === undefined) a = pts[0].x;
    if (b === undefined) b = pts[pts.length - 1].x;
  }
  if (a > b) [a, b] = [b, a];
  const crossings = findIntersections(f, g, a, b).map((p) => p.x).filter((x) => x > a! + 1e-9 && x < b! - 1e-9);
  const cuts = [a, ...crossings, b];
  const pieces: AreaPiece[] = [];
  let total = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const lo = cuts[i], hi = cuts[i + 1];
    if (hi - lo < 1e-12) continue;
    const mid = (lo + hi) / 2;
    const top: "f" | "g" = f(mid) >= g(mid) ? "f" : "g";
    const r = integrate((x) => Math.abs(f(x) - g(x)), lo, hi);
    if (!r.ok) return { from: a, to: b, pieces, total: Number.NaN, ok: false, reason: r.reason };
    pieces.push({ from: lo, to: hi, top, area: r.value });
    total += r.value;
  }
  return { from: a, to: b, pieces, total, ok: true };
}
