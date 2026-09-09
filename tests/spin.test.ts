/**
 * The spin trigger.
 *
 * Tested as pure logic rather than through browser audio, because what can actually
 * go wrong here is the edge detection: a bare threshold comparison would refire on
 * every frame the wheel stays fast, which would machine-gun the whistle.
 *
 * The quantity being watched is real. Rolling without slipping gives omega = v / r,
 * so the spin ratio against the wheel's slowest point is rMax / r at the contact.
 */

import { describe, expect, it } from "vitest";
import { SpinTrigger } from "../src/audio/spin.js";
import { circle, regularPolygon, star } from "../src/core/presets.js";
import { contactOn, prepareRoll, roadFromProfile } from "../src/core/road.js";
import { radiusExtent, radiusProfile } from "../src/core/wheel.js";
import { vec } from "../src/core/vec.js";

describe("rising-edge detection", () => {
  it("fires once on the way up, not on every frame above the threshold", () => {
    const t = new SpinTrigger(2.1, 1.7, 0);
    let fires = 0;
    // Climb through the threshold and stay high for many frames.
    for (let i = 0; i < 40; i++) {
      if (t.update(3.0, i * 0.016) !== null) fires++;
    }
    expect(fires).toBe(1);
  });

  it("re-arms only after the ratio falls back below the release level", () => {
    const t = new SpinTrigger(2.1, 1.7, 0);
    expect(t.update(3.0, 0)).not.toBeNull();

    // Still above release, so no refire even though it dipped.
    expect(t.update(1.9, 0.1)).toBeNull();
    expect(t.update(3.0, 0.2)).toBeNull();

    // Now below release, so the next climb fires again.
    expect(t.update(1.2, 0.3)).toBeNull();
    expect(t.update(3.0, 0.4)).not.toBeNull();
  });

  it("honours the cooldown", () => {
    const t = new SpinTrigger(2.1, 1.7, 0.5);
    expect(t.update(3.0, 0)).not.toBeNull();
    t.update(1.0, 0.1); // re-arm
    // Inside the cooldown, so silent despite being armed and over threshold.
    expect(t.update(3.0, 0.2)).toBeNull();
    t.update(1.0, 0.3);
    expect(t.update(3.0, 0.9)).not.toBeNull();
  });

  it("never fires below the threshold", () => {
    const t = new SpinTrigger(2.1, 1.7, 0);
    for (let i = 0; i < 30; i++) {
      expect(t.update(1.0 + i * 0.03, i * 0.016)).toBeNull();
    }
  });

  it("returns an intensity inside 0 to 1, rising with the overshoot", () => {
    const gentle = new SpinTrigger(2.1, 1.7, 0);
    const fierce = new SpinTrigger(2.1, 1.7, 0);
    const a = gentle.update(2.4, 0);
    const b = fierce.update(9.0, 0);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!).toBeGreaterThanOrEqual(0);
    expect(b!).toBeLessThanOrEqual(1);
    expect(b!).toBeGreaterThan(a!);
  });

  it("resets to armed", () => {
    const t = new SpinTrigger(2.1, 1.7, 10);
    expect(t.update(3.0, 0)).not.toBeNull();
    expect(t.update(3.0, 0.1)).toBeNull();
    t.reset();
    expect(t.update(3.0, 0.2)).not.toBeNull();
  });
});

describe("what the trigger actually sees while rolling", () => {
  const spinRatios = (outline: Parameters<typeof radiusProfile>[0]) => {
    const profile = radiusProfile(outline, vec(0, 0), 1024);
    const road = roadFromProfile(profile);
    const track = prepareRoll(profile);
    const rMax = radiusExtent(profile).max;
    const out: number[] = [];
    for (let i = 0; i < 240; i++) {
      const c = contactOn(track, (i / 240) * road.period);
      out.push(rMax / c.radius);
    }
    return out;
  };

  it("stays flat for a circle, so a circle never whistles", () => {
    const ratios = spinRatios(circle(1, 512));
    expect(Math.max(...ratios)).toBeLessThan(1.05);

    const t = new SpinTrigger();
    let fires = 0;
    ratios.forEach((r, i) => {
      if (t.update(r, i * 0.016) !== null) fires++;
    });
    expect(fires).toBe(0);
  });

  it("spikes on a star, and fires once per point", () => {
    const ratios = spinRatios(star());
    // A five-pointed star's reach runs 0.42 to 1, so the spin swings by about 2.4x.
    expect(Math.max(...ratios)).toBeGreaterThan(2.2);

    const t = new SpinTrigger(2.1, 1.7, 0);
    let fires = 0;
    ratios.forEach((r, i) => {
      if (t.update(r, i * 0.016) !== null) fires++;
    });
    // Five-fold symmetry, so five fast corners in one period.
    expect(fires).toBe(5);
  });

  it("does not fire for a gentle polygon", () => {
    const ratios = spinRatios(regularPolygon(8));
    const t = new SpinTrigger();
    let fires = 0;
    ratios.forEach((r, i) => {
      if (t.update(r, i * 0.016) !== null) fires++;
    });
    expect(fires).toBe(0);
  });
});
