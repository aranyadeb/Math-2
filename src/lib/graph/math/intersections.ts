/** Robust root finding by sampling + bisection/Brent-style refinement. */

export function bisect(f: (x: number) => number, a: number, b: number, tol = 1e-12, maxIter = 200): number | null {
  let fa = f(a), fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (Math.sign(fa) === Math.sign(fb)) return null;
  for (let i = 0; i < maxIter; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (!Number.isFinite(fm)) return null;
    if (fm === 0 || (b - a) / 2 < tol) return m;
    if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else { b = m; fb = fm; }
  }
  return (a + b) / 2;
}

/**
 * Find real roots of f in [a, b]. Sign changes are refined by bisection and
 * rejected if |f| is not small at the result (which filters poles such as 1/x).
 * Touching roots (x^2 at 0) are found by checking local minima of |f|.
 */
export function findRoots(f: (x: number) => number, a: number, b: number, samples = 2000): number[] {
  const roots: number[] = [];
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const x = a + ((b - a) * i) / samples;
    xs.push(x);
    ys.push(f(x));
  }
  const scale = Math.max(1e-9, ...ys.filter(Number.isFinite).map(Math.abs).slice(0, 1));
  const push = (r: number) => {
    const tol = ((b - a) / samples) * 0.5;
    if (!roots.some((q) => Math.abs(q - r) < tol)) roots.push(r);
  };
  for (let i = 0; i < samples; i++) {
    const y0 = ys[i], y1 = ys[i + 1];
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
    if (y0 === 0) { push(xs[i]); continue; }
    if (Math.sign(y0) !== Math.sign(y1) && y1 !== 0) {
      const r = bisect(f, xs[i], xs[i + 1]);
      if (r !== null && Math.abs(f(r)) < 1e-6 * Math.max(1, scale)) push(r);
    }
  }
  if (Number.isFinite(ys[samples]) && ys[samples] === 0) push(xs[samples]);
  // touching roots: local minimum of |f| close to zero
  for (let i = 1; i < samples; i++) {
    const a0 = Math.abs(ys[i - 1]), a1 = Math.abs(ys[i]), a2 = Math.abs(ys[i + 1]);
    if (![a0, a1, a2].every(Number.isFinite)) continue;
    if (a1 <= a0 && a1 <= a2 && Math.sign(ys[i - 1]) === Math.sign(ys[i + 1])) {
      // golden-section refine |f|
      let lo = xs[i - 1], hi = xs[i + 1];
      for (let k = 0; k < 80; k++) {
        const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
        if (Math.abs(f(m1)) < Math.abs(f(m2))) hi = m2; else lo = m1;
      }
      const r = (lo + hi) / 2;
      if (Math.abs(f(r)) < 1e-9) push(r);
    }
  }
  return roots.sort((p, q) => p - q);
}

export function findIntersections(f: (x: number) => number, g: (x: number) => number, a: number, b: number): { x: number; y: number }[] {
  const h = (x: number) => f(x) - g(x);
  return findRoots(h, a, b).map((x) => ({ x, y: f(x) })).filter((p) => Number.isFinite(p.y));
}
