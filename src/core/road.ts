/**
 * The road solve. This is the product.
 *
 * For the hub to travel dead level, the contact point must sit directly below it
 * at distance r. Rolling without slipping means the road advances by the wheel's
 * own arc, dx = r dtheta. So with the hub tracking y = 0:
 *
 *   x(theta) = integral of r dtheta,   y(theta) = -r(theta)
 *
 * and the inverse direction, road to wheel:
 *
 *   theta(x) = integral of dx / (-y(x)),   r(theta) = -y(x(theta))
 *
 * Both directions are quadratures. There is no solver to converge and no tolerance
 * to defend, which is what makes this instant enough to remorph while dragging.
 *
 * Pure. No DOM.
 */

import { cumulativeTrapezoid, interpolateMonotonic, periodicTotal } from "./quadrature.js";
import type { RadiusProfile } from "./wheel.js";
import type { Vec } from "./vec.js";

export interface Road {
  /** Road points for exactly one period, left to right. */
  readonly points: readonly Vec[];
  /** Horizontal length of one period, equal to the wheel's perimeter arc. */
  readonly period: number;
  /** Hub height above the lowest point of the road. */
  readonly axleHeight: number;
  /** Deepest and shallowest rut depth below the hub. */
  readonly minDepth: number;
  readonly maxDepth: number;
}

/**
 * Build one period of road from a radius profile.
 *
 * The returned points run from x = 0 to x = period. The hub travels along y = 0,
 * so every road y is negative and equals minus the radius at that contact angle.
 */
export function roadFromProfile(profile: RadiusProfile): Road {
  const { theta, r } = profile;
  const n = r.length;
  if (n < 2) throw new Error("A radius profile needs at least two samples.");

  const tau = Math.PI * 2;
  const dTheta = tau / n;

  // x is the cumulative wheel arc, which is what makes the roll slip-free.
  const x = cumulativeTrapezoid(r, dTheta);
  const period = periodicTotal(r, dTheta);

  const points: Vec[] = new Array(n + 1);
  let minDepth = Infinity;
  let maxDepth = -Infinity;

  for (let i = 0; i < n; i++) {
    const depth = r[i]!;
    points[i] = { x: x[i]!, y: -depth };
    if (depth < minDepth) minDepth = depth;
    if (depth > maxDepth) maxDepth = depth;
  }

  // Close the period explicitly. The first sample repeats at x = period, which is
  // what lets a renderer tile the road without a seam.
  points[n] = { x: period, y: -r[0]! };

  void theta;

  return {
    points,
    period,
    axleHeight: maxDepth,
    minDepth,
    maxDepth,
  };
}

/**
 * Recover a radius profile from a road, the inverse direction.
 *
 * `roadY` samples one period at uniform x spacing `dx`. Every value must be
 * strictly negative, since the road lies below the hub.
 *
 * This is what makes the road directly draggable: pull the profile and the wheel
 * remorphs, rather than the relationship only running one way.
 */
export function profileFromRoad(
  roadY: Float64Array,
  dx: number,
  samples: number,
): { theta: Float64Array; r: Float64Array; closure: number } {
  const n = roadY.length;
  if (n < 2) throw new Error("A road needs at least two samples.");
  if (!(dx > 0)) throw new Error("Road sample spacing must be positive.");

  // dtheta/dx = 1 / (-y), so integrating gives the angle turned at each x.
  const inverseDepth = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const depth = -roadY[i]!;
    if (!(depth > 0)) {
      throw new Error("The road must stay below the hub, so every height must be negative.");
    }
    inverseDepth[i] = 1 / depth;
  }

  const thetaAtX = cumulativeTrapezoid(inverseDepth, dx);
  const closure = periodicTotal(inverseDepth, dx);

  // Resample at uniform angle, which is the form the wheel and the renderer want.
  const tau = Math.PI * 2;
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = i * dx;

  const theta = new Float64Array(samples);
  const r = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    const th = (i / samples) * closure;
    const x = interpolateMonotonic(thetaAtX, xs, th);
    const depth = -interpolateMonotonic(xs, roadY, x);
    theta[i] = (i / samples) * tau;
    r[i] = depth;
  }

  return { theta, r, closure };
}

/**
 * How close a road is to admitting a wheel that closes.
 *
 * A periodic road only carries a closed wheel when the total angle turned over one
 * period is exactly one full turn. The ratio is reported rather than a pass or a
 * fail, so the interface can show the visitor approaching closure instead of
 * judging them once they arrive.
 */
