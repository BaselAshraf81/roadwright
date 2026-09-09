/**
 * Cumulative integration, used by both directions of the road solve.
 *
 * Trapezoid rule. Second order, which is more than enough here because the
 * integrand is a sampled radius profile whose own resolution is the limiting
 * factor, and because the result is consumed as a drawn curve.
 *
 * Pure. No DOM.
 */

/**
 * Cumulative integral of `f` sampled at uniform spacing `h`, starting at zero.
 *
 * Returns an array the same length as `f`, where element i is the integral from
 * sample 0 to sample i. Element 0 is therefore always 0.
 */
export function cumulativeTrapezoid(f: Float64Array, h: number): Float64Array {
  const n = f.length;
  const out = new Float64Array(n);
  let acc = 0;
  for (let i = 1; i < n; i++) {
    acc += ((f[i - 1]! + f[i]!) / 2) * h;
    out[i] = acc;
  }
  return out;
}

/**
 * Total integral over one closed period of a uniformly sampled function.
 *
 * The samples cover [0, period) without repeating the endpoint, so the wrap-around
 * interval from the last sample back to the first must be included. Forgetting it
 * is an off-by-one that leaves a visible seam where the wheel jumps.
 */
export function periodicTotal(f: Float64Array, h: number): number {
  const n = f.length;
  if (n === 0) return 0;
  let acc = 0;
  for (let i = 1; i < n; i++) acc += ((f[i - 1]! + f[i]!) / 2) * h;
  acc += ((f[n - 1]! + f[0]!) / 2) * h; // Close the loop.
  return acc;
}

/**
 * Sample a monotonically increasing tabulated function at an arbitrary input,
 * by linear interpolation. Used to walk the road at uniform arc positions when the
 * table is uniform in angle instead.
 */
export function interpolateMonotonic(
  xs: Float64Array,
  ys: Float64Array,
  x: number,
): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (n === 1) return ys[0]!;
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[n - 1]!) return ys[n - 1]!;

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) lo = mid;
    else hi = mid;
  }

  const x0 = xs[lo]!;
  const x1 = xs[hi]!;
  const span = x1 - x0;
  if (Math.abs(span) < 1e-300) return ys[lo]!;
  const t = (x - x0) / span;
  return ys[lo]! + (ys[hi]! - ys[lo]!) * t;
}
