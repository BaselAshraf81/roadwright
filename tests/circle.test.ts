/**
 * The second proof test, and the one every visitor can check by eye.
 *
 * A circle rolls on a flat line. Its radius profile is constant, so y = -R
 * everywhere and the period is the circumference.
 */

import { describe, expect, it } from "vitest";
import { circle } from "../src/core/presets.js";
import { roadFromProfile } from "../src/core/road.js";
import { radiusProfile, radiusExtent } from "../src/core/wheel.js";
import { vec } from "../src/core/vec.js";

describe("circle rolls on a flat road", () => {
  const R = 1;
  // A fine ring, because a coarse polygon is genuinely not a circle and its road
  // genuinely is not flat. The tolerance below reflects the ring resolution.
  const profile = radiusProfile(circle(R, 2048), vec(0, 0), 2048);
  const road = roadFromProfile(profile);

  it("is flat to within the polygon approximation", () => {
    let worst = 0;
    for (const p of road.points) worst = Math.max(worst, Math.abs(p.y + R));
    // A 2048-gon's inradius differs from its circumradius by about 1.2e-6.
    expect(worst).toBeLessThan(5e-6);
  });

  it("has a period equal to the circumference", () => {
    expect(road.period).toBeCloseTo(2 * Math.PI * R, 4);
  });

  it("has effectively zero rut depth", () => {
    expect(radiusExtent(profile).rutDepth).toBeLessThan(1e-5);
  });

  it("scales its period linearly with radius", () => {
    const big = roadFromProfile(radiusProfile(circle(3, 2048), vec(0, 0), 2048));
    expect(big.period / road.period).toBeCloseTo(3, 4);
  });
});