export function closureRatio(closure: number): number {
  return closure / (Math.PI * 2);
}

/**
 * Precomputed tables for the rolling animation.
 *
 * Built once per shape so the animation loop is a lookup rather than a fresh pair
 * of integrations every frame.
 */
export interface RollTrack {
  /** Cumulative road distance at each sample, with the closing sample appended. */
  readonly xs: Float64Array;
  /** Contact angle at each sample, ending at one full turn. */
  readonly thetas: Float64Array;
  /** Radius at each sample, with the closing sample appended. */
  readonly radii: Float64Array;
  readonly period: number;
}

export function prepareRoll(profile: RadiusProfile): RollTrack {
  const { r } = profile;
  const n = r.length;
  const tau = Math.PI * 2;
  const dTheta = tau / n;

  const cumulative = cumulativeTrapezoid(r, dTheta);
  const period = periodicTotal(r, dTheta);

  const xs = new Float64Array(n + 1);
  const thetas = new Float64Array(n + 1);
  const radii = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    xs[i] = cumulative[i]!;
    thetas[i] = i * dTheta;
    radii[i] = r[i]!;
  }
  xs[n] = period;
  thetas[n] = tau;
  radii[n] = r[0]!;

  return { xs, thetas, radii, period };
}

/**
 * Contact state at a given distance travelled.
 *
 * The angle is read from the same cumulative integral the road was built from,
 * which is what keeps the wheel from visibly slipping. Integrating rotation
 * separately from position is the bug that would destroy the only claim the
 * product makes.
 */
export function contactOn(
  track: RollTrack,
  travelled: number,
): { theta: number; radius: number; x: number } {
  const { xs, thetas, radii, period } = track;
  const wrapped = ((travelled % period) + period) % period;
  const theta = interpolateMonotonic(xs, thetas, wrapped);
  const radius = interpolateMonotonic(xs, radii, wrapped);
  return { theta, radius, x: wrapped };
}

/** Convenience wrapper that prepares and samples in one call. */
export function contactAt(
  profile: RadiusProfile,
  travelled: number,
): { theta: number; radius: number; x: number } {
  return contactOn(prepareRoll(profile), travelled);
}

/**
 * Interference: how far the wheel drives into its own road as it turns.
 *
 * A wheel with sharp enough corners collides with the road it derived. That is not
 * a solver error, it is the physical reason a rolling equilateral triangle cannot be
 * built. So this is the figure that actually answers "will this roll if I cut it",
 * and it is measured rather than inferred.
 *
 * It replaced rut depth as the interface's gauge because rut depth is only a proxy
 * and it lies in both directions. Measured: a rounded rectangle has rut depth 0.414,
 * close to the old threshold, yet binds by 0.014% and rolls perfectly. An
 * equilateral triangle at 0.500 binds by 4.7%. Depth alone cannot tell those apart,
 * because what binds a wheel is corner sharpness.
 *
 * Returns the worst penetration as a fraction of the axle height, so it is
 * comparable across shapes and sizes. Zero means the wheel rides clear.
 */
export function interference(
  centred: readonly Vec[],
  road: Road,
  track: RollTrack,
  positions = 48,
): number {
  if (centred.length < 3 || road.points.length < 2) return 0;

  // Road as sorted arrays, so each lookup is a binary search rather than a scan.
  const n = road.points.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = road.points[i]!.x;
    ys[i] = road.points[i]!.y;
  }

  const period = road.period;
  const heightAt = (x: number): number => {
    const wrapped = ((x % period) + period) % period;
    return interpolateMonotonic(xs, ys, wrapped);
  };

  let worst = 0;
  for (let i = 0; i < positions; i++) {
    const travelled = (i / positions) * period;
    const contact = contactOn(track, travelled);

    // The renderer's transform: rotate so the contact angle points straight down.
    const rotation = -Math.PI / 2 - contact.theta;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    for (const p of centred) {
      const wx = travelled + (p.x * cos - p.y * sin);
      const wy = p.x * sin + p.y * cos;
      const gap = wy - heightAt(wx);
      if (gap < 0 && -gap > worst) worst = -gap;
    }
  }

  return road.maxDepth > 0 ? worst / road.maxDepth : 0;
}
