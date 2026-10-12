/**
 * Where the default axle lands, and why a hand-drawn shape must not wreck it.
 *
 * A visitor drew a Reuleaux triangle and the axle sat in the middle of its right half.
 * Cause: every tiny inward wobble in a hand-drawn line puts a supporting line through
 * the whole shape, the axle zone loses everything on the wrong side, and the axle goes
 * to the middle of what is left. These tests pin the fix: near-convex drawings are
 * smoothed (with the original kept as a ghost), and the default axle is a true
 * deepest point rather than a rough one.
 */

import { describe, expect, it } from "vitest";
import { hubZone } from "../src/core/kernel.js";
import {
  area,
  boundingBox,
  centroid,
  convexHull,
  simplifyClosed,
} from "../src/core/polygon.js";
import { circle, roundedRect, star } from "../src/core/presets.js";
import { validateOutline } from "../src/core/validate.js";
import { type Vec, vec } from "../src/core/vec.js";

/** Deterministic PRNG so the tests are repeatable. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Reuleaux triangle of width 1, corner up, counterclockwise. */
function reuleaux(samplesPerArc = 60): Vec[] {
  const R = 1 / Math.sqrt(3);
  const angles = [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3];
  const v = angles.map((a) => vec(R * Math.cos(a), R * Math.sin(a)));
  const pts: Vec[] = [];
  for (let k = 0; k < 3; k++) {
    const a = v[k]!;
    const b = v[(k + 1) % 3]!;
    const c = v[(k + 2) % 3]!;
    const a0 = Math.atan2(a.y - c.y, a.x - c.x);
    let a1 = Math.atan2(b.y - c.y, b.x - c.x);
    while (a1 < a0) a1 += 2 * Math.PI;
    if (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
    for (let i = 0; i < samplesPerArc; i++) {
      const t = a0 + ((a1 - a0) * i) / samplesPerArc;
      pts.push(vec(c.x + Math.cos(t), c.y + Math.sin(t)));
    }
  }
  return pts;
}

/** A hand-wobbled copy: slow drift plus pointer jitter, as a fraction of the shape's width. */
function wobble(base: Vec[], fraction: number, rand: () => number): Vec[] {
  const n = base.length;
  const freq = 2 + Math.floor(rand() * 3);
  const phase = rand() * Math.PI * 2;
  const shift = Math.floor(rand() * n);
  return base.map((_, i) => {
    const p = base[(i + shift) % n]!;
    const w =
      Math.sin(freq * (i / n) * Math.PI * 2 + phase) * fraction * 0.7 +
      (rand() - 0.5) * fraction;
    const len = Math.hypot(p.x, p.y) || 1;
    return vec(p.x + (p.x / len) * w, p.y + (p.y / len) * w);
  });
}

const spanOf = (p: readonly Vec[]): number => {
  const b = boundingBox(p);
  return Math.max(b.max.x - b.min.x, b.max.y - b.min.y);
};

describe("default axle is the deepest point of its zone", () => {
  it("sits at the incentre of a right triangle", () => {
    // Legs 3 and 4, hypotenuse 5, so the inradius is 1 and the incentre is (1, 1).
    const r = validateOutline([vec(0, 0), vec(4, 0), vec(0, 3)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hub.x).toBeCloseTo(1, 2);
    expect(r.hub.y).toBeCloseTo(1, 2);
  });

  it("sits on the midline of a long rectangle", () => {
    const r = validateOutline([vec(0, 0), vec(4, 0), vec(4, 1), vec(0, 1)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hub.y).toBeCloseTo(0.5, 3);
  });

  it("stays inside the zone", () => {
    const outline = roundedRect();
    const z = hubZone(outline);
    expect(z.exists).toBe(true);
    const r = validateOutline(outline);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(area(z.zone)).toBeGreaterThan(0);
    expect(Math.abs(r.hub.x)).toBeLessThan(0.05);
    expect(Math.abs(r.hub.y)).toBeLessThan(0.05);
  });
});

describe("a perfect Reuleaux triangle", () => {
  it("keeps the whole shape as its zone and the axle at the centre", () => {
    const base = reuleaux();
    const r = validateOutline(simplifyClosed(base, spanOf(base) * 0.004));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adjusted).toBe(false);
    const c = centroid(r.original);
    expect(Math.hypot(r.hub.x - c.x, r.hub.y - c.y) / spanOf(base)).toBeLessThan(0.005);
  });
});

describe("a hand-drawn Reuleaux triangle", () => {
  it("is smoothed, keeps the whole shape as its zone, and centres the axle", () => {
    const base = reuleaux();
    const span = spanOf(base);
    let smoothedCount = 0;

    for (let seed = 1; seed <= 60; seed++) {
      const rand = rng(seed * 7919);
      const drawn = simplifyClosed(wobble(base, span * 0.015, rand), span * 0.004);
      const r = validateOutline(drawn);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;

      // The axle zone must cover essentially the whole solved shape.
      expect(area(r.zone.zone) / area(r.outline)).toBeGreaterThan(0.98);

      // And the axle must sit near the middle of the drawing, not off to one side.
      const c = centroid(r.original);
      expect(Math.hypot(r.hub.x - c.x, r.hub.y - c.y) / span).toBeLessThan(0.03);

      if (r.smoothed) {
        smoothedCount++;
        expect(r.adjusted).toBe(true);
        expect(r.deviation).toBeLessThanOrEqual(0.03);
        // The original is kept untouched so the interface can ghost it.
        expect(r.original.length).toBe(drawn.length);
      }
    }
    // At this wobble most drawings need smoothing, so the fix must actually fire.
    expect(smoothedCount).toBeGreaterThan(30);
  });
});

describe("real concavity is never smoothed away", () => {
  it("leaves a star alone", () => {
    const r = validateOutline(star());
    // A star may be bridged, but it must never be treated as a lightly dented convex shape.
    if (r.ok) expect(r.smoothed).toBe(false);
  });

  it("leaves a circle and a rounded rectangle unadjusted", () => {
    for (const outline of [circle(), roundedRect()]) {
      const r = validateOutline(outline);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.adjusted).toBe(false);
        expect(r.smoothed).toBe(false);
      }
    }
  });

  it("a hull only ever adds area", () => {
    const base = reuleaux();
    const drawn = wobble(base, spanOf(base) * 0.015, rng(42));
    expect(area(convexHull(drawn))).toBeGreaterThanOrEqual(area(drawn) - 1e-12);
  });
});
