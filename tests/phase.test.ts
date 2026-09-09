/**
 * Wheel phase across a wheelbase.
 *
 * This pins a claim that was recorded wrongly once and had to be corrected before
 * the assembly view was built. The wrong version said the wheelbase must be a whole
 * number of road periods or the frame tilts. That only holds for phase-locked
 * wheels. A bicycle's wheels turn independently, so each one takes whatever phase
 * its own road position demands and both hubs ride level at any wheelbase.
 *
 * What is actually true, and what the interface reports:
 *
 *   theta(x + P) = theta(x) + 2*PI     from the closure condition
 *
 * so a wheelbase of a whole number of periods puts the two wheels in identical
 * orientation, and any other wheelbase leaves them measurably out of phase.
 */

import { describe, expect, it } from "vitest";
import { circle, regularPolygon, roundedRect, square, star } from "../src/core/presets.js";
import { contactOn, prepareRoll, roadFromProfile } from "../src/core/road.js";
import { radiusProfile } from "../src/core/wheel.js";
import { vec } from "../src/core/vec.js";
import type { Polygon } from "../src/core/polygon.js";

const TAU = Math.PI * 2;

function setup(outline: Polygon) {
  const profile = radiusProfile(outline, vec(0, 0), 2048);
  return { road: roadFromProfile(profile), track: prepareRoll(profile) };
}

/** Orientation difference between a lead hub and one trailing it by `wheelbase`. */
function phaseOffset(outline: Polygon, wheelbasePeriods: number, at = 0.37): number {
  const { road, track } = setup(outline);
  const lead = at * road.period;
  const trail = lead - wheelbasePeriods * road.period;
  const a = contactOn(track, lead).theta;
  const b = contactOn(track, trail).theta;
  const raw = ((a - b) % TAU + TAU) % TAU;
  // Fold onto 0..PI, since a full turn either way is the same orientation.
  return Math.min(raw, TAU - raw);
}

const shapes: ReadonlyArray<readonly [string, Polygon]> = [
  ["square", square(1)],
  ["circle", circle(1, 256)],
  ["pentagon", regularPolygon(5)],
  ["rounded rectangle", roundedRect()],
  ["star", star()],
];

describe("a whole number of periods puts the wheels in identical orientation", () => {
  for (const [name, outline] of shapes) {
    it(`holds for the ${name} at 1, 2 and 3 periods`, () => {
      for (const periods of [1, 2, 3]) {
        // Radians. Generous against sampling, and far below the 1.5 degree the
        // interface uses to declare "in phase".
        expect(phaseOffset(outline, periods)).toBeLessThan(0.01);
      }
    });
  }

  it("holds wherever along the road it is measured", () => {
    for (const at of [0.05, 0.31, 0.5, 0.79, 0.96]) {
      expect(phaseOffset(square(1), 2, at)).toBeLessThan(0.01);
    }
  });
});

describe("a fractional wheelbase leaves the wheels out of phase", () => {
  // The circle is deliberately excluded: it is rotationally symmetric, so every
  // orientation looks the same and "out of phase" has no visible meaning for it.
  const asymmetric = shapes.filter(([name]) => name !== "circle");

  for (const [name, outline] of asymmetric) {
    it(`holds for the ${name} at half a period`, () => {
      // Half a period is half a turn, the furthest two wheels can be from matching.
      expect(phaseOffset(outline, 0.5)).toBeGreaterThan(1.0);
    });
  }

  it("grows then shrinks as the wheelbase sweeps from zero to one period", () => {
    const offsets = [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => phaseOffset(square(1), p));
    // Peaks in the middle and comes back, because it is folded onto 0..PI.
    expect(offsets[2]!).toBeGreaterThan(offsets[0]!);
    expect(offsets[2]!).toBeGreaterThan(offsets[4]!);
  });
});

describe("both hubs ride level at any wheelbase", () => {
  // The correction, asserted directly. Independent wheels each present the radius
  // their own road position demands, so neither hub rises or falls, whatever the
  // spacing between them.
  for (const [name, outline] of shapes) {
    it(`holds for the ${name} at awkward spacings`, () => {
      const { road, track } = setup(outline);
      for (const periods of [0.13, 0.5, 0.77, 1.42, 2.61]) {
        for (let i = 0; i < 12; i++) {
          const lead = (i / 12) * road.period;
          const trail = lead - periods * road.period;
          // Hub height above its contact is the contact radius, for both wheels.
          expect(contactOn(track, lead).radius).toBeGreaterThan(0);
          expect(contactOn(track, trail).radius).toBeGreaterThan(0);
        }
      }
    });
  }
});
