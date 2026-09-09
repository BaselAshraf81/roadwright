/**
 * Every refusal reason must fire on the right outline, and only on it.
 *
 * The permissible hub zone is the whole hub solution, so these tests also pin the
 * property that makes it work: a hub taken from the zone always yields a
 * single-valued radius profile, which is exactly what having a road requires.
 */

import { describe, expect, it } from "vitest";
import { clampToZone, hubZone } from "../src/core/kernel.js";
import { area } from "../src/core/polygon.js";
import {
  circle,
  crescent,
  regularPolygon,
  roundedRect,
  square,
  star,
} from "../src/core/presets.js";
import { validateOutline } from "../src/core/validate.js";
import { radiusProfile } from "../src/core/wheel.js";
import { vec } from "../src/core/vec.js";

describe("refusals", () => {
  it("refuses fewer than three points", () => {
    const r = validateOutline([vec(0, 0), vec(1, 1)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe("too-few-points");
  });

  it("refuses an outline with no area", () => {
    const r = validateOutline([vec(0, 0), vec(1, 0), vec(2, 0), vec(3, 0)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe("zero-area");
  });

  it("refuses a self-crossing outline", () => {
    // A bowtie.
    const r = validateOutline([vec(-1, -1), vec(1, 1), vec(1, -1), vec(-1, 1)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe("self-intersecting");
  });

  it("refuses an axle placed outside the permissible zone", () => {
    // Far outside the square entirely.
    const r = validateOutline(square(1), vec(5, 5));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe("axle-outside-zone");
  });

  it("gives visitor-facing messages, not developer strings", () => {
    // A bowtie is one of the few shapes still genuinely refused.
    const r = validateOutline([vec(-1, -1), vec(1, 1), vec(1, -1), vec(-1, 1)]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.message.length).toBeGreaterThan(20);
      expect(r.refusal.message).not.toMatch(/error|invalid|null|undefined/i);
      // House style: no em dashes anywhere.
      expect(r.refusal.message).not.toContain("\u2014");
      // Plain language: no jargon the visitor never agreed to learn.
      expect(r.refusal.message).not.toMatch(/hub|kernel|star-shaped|polygon/i);
    }
  });
});

/**
 * Bridging, which is the change that stopped this product dead-ending most people.
 *
 * A crescent, an animal, anything with a crevice between two limbs is not
 * star-shaped and used to be refused. Refusing was correct and useless. Now the
 * pockets the axle cannot see are bridged and the result is reported as adjusted.
 */
describe("shapes that cannot roll get bridged instead of refused", () => {
  it("accepts a crescent by bridging across its horns", () => {
    const r = validateOutline(crescent());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.adjusted).toBe(true);
      // It genuinely had to change the drawing, and says by how much.
      expect(r.deviation).toBeGreaterThan(0.01);
      // The original is kept so the interface can show what was altered.
      expect(r.original.length).toBeGreaterThan(3);
      expect(r.zone.exists).toBe(true);
    }
  });

  it("leaves shapes that already roll completely untouched", () => {
    for (const outline of [square(1), circle(1, 128), regularPolygon(5), star()]) {
      const r = validateOutline(outline);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.adjusted).toBe(false);
        expect(r.deviation).toBe(0);
        // Same array, not a resampled copy.
        expect(r.outline.length).toBe(outline.length);
      }
    }
  });

  it("produces a bridged shape that really does roll", () => {
    const r = validateOutline(crescent());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The whole point: the adjusted outline must resolve a radius profile.
    expect(() => radiusProfile(r.outline, r.hub, 512)).not.toThrow();
    const p = radiusProfile(r.outline, r.hub, 512);
    for (let i = 0; i < p.r.length; i++) expect(p.r[i]!).toBeGreaterThan(0);
  });

  it("bridges a deep two-lobed doodle, the shape most freehand drawings resemble", () => {
    // Two blobs joined by a thin neck, with a deep notch on each side. This is the
    // family of shape that was failing for real visitors.
    const pts = [];
    const n = 180;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const rad = 1 + 0.55 * Math.cos(2 * t);
      pts.push(vec(rad * Math.cos(t), rad * Math.sin(t) * 0.62));
    }
    const r = validateOutline(pts);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(() => radiusProfile(r.outline, r.hub, 512)).not.toThrow();
    }
  });
});

describe("permissible hub zone", () => {
  it("is the whole shape for a convex outline", () => {
    const sq = square(1);
    const z = hubZone(sq);
    expect(z.exists).toBe(true);
    // A convex polygon sees itself entirely, so the kernel is the polygon.
    expect(area(z.zone)).toBeCloseTo(area(sq), 6);
  });

  it("is smaller than the shape for a star, but not empty", () => {
    const s = star();
    const z = hubZone(s);
    expect(z.exists).toBe(true);
    expect(area(z.zone)).toBeGreaterThan(0);
    expect(area(z.zone)).toBeLessThan(area(s));
  });

  it("is empty for a crescent, which is why bridging exists", () => {
    // The kernel itself is unchanged and still correctly empty. Bridging happens a
    // layer up, in validateOutline, rather than by weakening this test.
    expect(hubZone(crescent()).exists).toBe(false);
  });

  it("suggests a hub that is actually inside the zone", () => {
    for (const outline of [square(1), star(), regularPolygon(5), roundedRect()]) {
      const z = hubZone(outline);
      expect(z.exists).toBe(true);
      expect(z.suggested).not.toBeNull();
      if (z.suggested) {
        expect(clampToZone(z.zone, z.suggested)).toEqual(z.suggested);
      }
    }
  });

  it("clamps an outside hub back onto the zone", () => {
    const z = hubZone(square(1));
    const clamped = clampToZone(z.zone, vec(10, 10));
    expect(Math.abs(clamped.x)).toBeLessThanOrEqual(1 + 1e-9);
    expect(Math.abs(clamped.y)).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe("the zone guarantees a road exists", () => {
  // This is the property the entire hub design rests on: any hub drawn from the
  // zone yields exactly one crossing per direction, so r(theta) is single-valued.
  const shapes = [
    ["square", square(1)],
    ["circle", circle(1, 128)],
    ["pentagon", regularPolygon(5)],
    ["triangle", regularPolygon(3)],
    ["rounded rectangle", roundedRect()],
    ["star", star()],
  ] as const;

  for (const [name, outline] of shapes) {
    it(`holds for the ${name}, at the suggested hub and across the zone`, () => {
      const z = hubZone(outline);
      expect(z.exists).toBe(true);

      const candidates = [z.suggested!];
      // Pull the suggested hub most of the way toward each zone vertex, which is
      // the worst legal case, and confirm the profile still resolves.
      for (const v of z.zone) {
        candidates.push({
          x: z.suggested!.x + (v.x - z.suggested!.x) * 0.9,
          y: z.suggested!.y + (v.y - z.suggested!.y) * 0.9,
        });
      }

      for (const hub of candidates) {
        expect(() => radiusProfile(outline, hub, 512)).not.toThrow();
        const p = radiusProfile(outline, hub, 512);
        for (let i = 0; i < p.r.length; i++) expect(p.r[i]!).toBeGreaterThan(0);
      }
    });
  }
});
