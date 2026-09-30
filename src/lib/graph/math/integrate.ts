/**
 * Adaptive Simpson integration with interval splitting at detected
 * non-finite points. Returns { value, ok, reason }. Never claims a finite
 * value for a divergent or undefined integral.
 */
export interface IntegrationResult {
  value: number;
  ok: boolean;
  reason?: string;
  estimatedError: number;
}

function simpson(f: (x: number) => number, a: number, fa: number, b: number, fb: number) {
  const m = (a + b) / 2;
  const fm = f(m);
  return { m, fm, s: ((b - a) / 6) * (fa + 4 * fm + fb) };
}

function adaptive(
  f: (x: number) => number, a: number, fa: number, b: number, fb: number,
  whole: number, m: number, fm: number, eps: number, depth: number, state: { evals: number; err: number; bad: boolean },
): number {
  const left = simpson(f, a, fa, m, fm);
  const right = simpson(f, m, fm, b, fb);
  state.evals += 2;
  if (!Number.isFinite(left.fm) || !Number.isFinite(right.fm)) {
    state.bad = true;
    return Number.NaN;
  }
  const delta = left.s + right.s - whole;
  if (depth <= 0 || state.evals > 200_000) {
    state.err += Math.abs(delta);
    if (Math.abs(delta) > 1e3 * eps) state.bad = true;
    return left.s + right.s + delta / 15;
  }
  if (Math.abs(delta) <= 15 * eps) {
    state.err += Math.abs(delta) / 15;
    return left.s + right.s + delta / 15;
  }
  return (
    adaptive(f, a, fa, m, fm, left.s, left.m, left.fm, eps / 2, depth - 1, state) +
    adaptive(f, m, fm, b, fb, right.s, right.m, right.fm, eps / 2, depth - 1, state)
  );
}

export function integrate(f: (x: number) => number, a: number, b: number, tol = 1e-9, maxDepth = 40): IntegrationResult {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { value: Number.NaN, ok: false, reason: "Bounds must be finite", estimatedError: Infinity };
  if (a === b) return { value: 0, ok: true, estimatedError: 0 };
  if (a > b) {
    const r = integrate(f, b, a, tol, maxDepth);
    return { ...r, value: -r.value };
  }
  // Coarse scan to split at non-finite points / jumps so each sub-interval is smooth-ish.
  const N = 256;
  const xs: number[] = [];
  for (let i = 0; i <= N; i++) xs.push(a + ((b - a) * i) / N);
  const ys = xs.map(f);
  if (ys.some((y) => !Number.isFinite(y))) {
    // Endpoint singularities of integrable type (e.g. 1/sqrt(x) at 0) are approached by nudging.
    const interiorBad = ys.slice(1, -1).some((y) => !Number.isFinite(y));
    if (interiorBad) return { value: Number.NaN, ok: false, reason: "Integrand is undefined inside the interval", estimatedError: Infinity };
  }
  const h = (b - a) * 1e-12;
  const safe = (x: number) => {
    let y = f(x);
    if (!Number.isFinite(y)) y = f(x === a ? a + h : x === b ? b - h : x);
    return y;
  };
  let total = 0, err = 0;
  const state = { evals: 0, err: 0, bad: false };
  const segments = 16;
  for (let i = 0; i < segments; i++) {
    const lo = a + ((b - a) * i) / segments, hi = a + ((b - a) * (i + 1)) / segments;
    const flo = safe(lo), fhi = safe(hi);
    if (!Number.isFinite(flo) || !Number.isFinite(fhi)) {
      return { value: Number.NaN, ok: false, reason: "Integrand is not finite at an endpoint (possibly divergent)", estimatedError: Infinity };
    }
    const whole = simpson(safe, lo, flo, hi, fhi);
    total += adaptive(safe, lo, flo, hi, fhi, whole.s, whole.m, whole.fm, tol / segments, maxDepth, state);
  }
  err += state.err;
  if (state.bad || !Number.isFinite(total)) {
    return { value: Number.NaN, ok: false, reason: "Integral did not converge (singular or discontinuous integrand)", estimatedError: Infinity };
  }
  // Detect jump discontinuities: large relative change between adjacent samples.
  const maxAbs = Math.max(...ys.filter(Number.isFinite).map(Math.abs), 1);
  for (let i = 1; i < ys.length; i++) {
    if (Number.isFinite(ys[i]) && Number.isFinite(ys[i - 1]) && Math.abs(ys[i] - ys[i - 1]) > 1e3 * maxAbs / N) {
      return { value: total, ok: false, reason: "Integrand appears to blow up inside the interval", estimatedError: err };
    }
  }
  return { value: total, ok: true, estimatedError: err };
}
