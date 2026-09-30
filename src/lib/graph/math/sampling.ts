/**
 * Sample a function into polyline points, breaking the line at non-finite
 * values and at vertical jumps (e.g. 1/x at 0, tan at π/2) so we never draw a
 * false vertical connector across an asymptote.
 */
export function sampleFunction(f: (x: number) => number, a: number, b: number, n = 400, yRange = 1e6): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  let prev: number | null = null;
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n;
    const y = f(x);
    if (!Number.isFinite(y) || Math.abs(y) > yRange) {
      if (cur.length) out.push(cur);
      cur = [];
      prev = null;
      continue;
    }
    if (prev !== null && Math.abs(y - prev) > yRange / 1000 && Math.abs(y - prev) > 50 * ((b - a) / n) * 1000) {
      if (cur.length) out.push(cur);
      cur = [];
    }
    cur.push({ x, y });
    prev = y;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Suggest a viewport that frames a set of functions over [xMin, xMax]. */
export function suggestYRange(fs: ((x: number) => number)[], xMin: number, xMax: number): { yMin: number; yMax: number } {
  const ys: number[] = [];
  for (const f of fs) for (let i = 0; i <= 200; i++) {
    const y = f(xMin + ((xMax - xMin) * i) / 200);
    if (Number.isFinite(y)) ys.push(y);
  }
  if (!ys.length) return { yMin: -10, yMax: 10 };
  ys.sort((p, q) => p - q);
  const lo = ys[Math.floor(ys.length * 0.05)], hi = ys[Math.floor(ys.length * 0.95)];
  const pad = Math.max(1, (hi - lo) * 0.15);
  return { yMin: lo - pad, yMax: hi + pad };
}
