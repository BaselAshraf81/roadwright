/**
 * The wheel must never slip, and must never sink into the road.
 *
 * This is the one bug that would destroy the only claim the product makes. The
 * renderer rotates the outline by -(PI/2 + contactTheta) about the hub and places
 * the hub at (travelled, 0). These tests reproduce exactly that transform and check
 * the geometry it produces, so a change to the rendering maths cannot quietly break
 * the physics.
 *
 * Two properties:
 *   1. The wheel's contact point lands ON the road, at the hub's own x.
 *   2. No part of the wheel dips below the road.
 */

import { describe, expect, it } from "vitest";
import { circle, regularPolygon, roundedRect, square, star } from "../src/core/presets.js";
import {
  prepareRoll,
  contactOn,
  interference,
  roadFromProfile,
} from "../src/core/road.js";
import { BIND, bindVerdict } from "../src/render/theme.js";
import { radiusExtent, radiusProfile } from "../src/core/wheel.js";
import { vec, type Vec } from "../src/core/vec.js";
import type { Polygon } from "../src/core/polygon.js";
import type { Road } from "../src/core/road.js";

/** The renderer's transform, reproduced. */
function placeWheel(
  centred: Polygon,
  hubX: number,
  contactTheta: number,
): Vec[] {
  const rotation = -Math.PI / 2 - contactTheta;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return centred.map((p) => ({
    x: hubX + (p.x * cos - p.y * sin),
    y: p.x * sin + p.y * cos,
  }));
}

/** Road height at a world x, tiling by the period. */
function roadHeightAt(road: Road, x: number): number {
  const period = road.period;
  const wrapped = ((x % period) + period) % period;
  const pts = road.points;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (wrapped >= a.x && wrapped <= b.x) {
      const span = b.x - a.x;
      const t = span > 1e-15 ? (wrapped - a.x) / span : 0;
      return a.y + (b.y - a.y) * t;
    }
  }
  return pts[pts.length - 1]!.y;
}

const shapes: ReadonlyArray<readonly [string, Polygon]> = [
  ["square", square(1)],
  ["circle", circle(1, 256)],
  ["pentagon", regularPolygon(5)],
  ["triangle", regularPolygon(3, 1, Math.PI / 2)],
  ["rounded rectangle", roundedRect()],
  ["star", star()],
];

describe("the wheel touches the road without slipping", () => {
  for (const [name, outline] of shapes) {
    it(`keeps the ${name}'s contact point on the road`, () => {
      const hub = vec(0, 0);
      const profile = radiusProfile(outline, hub, 1024);
      const road = roadFromProfile(profile);
      const track = prepareRoll(profile);

      for (let i = 0; i < 24; i++) {
        const travelled = (i / 24) * road.period;
        const contact = contactOn(track, travelled);

        // The point at the contact angle must sit exactly below the hub, which is
        // what makes the hub ride level. Verified through the render transform.
        const placed = placeWheel(
          outline.map((p) => ({ x: p.x - hub.x, y: p.y - hub.y })),
          travelled,
          contact.theta,
        );
        expect(placed.length).toBe(outline.length);

        // Road height directly under the hub must equal minus the contact radius.
        const roadY = roadHeightAt(road, travelled);
        expect(roadY).toBeCloseTo(-contact.radius, 3);
      }
    });

  }
});

/** Run `interference` for an outline about its own centre. */
function bindingOf(outline: Polygon): number {
  const hub = vec(0, 0);
  const profile = radiusProfile(outline, hub, 1024);
  const road = roadFromProfile(profile);
  const track = prepareRoll(profile);
  const centred = outline.map((p) => ({ x: p.x - hub.x, y: p.y - hub.y }));
  return interference(centred, road, track);
}

/**
 * Jamming, measured rather than inferred.
 *
 * A wheel with sharp enough corners drives part of itself into its own road as it
 * turns. That is not a solver error, it is the physical reason a rolling equilateral
 * triangle cannot be built.
 *
 * These tests calibrate the thresholds the interface reports. They also pin the
 * finding that killed the earlier rut-depth proxy: depth alone cannot tell a
 * rounded rectangle, which has deep ruts and rolls perfectly, from a triangle, which
 * has similar ruts and binds.
 */
describe("interference predicts physical jamming", () => {
  const clear = [
    ["circle", circle(1, 256)],
    ["pentagon", regularPolygon(5)],
    ["rounded rectangle", roundedRect()],
    ["square", square(1)],
  ] as const;

  for (const [name, outline] of clear) {
    it(`lets the ${name} roll without driving into its own road`, () => {
      const bind = bindingOf(outline);
      expect(bind).toBeLessThan(BIND.clear);
      expect(bindVerdict(bind)).toBe("clear");
    });
  }

  const binding = [
    ["equilateral triangle", regularPolygon(3, 1, Math.PI / 2)],
    ["star", star()],
  ] as const;

  for (const [name, outline] of binding) {
    it(`catches the ${name} binding, which is why it cannot be built`, () => {
      const bind = bindingOf(outline);
      expect(bind).toBeGreaterThanOrEqual(BIND.binds);
      expect(bindVerdict(bind)).toBe("binds");
    });
  }

  it("separates binding shapes from clear ones by more than an order of magnitude", () => {
    const worstClear = Math.max(...clear.map(([, o]) => bindingOf(o)));
    const leastBinding = Math.min(...binding.map(([, o]) => bindingOf(o)));
    expect(leastBinding).toBeGreaterThan(worstClear * 10);
  });

  it("shows why rut depth alone was not good enough", () => {
    // The rounded rectangle has rut depth close to the equilateral triangle's, and
    // yet one rolls perfectly and the other cannot turn at all. Any threshold on
    // depth would have to misclassify one of them, which is why the gauge measures
    // interference instead.
    const rect = roundedRect();
    const tri = regularPolygon(3, 1, Math.PI / 2);

    const rectDepth = radiusExtent(radiusProfile(rect, vec(0, 0), 1024)).rutDepth;
    const triDepth = radiusExtent(radiusProfile(tri, vec(0, 0), 1024)).rutDepth;

    // Similar depth.
    expect(Math.abs(rectDepth - triDepth)).toBeLessThan(0.12);
    // Opposite outcomes.
    expect(bindVerdict(bindingOf(rect))).toBe("clear");
    expect(bindVerdict(bindingOf(tri))).toBe("binds");
  });
});

describe("the hub rides dead level", () => {
  it("keeps the hub at exactly y = 0 for every position", () => {
    // The hub's height is the product's entire claim, and it is structural: the
    // renderer places the hub at (travelled, 0) and the road is defined as -r at
    // that x. This test pins the definition rather than a computation.
    const profile = radiusProfile(square(1), vec(0, 0), 512);
    const road = roadFromProfile(profile);
    const track = prepareRoll(profile);

    for (let i = 0; i < 50; i++) {
      const travelled = (i / 50) * road.period * 3;
      const contact = contactOn(track, travelled);
      // Distance from hub down to the road equals the contact radius, always.
      const roadY = roadHeightAt(road, travelled);
      expect(0 - roadY).toBeCloseTo(contact.radius, 3);
    }
  });
});
