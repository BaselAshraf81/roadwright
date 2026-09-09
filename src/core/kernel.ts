/**
 * The permissible hub zone, which is the kernel of the outline.
 *
 * The kernel of a simple polygon is the set of points that can see every point of
 * the polygon. Place the hub anywhere in it and a ray fired from the hub crosses
 * the outline exactly once in every direction, which is precisely the condition
 * that lets the outline be written as a single-valued r(theta) and therefore have
 * a road at all.
 *
 * For a counterclockwise ring the interior lies to the left of every directed
 * edge, so the kernel is the intersection of the closed left half-planes of all
 * edges. Computed here by clipping a generous starting box edge by edge, which is
 * O(n * k) and completely robust at the sizes this product deals with.
 *
 * This is the reason the hub is not a free parameter in the interface: drawing the
 * kernel converts an invisible constraint into a visible region, and clamping the
 * hub to it makes a hub-caused failure impossible rather than apologised for.
 */

import {
  type Polygon,
  area,
  boundingBox,
  centroid,
  reflexVertices,
  toCounterClockwise,
} from "./polygon.js";
import { type Vec, cross, dist, sub } from "./vec.js";

export interface HubZone {
  /** The kernel polygon. Empty when no hub position can work. */
  readonly zone: Polygon;
  /** True when at least one hub position exists. */
  readonly exists: boolean;
  /** Recommended default hub, the deepest interior point of the zone. */
  readonly suggested: Vec | null;
  /**
   * Indices into the counterclockwise outline of the reflex vertices responsible
   * for shrinking or emptying the zone. Used to point at the offending concavity.
   */
  readonly blockingVertices: readonly number[];
}

/**
 * Clip a convex polygon by the closed half-plane left of the directed line a->b.
 * Sutherland-Hodgman, which stays correct because the subject stays convex.
 */
function clipByHalfPlane(poly: Polygon, a: Vec, b: Vec, epsilon: number): Polygon {
  const n = poly.length;
  if (n === 0) return poly;

  const edge = sub(b, a);
  // Positive when p lies to the left of a->b.
  const side = (p: Vec): number => cross(edge, sub(p, a));

  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const cur = poly[i]!;
    const next = poly[(i + 1) % n]!;
    const dCur = side(cur);
    const dNext = side(next);

    const curIn = dCur >= -epsilon;
    const nextIn = dNext >= -epsilon;

    if (curIn) out.push(cur);

    // Crossing the boundary, so add the intersection point.
    if (curIn !== nextIn) {
      const denom = dCur - dNext;
      if (Math.abs(denom) > 1e-300) {
        const t = dCur / denom;
        out.push({
          x: cur.x + (next.x - cur.x) * t,
          y: cur.y + (next.y - cur.y) * t,
        });
      }
    }
  }
  return out;
}

/**
 * Chebyshev-style center: the vertex-and-centroid candidate furthest from the
 * zone boundary. The centroid of a convex region is already interior, but on a
 * thin sliver it can sit very close to an edge, and a hub near the outline
 * produces a road with extremely deep ruts. Picking the deepest point keeps the
 * default well conditioned.
 */
function deepestPoint(zone: Polygon): Vec | null {
  if (zone.length === 0) return null;
  if (zone.length === 1) return zone[0]!;
  if (zone.length === 2) {
    return {
      x: (zone[0]!.x + zone[1]!.x) / 2,
      y: (zone[0]!.y + zone[1]!.y) / 2,
    };
  }

  const distanceToBoundary = (p: Vec): number => {
    const n = zone.length;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const a = zone[i]!;
      const b = zone[(i + 1) % n]!;
      const ab = sub(b, a);
      const len = Math.hypot(ab.x, ab.y);
      const d = len < 1e-15 ? dist(p, a) : Math.abs(cross(ab, sub(p, a))) / len;
      if (d < best) best = d;
    }
    return best;
  };

  const c = centroid(zone);
  let best = c;
  let bestDepth = distanceToBoundary(c);

  // Sample the centroid pulled toward each vertex. Cheap, and it reliably beats
  // the bare centroid on slivers and on strongly asymmetric zones.
  for (const v of zone) {
    for (const t of [0.25, 0.5]) {
      const p = { x: c.x + (v.x - c.x) * t, y: c.y + (v.y - c.y) * t };
      const d = distanceToBoundary(p);
      if (d > bestDepth) {
        bestDepth = d;
        best = p;
      }
    }
  }
  return best;
}

