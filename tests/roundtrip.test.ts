/**
 * Both directions must agree.
 *
 * wheel -> road -> wheel has to return the original radius profile, because the
 * road is draggable and the two directions are the same relationship read two
 * ways. A drift here would show up as the wheel changing shape when the visitor
 * touches the road, which would make the product incoherent.
 *
 * Also pins the closure condition, which is what the interface's filling gauge
 * reports.
 */

import { describe, expect, it } from "vitest";
import { circle, regularPolygon, roundedRect, square } from "../src/core/presets.js";
import {
  closureRatio,
  contactAt,
  profileFromRoad,
  roadFromProfile,
} from "../src/core/road.js";
import { radiusProfile } from "../src/core/wheel.js";
import { vec } from "../src/core/vec.js";

/** Resample a road onto uniform x spacing, which is what the inverse expects. */
function sampleRoadUniformly(
  points: readonly { x: number; y: number }[],
  period: number,
  samples: number,
): { roadY: Float64Array; dx: number } {
  const dx = period / samples;
  const roadY = new Float64Array(samples);

  let j = 0;
  for (let i = 0; i < samples; i++) {
    const x = i * dx;
    while (j < points.length - 2 && points[j + 1]!.x < x) j++;
    const a = points[j]!;
    const b = points[j + 1]!;
    const span = b.x - a.x;
    const t = span > 1e-15 ? (x - a.x) / span : 0;
    roadY[i] = a.y + (b.y - a.y) * t;
  }
  return { roadY, dx };
}

describe("wheel to road to wheel", () => {
  const cases = [
    ["circle", circle(1, 512), 2e-3],
    ["square", square(1), 2e-2],
    ["pentagon", regularPolygon(5), 2e-2],
    ["rounded rectangle", roundedRect(), 2e-2],
  ] as const;

  for (const [name, outline, tolerance] of cases) {
    it(`recovers the ${name}'s radius profile`, () => {
      const forward = radiusProfile(outline, vec(0, 0), 1024);
      const road = roadFromProfile(forward);
      const { roadY, dx } = sampleRoadUniformly(road.points, road.period, 2048);
      const back = profileFromRoad(roadY, dx, 1024);

      // The closure must come out as one full turn, since this road came from a
      // real closed wheel.
      expect(closureRatio(back.closure)).toBeCloseTo(1, 2);

      let worst = 0;
      for (let i = 0; i < forward.r.length; i++) {
        const rel = Math.abs(back.r[i]! - forward.r[i]!) / forward.r[i]!;
        worst = Math.max(worst, rel);
      }
      expect(worst).toBeLessThan(tolerance);
    });
  }
});

describe("closure condition", () => {
  it("reports one turn for a road derived from a closed wheel", () => {
    const forward = radiusProfile(circle(1, 512), vec(0, 0), 1024);
    const road = roadFromProfile(forward);
    const { roadY, dx } = sampleRoadUniformly(road.points, road.period, 2048);
    expect(closureRatio(profileFromRoad(roadY, dx, 512).closure)).toBeCloseTo(1, 3);
  });

  it("reports less than one turn for a road period that is too short", () => {
    // Half a circle's road cannot turn a whole wheel.
    const forward = radiusProfile(circle(1, 512), vec(0, 0), 1024);
    const road = roadFromProfile(forward);
    const { roadY, dx } = sampleRoadUniformly(road.points, road.period / 2, 1024);
    expect(closureRatio(profileFromRoad(roadY, dx, 512).closure)).toBeLessThan(0.9);
  });

  it("rejects a road at or above the hub", () => {
    const bad = new Float64Array([-1, -1, 0, -1]);
    expect(() => profileFromRoad(bad, 0.1, 64)).toThrow();
  });
});

describe("contact tracking", () => {
  // If rotation were integrated separately from position the wheel would visibly
  // slip, which would destroy the only claim the product makes.
  it("advances the contact angle monotonically through one period", () => {
    const profile = radiusProfile(square(1), vec(0, 0), 512);
    const road = roadFromProfile(profile);

    let previous = -1;
    for (let i = 0; i <= 40; i++) {
      const travelled = (i / 40) * road.period * 0.999;
      const c = contactAt(profile, travelled);
      expect(c.theta).toBeGreaterThanOrEqual(previous);
      previous = c.theta;
    }
  });

  it("loops seamlessly, so one full period returns to the start", () => {
    const profile = radiusProfile(square(1), vec(0, 0), 512);
    const road = roadFromProfile(profile);
    const start = contactAt(profile, 0);
    const wrapped = contactAt(profile, road.period);
    expect(wrapped.x).toBeCloseTo(start.x, 6);
    expect(wrapped.theta).toBeCloseTo(start.theta, 6);
  });
});
