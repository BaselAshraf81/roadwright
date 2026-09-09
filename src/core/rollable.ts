/**
 * Turning any drawing into a shape that can actually roll.
 *
 * A wheel only works if a ray from its axle meets the outline exactly once in every
 * direction. Most freehand doodles fail that: a crescent, an animal, anything with a
 * crevice between two limbs. Refusing them was correct and useless, because it left
 * the majority of visitors at a dead end holding a drawing the site would not use.
 *
 * So instead of refusing, find the closest shape that rolls. Stand at the deepest
 * interior point, look outward in every direction, and take the first edge each look
 * meets. Everything the axle can see is kept exactly; only the pockets it cannot see
 * are filled in. The result is recognisably the same drawing with its crevices
 * bridged, which is far closer to what somebody drew than a convex hull would be.
 *
 * The original is always kept so the interface can show what changed. Adjusting
 * silently would be the dishonest version of this.
 */

import {
  type Polygon,
  area,
  boundingBox,
  centroid,
  containsPoint,
  toCounterClockwise,
} from "./polygon.js";
import { type Vec, cross, dist, sub, unit } from "./vec.js";

/** Shortest distance from a point to the polygon boundary. */
function distanceToBoundary(poly: Polygon, p: Vec): number {
  const n = poly.length;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const ab = sub(b, a);
    const len2 = ab.x * ab.x + ab.y * ab.y;
    let d: number;
    if (len2 < 1e-30) {
      d = dist(p, a);
    } else {
      const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2),
      );
      d = Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t));
    }
    if (d < best) best = d;
  }
  return best;
}

/**
 * The interior point furthest from the boundary, often called the pole of
 * inaccessibility.
 *
 * Chosen over the centroid because a centroid can sit outside a curved shape
 * entirely, and even when inside it can hug an edge, which produces a wheel with one
 * enormous reach and absurdly deep ruts. The deepest point gives the best-conditioned
 * wheel available for a given outline.
 *
 * Coarse grid then local refinement. Exact optimisation is not worth it here: the
 * axle is draggable afterwards, so this only has to be a good starting point.
 */
export function deepestInteriorPoint(outline: Polygon): Vec | null {
  if (outline.length < 3) return null;

  const box = boundingBox(outline);
  const spanX = box.max.x - box.min.x;
  const spanY = box.max.y - box.min.y;
  if (!(spanX > 0) || !(spanY > 0)) return null;

  let best: Vec | null = null;
  let bestDepth = -Infinity;

  const consider = (p: Vec): void => {
    if (!containsPoint(outline, p)) return;
    const d = distanceToBoundary(outline, p);
    if (d > bestDepth) {
      bestDepth = d;
      best = p;
    }
  };

  // The centroid is often the answer already, so try it before the sweep.
  consider(centroid(outline));

  const steps = 40;
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      consider({
        x: box.min.x + (spanX * i) / steps,
        y: box.min.y + (spanY * j) / steps,
      });
    }
  }

  if (!best) return null;

  // Refine by shrinking the search radius around the winner.
  let radius = Math.max(spanX, spanY) / steps;
  for (let round = 0; round < 6; round++) {
    const anchor: Vec = best;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      consider({
        x: anchor.x + Math.cos(a) * radius,
        y: anchor.y + Math.sin(a) * radius,
      });
    }
    radius *= 0.55;
  }

  return best;
}

/**
 * Farthest crossing of a ray from `from` in direction `dir` with the outline.
 *
 * Farthest, not nearest, and the difference decides whether this feature is any use.
 * Taking the nearest crossing stops at the first exit, which keeps the body of a
 * drawing and lops off every limb that leans across a direction. An animal comes back
 * as a blob. Taking the farthest crossing reaches the outermost tip in each
 * direction, so every extremity survives and only the pockets between them are
 * filled. The result is a shape that contains the drawing rather than a shape carved
 * out of it.
 */
function farthestCrossing(ring: Polygon, from: Vec, dir: Vec): number | null {
  const n = ring.length;
  let farthest = -Infinity;

  for (let i = 0; i < n; i++) {
    const a = sub(ring[i]!, from);
    const b = sub(ring[(i + 1) % n]!, from);
    const edge = sub(b, a);

    const denom = cross(dir, edge);
    if (Math.abs(denom) < 1e-15) continue;

    const t = cross(a, edge) / denom;
    const u = cross(a, dir) / denom;
    if (t <= 0) continue;
    if (u < -1e-9 || u > 1 + 1e-9) continue;

    if (t > farthest) farthest = t;
  }

  return farthest > 0 ? farthest : null;
}

export interface Rollable {
  /** A shape guaranteed to be star-shaped about `centre`. */
  readonly outline: Polygon;
  readonly centre: Vec;
  /**
   * How much was filled in, as a fraction of the drawing's own area.
   *
   * Measured by area rather than by distance. Every resampled point sits on the
   * original boundary by construction, so measuring point-to-boundary distance
   * always returns zero and says nothing at all. Bridging a pocket adds area, and
   * that is exactly the quantity worth reporting.
   */
  readonly deviation: number;
}

/**
 * Resample an outline so it is star-shaped about its deepest interior point.
 *
 * The result is a radial hull: for every direction, reach out to the outline's
 * outermost point that way. It is star-shaped about the centre by construction,
 * because it is built as a radius for every angle, and it contains the original,
 * because the farthest exit along any ray is at least as far as any interior point
 * on that ray. So nothing the visitor drew is lost from the silhouette; the crevices
 * between the parts get filled.
 */
export function makeRollable(outline: Polygon, samples = 256): Rollable | null {
  const ring = toCounterClockwise(outline);
  const centre = deepestInteriorPoint(ring);
  if (!centre) return null;

  const box = boundingBox(ring);
  const size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
  if (!(size > 0)) return null;

  const points: Vec[] = [];
  const tau = Math.PI * 2;

  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * tau;
    const dir = unit(a);
    const r = farthestCrossing(ring, centre, dir);
    if (r === null || !(r > 0)) return null;
    points.push({ x: centre.x + dir.x * r, y: centre.y + dir.y * r });
  }

  const before = area(ring);
  const after = area(points);
  const deviation = before > 0 ? Math.max(0, (after - before) / before) : 0;

  return { outline: points, centre, deviation };
}
