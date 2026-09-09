/**
 * Built-in outlines.
 *
 * Includes the two cases that prove the solver correct (square and circle), the
 * case that is valid mathematically but cannot be built (equilateral triangle),
 * and a crescent that has no permissible hub zone at all, which is the honest
 * refusal the interface needs to demonstrate.
 *
 * Pure. No DOM.
 */

import type { Polygon } from "./polygon.js";
import { type Vec, vec } from "./vec.js";

export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly outline: Polygon;
  /** Note surfaced in the interface, kept factual. */
  readonly note?: string;
}

/** Regular n-gon inscribed in a circle of the given radius, vertex up. */
export function regularPolygon(sides: number, radius = 1, rotation = 0): Polygon {
  const out: Vec[] = [];
  const tau = Math.PI * 2;
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * tau;
    out.push(vec(radius * Math.cos(a), radius * Math.sin(a)));
  }
  return out;
}

/** Axis-aligned square of the given half-side. */
export function square(halfSide = 1): Polygon {
  return [
    vec(-halfSide, -halfSide),
    vec(halfSide, -halfSide),
    vec(halfSide, halfSide),
    vec(-halfSide, halfSide),
  ];
}

/** Circle approximated by a fine ring. */
export function circle(radius = 1, segments = 256): Polygon {
  const out: Vec[] = [];
  const tau = Math.PI * 2;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * tau;
    out.push(vec(radius * Math.cos(a), radius * Math.sin(a)));
  }
  return out;
}

/** Rounded rectangle, a shape whose road is gentle enough to actually build. */
export function roundedRect(
  halfWidth = 1.4,
  halfHeight = 0.9,
  cornerRadius = 0.35,
  perCorner = 16,
): Polygon {
  const rad = Math.min(cornerRadius, halfWidth, halfHeight);
  const out: Vec[] = [];
  const corners: ReadonlyArray<{ c: Vec; start: number }> = [
    { c: vec(halfWidth - rad, halfHeight - rad), start: 0 },
    { c: vec(-halfWidth + rad, halfHeight - rad), start: Math.PI / 2 },
    { c: vec(-halfWidth + rad, -halfHeight + rad), start: Math.PI },
    { c: vec(halfWidth - rad, -halfHeight + rad), start: (3 * Math.PI) / 2 },
  ];
  for (const { c, start } of corners) {
    for (let i = 0; i <= perCorner; i++) {
      const a = start + (i / perCorner) * (Math.PI / 2);
      out.push(vec(c.x + rad * Math.cos(a), c.y + rad * Math.sin(a)));
    }
  }
  return out;
}

/** Five-pointed star. Star-shaped about its centre, with a small hub zone. */
export function star(points = 5, outer = 1, inner = 0.42): Polygon {
  const out: Vec[] = [];
  const tau = Math.PI * 2;
  const step = tau / (points * 2);
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + i * step;
    out.push(vec(rad * Math.cos(a), rad * Math.sin(a)));
  }
  return out;
}

/**
 * Crescent. Deliberately has no permissible hub zone: no interior point can see
 * both horns, so it cannot roll on any road. Used to exercise the refusal state.
 *
 * The two arc endpoints are computed from where the circles genuinely intersect
 * rather than guessed. Guessed endpoints leave a gap that the closing edge jumps
 * across, which makes the outline self-crossing, and it would then be refused for
 * the wrong reason entirely.
 */
export function crescent(segments = 72): Polygon {
  const outerR = 1;
  const innerR = 0.8;
  const offset = 0.35;

  // Solve |p| = outerR and |p - (offset, 0)| = innerR simultaneously.
  const ix = (outerR * outerR - innerR * innerR + offset * offset) / (2 * offset);
  const iy = Math.sqrt(Math.max(0, outerR * outerR - ix * ix));

  // Where those crossings sit on each circle.
  const outerAngle = Math.atan2(iy, ix);
  const innerAngle = Math.atan2(iy, ix - offset);

  const out: Vec[] = [];

  // Outer arc the long way round, from the upper crossing to the lower one.
  const outerSweep = 2 * Math.PI - 2 * outerAngle;
  for (let i = 0; i <= segments; i++) {
    const a = outerAngle + (i / segments) * outerSweep;
    out.push(vec(outerR * Math.cos(a), outerR * Math.sin(a)));
  }

  // Inner arc back, sweeping the long way so it passes through the inner circle's
  // leftward point. That is the half lying inside the outer circle, and it is what
  // carves the bite. Sweeping the short way instead reaches x = offset + innerR,
  // which is outside the outer circle entirely, and the outline then crosses itself.
  const innerSweep = -(2 * Math.PI - 2 * innerAngle);
  for (let i = 1; i < segments; i++) {
    const a = -innerAngle + (i / segments) * innerSweep;
    out.push(vec(offset + innerR * Math.cos(a), innerR * Math.sin(a)));
  }

  return out;
}

export const PRESETS: readonly Preset[] = [
  {
    id: "square",
    label: "Square",
    outline: square(1),
    note: "Rolls on linked inverted catenaries. The case this solver is tested against.",
  },
  {
    id: "circle",
    label: "Circle",
    outline: circle(1),
    note: "Rolls on a flat line, which is the one road everybody already knows.",
  },
  {
    id: "pentagon",
    label: "Pentagon",
    outline: regularPolygon(5, 1, Math.PI / 2),
  },
  {
    id: "triangle",
    label: "Triangle",
    outline: regularPolygon(3, 1, Math.PI / 2),
    note: "Valid on paper and unbuildable in wood: the vertices jam in the ruts.",
  },
  {
    id: "rounded",
    label: "Rounded rectangle",
    outline: roundedRect(),
    note: "Shallow ruts, so this is the pair most likely to actually roll once cut.",
  },
  {
    id: "star",
    label: "Star",
    outline: star(),
    note: "Star-shaped about its centre, but the hub zone is small.",
  },
  {
    id: "crescent",
    label: "Crescent",
    outline: crescent(),
    note: "No hub can see both horns, so no road exists. Kept to show the refusal.",
  },
];

export const presetById = (id: string): Preset | undefined =>
  PRESETS.find((p) => p.id === id);
