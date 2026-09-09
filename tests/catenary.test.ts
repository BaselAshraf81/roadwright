/**
 * THE proof test.
 *
 * A square wheel of half-side a, hub at its centre, must roll on an inverted
 * catenary y = -a * cosh(x / a). Derivation:
 *
 *   r(theta)  = a / cos(theta)                 on the face facing the road
 *   x(theta)  = integral of a * sec(theta)     = a * ln(sec + tan)
 *   y(theta)  = -a * sec(theta)
 *
 * and since ln(sec t + tan t) = arcsinh(tan t), we get sinh(x/a) = tan(theta),
 * hence cosh(x/a) = sec(theta), hence y = -a * cosh(x / a).
 *
 * This is a closed-form result, so correctness here is provable rather than
 * asserted. If this test fails the product is wrong, whatever the animation looks
 * like.
 */

import { describe, expect, it } from "vitest";
import { square, regularPolygon } from "../src/core/presets.js";
import { roadFromProfile } from "../src/core/road.js";
import { radiusProfile, radiusExtent } from "../src/core/wheel.js";
import { vec } from "../src/core/vec.js";

describe("square wheel rolls on an inverted catenary", () => {
  const a = 1;
  const profile = radiusProfile(square(a), vec(0, 0), 4096);
  const road = roadFromProfile(profile);

  it("matches y = -a*cosh(x/a) across the first half face", () => {
    // Sampling starts at theta = 0, which is the MIDDLE of a face, not a corner.
    // Going forward covers half a face, so a period/8, and each face carries its
    // own catenary with its own vertex. Running past the corner would compare
    // against the neighbouring face's catenary and fail by a wide margin.
    const faceEnd = road.period / 8;

    let worstAbsolute = 0;
    let worstRelative = 0;
    let checked = 0;

    for (const p of road.points) {
      if (p.x > faceEnd) break;
      // Each face starts its own catenary, centred on the face midpoint. The first
      // sample sits at theta = 0, which is the middle of a face, so x measures from
      // the catenary's own vertex directly.
      const expected = -a * Math.cosh(p.x / a);
      const err = Math.abs(p.y - expected);
      worstAbsolute = Math.max(worstAbsolute, err);
      worstRelative = Math.max(worstRelative, err / Math.abs(expected));
      checked++;
    }

    expect(checked).toBeGreaterThan(100);
    // Trapezoid integration at 4096 samples, so this is integration error only.
    expect(worstRelative).toBeLessThan(1e-6);
  });

  it("has a horizontal period of 8*a*artanh-style catenary length, not the perimeter", () => {
    // The road's horizontal extent is the integral of r dtheta, which for a square
    // is 4 faces * 2 * ln(1 + sqrt(2)). That is 7.0509a, NOT the perimeter 8a.
    // Only a circle makes those two quantities agree, and confusing them is the
    // arc-length-versus-angle trap this project was warned about.
    const expected = 8 * a * Math.log(1 + Math.SQRT2);
    expect(road.period).toBeCloseTo(expected, 5);
    expect(road.period).toBeLessThan(8 * a);
  });

  it("has a road arc length equal to the wheel perimeter, which is what rolling means", () => {
    // Slip-free rolling requires arc along the road to match arc along the wheel.
    // The square's perimeter is 8a, and the road's arc length must match it.
    let arc = 0;
    for (let i = 1; i < road.points.length; i++) {
      const p = road.points[i - 1]!;
      const q = road.points[i]!;
      arc += Math.hypot(q.x - p.x, q.y - p.y);
    }
    expect(arc).toBeCloseTo(8 * a, 3);
  });

  it("keeps the axle above every point of the road", () => {
    for (const p of road.points) expect(p.y).toBeLessThan(0);
  });

  it("touches the road at the half-side distance under a face centre", () => {
    // At theta = 0 the contact sits at distance a, the shortest radius.
    const extent = radiusExtent(profile);
    expect(extent.min).toBeCloseTo(a, 6);
    // The corner is the longest radius, at a*sqrt(2).
    expect(extent.max).toBeCloseTo(a * Math.SQRT2, 3);
  });

  it("reports the rut depth that predicts physical jamming", () => {
    const squareDepth = radiusExtent(profile).rutDepth;
    // 1 - cos(45 degrees).
    expect(squareDepth).toBeCloseTo(1 - Math.SQRT1_2, 3);

    // The equilateral triangle is the known-unbuildable case, and it must score
    // worse than the square, since 1 - cos(60) = 0.5.
    const triProfile = radiusProfile(regularPolygon(3, 1, Math.PI / 2), vec(0, 0), 4096);
    const triDepth = radiusExtent(triProfile).rutDepth;
    expect(triDepth).toBeCloseTo(0.5, 2);
    expect(triDepth).toBeGreaterThan(squareDepth);
  });
});
