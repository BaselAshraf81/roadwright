/**
 * Outline plus hub to r(theta), the polar radius profile the road is derived from.
 *
 * The hub sits at the origin of the profile. For every sampled angle a ray is
 * fired from the hub and the crossing with the outline gives r. When the hub lies
 * inside the permissible zone from `kernel.ts` there is exactly one crossing per
 * direction, which is the whole reason that zone exists.
 *
 * Pure. No DOM.
 */

import { type Polygon, toCounterClockwise } from "./polygon.js";
import { type Vec, cross, sub, unit } from "./vec.js";

export interface RadiusProfile {
  /** Sample angles, ascending, starting at 0 and spanning one full turn. */
  readonly theta: Float64Array;
  /** Hub-to-outline distance at each angle. Strictly positive. */
  readonly r: Float64Array;
  /** The hub these radii were measured from, in outline coordinates. */
  readonly hub: Vec;
}

export const DEFAULT_SAMPLES = 2048;

/**
 * Distances from `hub` to the outline along direction `dir`, one per distinct
 * crossing, ascending.
 *
 * Counting crossings rather than taking the first hit is deliberate: a hub outside
 * the permissible zone produces two or three crossings, and silently taking the
 * nearest would return a plausible number for a shape that has no road.
 *
 * Vertex hits are the whole difficulty here. When a ray passes exactly through a
 * vertex, the two edges meeting there both want to report it, and a half-open
 * interval in u does not survive floating point: the parameter can land just past
 * 1 on one edge and just under 0 on the other, so a strict test drops the crossing
 * from both and the hub appears to see nothing. Rays hit vertices constantly here,
 * because the suggested hub is collinear with the outline's own vertices. So both
 * edges are allowed to report, with a slack interval, and coincident hits are then
 * merged by distance. Two crossings at the same distance along one ray are the same
 * point, so merging is exact rather than a fudge.
 */
function rayCrossings(
  ring: Polygon,
  hub: Vec,
  dir: Vec,
  tolerance: number,
  scale: number,
): number[] {
  const n = ring.length;
  const uSlack = 1e-9;
  const hits: number[] = [];

  for (let i = 0; i < n; i++) {
    const a = sub(ring[i]!, hub);
    const b = sub(ring[(i + 1) % n]!, hub);
    const edge = sub(b, a);

    const denom = cross(dir, edge);
    if (Math.abs(denom) < 1e-15) continue; // Ray parallel to the edge.

    // Solve hub + t*dir = a + u*edge, with t along the ray and u along the edge.
    const t = cross(a, edge) / denom;
    const u = cross(a, dir) / denom;

    if (t <= tolerance) continue; // Behind the hub or at it.
    if (u < -uSlack || u > 1 + uSlack) continue;

    hits.push(t);
  }

  if (hits.length < 2) return hits;

  hits.sort((p, q) => p - q);

  const merged: number[] = [];
  const mergeTolerance = Math.max(scale, 1) * 1e-9;
  for (const t of hits) {
    const last = merged[merged.length - 1];
    if (last === undefined || t - last > mergeTolerance) merged.push(t);
  }
  return merged;
}

/**
 * Sample r(theta) over one full turn.
 *
 * Throws when the hub cannot see the whole outline, because every caller needs to
 * treat that as a validity failure rather than as a degraded result. Use
 * `validate.ts` to test an outline before calling this.
 */
export function radiusProfile(
  outline: Polygon,
  hub: Vec,
  samples: number = DEFAULT_SAMPLES,
): RadiusProfile {
  if (outline.length < 3) throw new Error("An outline needs at least three points.");
  if (samples < 8) throw new Error("A radius profile needs at least eight samples.");

  const ring = toCounterClockwise(outline);
  const tau = Math.PI * 2;

  const theta = new Float64Array(samples);
  const r = new Float64Array(samples);

  // Scale the ray tolerance to the outline so it behaves the same at any size.
  let scale = 0;
  for (const p of ring) scale = Math.max(scale, Math.hypot(p.x - hub.x, p.y - hub.y));
  const tolerance = Math.max(scale, 1) * 1e-12;

  for (let i = 0; i < samples; i++) {
    const th = (i / samples) * tau;
    const hits = rayCrossings(ring, hub, unit(th), tolerance, scale);

    if (hits.length === 0) {
      throw new Error(
        `The hub sees no edge at ${((th * 180) / Math.PI).toFixed(1)} degrees, so it is outside the outline.`,
      );
    }
    if (hits.length > 1) {
      throw new Error(
        `The outline folds back on itself at ${((th * 180) / Math.PI).toFixed(1)} degrees as seen from the hub.`,
      );
    }

    theta[i] = th;
    r[i] = hits[0]!;
  }

  return { theta, r, hub };
}

/** Smallest and largest radius, and the rut depth ratio derived from them. */
export function radiusExtent(profile: RadiusProfile): {
  min: number;
  max: number;
  /**
   * (max - min) / max. Zero for a circle, about 0.293 for a square, and 0.5 for an
   * equilateral triangle. The triangle is the known-unbuildable case, its vertices
   * jamming in the ruts, so this ratio is the honest predictor of whether a cut
   * pair will actually roll.
   */
  rutDepth: number;
} {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < profile.r.length; i++) {
    const v = profile.r[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max, rutDepth: max > 0 ? (max - min) / max : 0 };
}
