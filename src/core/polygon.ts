/**
 * Closed-polygon utilities: orientation, area, containment, simplification,
 * and reflex-vertex detection.
 *
 * Pure. No DOM.
 */

import { type Vec, cross, dist, sub } from "./vec.js";

export type Polygon = readonly Vec[];

/** Signed area. Positive when the ring is counterclockwise. */
export function signedArea(poly: Polygon): number {
  const n = poly.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export const area = (poly: Polygon): number => Math.abs(signedArea(poly));

export const isCounterClockwise = (poly: Polygon): boolean => signedArea(poly) > 0;

/** Return the ring counterclockwise, copying only when a flip is needed. */
export function toCounterClockwise(poly: Polygon): Polygon {
  return isCounterClockwise(poly) ? poly : [...poly].reverse();
}

export function centroid(poly: Polygon): Vec {
  const n = poly.length;
  if (n === 0) return { x: 0, y: 0 };

  const a2 = signedArea(poly) * 2;
  // Degenerate ring with no area: fall back to the vertex mean.
  if (Math.abs(a2) < 1e-15) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    const w = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * w;
    cy += (p.y + q.y) * w;
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

export function perimeter(poly: Polygon): number {
  const n = poly.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += dist(poly[i]!, poly[(i + 1) % n]!);
  return sum;
}

export function boundingBox(poly: Polygon): {
  min: Vec;
  max: Vec;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

/** Crossing-number containment test. Points exactly on an edge may go either way. */
export function containsPoint(poly: Polygon, p: Vec): boolean {
  const n = poly.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const straddles = a.y > p.y !== b.y > p.y;
    if (!straddles) continue;
    const t = (p.y - a.y) / (b.y - a.y);
    if (p.x < a.x + t * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

/**
 * Indices of reflex vertices, meaning interior angle greater than a straight
 * angle. These are the only vertices that can break star-shapedness, so they are
 * what an empty permissible zone should point at.
 *
 * `tolerance` ignores near-collinear noise, which freehand input is full of.
 */
export function reflexVertices(poly: Polygon, tolerance = 1e-12): number[] {
  const ring = toCounterClockwise(poly);
  const n = ring.length;
  const out: number[] = [];
  if (n < 4) return out;

  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n]!;
    const cur = ring[i]!;
    const next = ring[(i + 1) % n]!;
    // Counterclockwise ring turns left at convex vertices, so a right turn is reflex.
    if (cross(sub(cur, prev), sub(next, cur)) < -tolerance) out.push(i);
  }
  return out;
}

/** Perpendicular distance from p to the infinite line through a and b. */
function perpendicularDistance(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const len = Math.hypot(ab.x, ab.y);
  if (len < 1e-15) return dist(p, a);
  return Math.abs(cross(ab, sub(p, a))) / len;
}

/** Douglas-Peucker on an open chain, endpoints always retained. */
function simplifyChain(chain: Vec[], epsilon: number): Vec[] {
  if (chain.length < 3) return chain.slice();

  const first = chain[0]!;
  const last = chain[chain.length - 1]!;
  let worst = 0;
  let worstIndex = -1;

  for (let i = 1; i < chain.length - 1; i++) {
    const d = perpendicularDistance(chain[i]!, first, last);
    if (d > worst) {
      worst = d;
      worstIndex = i;
    }
  }

  if (worst <= epsilon || worstIndex < 0) return [first, last];

  const left = simplifyChain(chain.slice(0, worstIndex + 1), epsilon);
  const right = simplifyChain(chain.slice(worstIndex), epsilon);
  return [...left.slice(0, -1), ...right];
}

/**
 * Simplify a closed ring.
 *
 * Running plain Douglas-Peucker on a closed ring as if it were an open chain
 * always retains the first and last points, which privileges wherever the pointer
 * happened to go down and freezes any wobble there into a permanent corner. This
 * splits the loop at two geometric extremes instead, so the result is a property
 * of the shape rather than of the stroke. Eigendrum learned this the hard way.
 */
export function simplifyClosed(poly: Polygon, epsilon: number): Polygon {
  const n = poly.length;
  if (n < 4 || epsilon <= 0) return poly.slice();

  const c = centroid(poly);

  // First anchor: the vertex furthest from the centroid.
  let iFar = 0;
  let dFar = -1;
  for (let i = 0; i < n; i++) {
    const d = dist(poly[i]!, c);
    if (d > dFar) {
      dFar = d;
      iFar = i;
    }
  }

  // Second anchor: the vertex furthest from the first.
  let jFar = 0;
  let dJ = -1;
  for (let i = 0; i < n; i++) {
    const d = dist(poly[i]!, poly[iFar]!);
    if (d > dJ) {
      dJ = d;
      jFar = i;
    }
  }

  if (iFar === jFar) return poly.slice();

  const lo = Math.min(iFar, jFar);
  const hi = Math.max(iFar, jFar);

  const chainA: Vec[] = [];
  for (let i = lo; i <= hi; i++) chainA.push(poly[i]!);

  const chainB: Vec[] = [];
  for (let i = hi; i < n; i++) chainB.push(poly[i]!);
  for (let i = 0; i <= lo; i++) chainB.push(poly[i]!);

  const a = simplifyChain(chainA, epsilon);
  const b = simplifyChain(chainB, epsilon);

  // Both chains share their endpoints, so drop the duplicates when rejoining.
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Drop consecutive duplicate points, including the wrap-around pair. */
export function dedupe(poly: Polygon, tolerance = 1e-9): Polygon {
  const out: Vec[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > tolerance) out.push(p);
  }
  while (out.length > 1 && dist(out[0]!, out[out.length - 1]!) <= tolerance) out.pop();
  return out;
}

/** True when any two non-adjacent edges cross. O(n^2), fine at our sizes. */
export function selfIntersects(poly: Polygon): boolean {
  const n = poly.length;
  if (n < 4) return false;

  const segmentsCross = (p1: Vec, p2: Vec, p3: Vec, p4: Vec): boolean => {
    const d1 = cross(sub(p2, p1), sub(p3, p1));
    const d2 = cross(sub(p2, p1), sub(p4, p1));
    const d3 = cross(sub(p4, p3), sub(p1, p3));
    const d4 = cross(sub(p4, p3), sub(p2, p3));
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };

  for (let i = 0; i < n; i++) {
    const a1 = poly[i]!;
    const a2 = poly[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent edges and the wrap-around neighbour pair.
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const b1 = poly[j]!;
      const b2 = poly[(j + 1) % n]!;
      if (segmentsCross(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}