/**
 * Compute the permissible hub zone for an outline.
 *
 * `epsilon` absorbs floating-point noise on the half-plane tests. It is scaled by
 * the outline's size inside the function, so callers pass a relative value.
 */
export function hubZone(outline: Polygon, epsilon = 1e-9): HubZone {
  const ring = toCounterClockwise(outline);
  const n = ring.length;

  if (n < 3) {
    return { zone: [], exists: false, suggested: null, blockingVertices: [] };
  }

  const bb = boundingBox(ring);
  const spanX = bb.max.x - bb.min.x;
  const spanY = bb.max.y - bb.min.y;
  const span = Math.max(spanX, spanY);
  if (!(span > 0)) {
    return { zone: [], exists: false, suggested: null, blockingVertices: [] };
  }

  const eps = epsilon * span;
  const pad = span;

  // Start from a box comfortably larger than the outline, then clip it down.
  let zone: Polygon = [
    { x: bb.min.x - pad, y: bb.min.y - pad },
    { x: bb.max.x + pad, y: bb.min.y - pad },
    { x: bb.max.x + pad, y: bb.max.y + pad },
    { x: bb.min.x - pad, y: bb.max.y + pad },
  ];

  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    if (dist(a, b) < 1e-15) continue;
    zone = clipByHalfPlane(zone, a, b, eps);
    if (zone.length === 0) break;
  }

  const minUsefulArea = span * span * 1e-10;
  const exists = zone.length >= 3 && area(zone) > minUsefulArea;

  return {
    zone: exists ? zone : [],
    exists,
    suggested: exists ? deepestPoint(zone) : null,
    blockingVertices: exists ? [] : blockingRepresentatives(ring),
  };
}

/**
 * One representative vertex per contiguous run of reflex vertices.
 *
 * A smooth concave arc is reflex at every one of its vertices, so returning them all
 * makes the interface circle a hundred points into an unreadable tangle. What a
 * visitor needs is to be shown the notch, once. Runs are collapsed to their middle
 * and the longest few are kept, which is how a drawing would call out a feature.
 */
function blockingRepresentatives(ring: Polygon, maxCallouts = 2): number[] {
  const flags = new Set(reflexVertices(ring));
  const n = ring.length;
  if (flags.size === 0 || flags.size === n) {
    return flags.size === 0 ? [] : [0];
  }

  // Start scanning at a convex vertex so runs are never split across the wrap.
  let start = 0;
  while (start < n && flags.has(start)) start++;

  const runs: number[][] = [];
  let current: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (flags.has(i)) {
      current.push(i);
    } else if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length > 0) runs.push(current);

  runs.sort((a, b) => b.length - a.length);
  return runs
    .slice(0, maxCallouts)
    .map((run) => run[Math.floor(run.length / 2)]!);
}

/**
 * Clamp a point into the zone, so dragging the hub can never leave it.
 * Returns the nearest point on the zone when the input is outside.
 */
export function clampToZone(zone: Polygon, p: Vec): Vec {
  const n = zone.length;
  if (n === 0) return p;
  if (n === 1) return zone[0]!;

  // Inside a convex ring when it is left of, or on, every directed edge.
  let inside = true;
  for (let i = 0; i < n; i++) {
    const a = zone[i]!;
    const b = zone[(i + 1) % n]!;
    if (cross(sub(b, a), sub(p, a)) < 0) {
      inside = false;
      break;
    }
  }
  if (inside) return p;

  let best = zone[0]!;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const a = zone[i]!;
    const b = zone[(i + 1) % n]!;
    const ab = sub(b, a);
    const l2 = ab.x * ab.x + ab.y * ab.y;
    const t = l2 < 1e-30 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2));
    const q = { x: a.x + ab.x * t, y: a.y + ab.y * t };
    const d = dist(p, q);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}
