/**
 * The single home for outline validity.
 *
 * Every entry path (freehand, preset, shared link) goes through this module. A
 * second validity check living somewhere else is how a product ends up giving
 * contradictory refusals for the same shape.
 *
 * Most drawings are no longer refused. A doodle whose crevices stop it rolling is
 * bridged into the closest rollable shape and reported as adjusted, because refusing
 * the majority of freehand input was correct and useless. Only outlines that cannot
 * be interpreted at all are still turned away, and each of those carries a named
 * reason written for the visitor rather than for a developer.
 *
 * Visitor-facing wording says "axle", not "hub". Everyone knows what an axle is.
 *
 * Pure. No DOM.
 */

import { hubZone, type HubZone } from "./kernel.js";
import {
  type Polygon,
  area,
  boundingBox,
  dedupe,
  selfIntersects,
} from "./polygon.js";
import { makeRollable } from "./rollable.js";
import type { Vec } from "./vec.js";

export type RefusalCode =
  | "too-few-points"
  | "zero-area"
  | "self-intersecting"
  | "cannot-roll"
  | "axle-outside-zone";

export interface Refusal {
  readonly code: RefusalCode;
  /** Visitor-facing sentence. States the reason and the way out. */
  readonly message: string;
  /**
   * A short label for stamping onto the drawing itself.
   *
   * Written rather than truncated from `message`. Cutting a sentence off mid-word
   * looks like a bug, and the full sentence already lives in the margin readout, so
   * the stamp only needs to name the cause.
   */
  readonly short: string;
  /** Outline vertex indices worth drawing attention to, when known. */
  readonly highlight: readonly number[];
}

export interface ValidOutline {
  readonly ok: true;
  /** The outline to solve, which may be a bridged version of the drawing. */
  readonly outline: Polygon;
  /** Exactly what the visitor drew, kept so the interface can show the difference. */
  readonly original: Polygon;
  /** True when bridging was needed to make the drawing roll. */
  readonly adjusted: boolean;
  /** Largest bridged gap as a fraction of the shape's size. Zero when untouched. */
  readonly deviation: number;
  readonly zone: HubZone;
  /** Axle to use, already inside the zone. */
  readonly hub: Vec;
}

export interface InvalidOutline {
  readonly ok: false;
  readonly refusal: Refusal;
  readonly zone: HubZone | null;
}

export type ValidationResult = ValidOutline | InvalidOutline;

const refuse = (
  code: RefusalCode,
  short: string,
  message: string,
  highlight: readonly number[] = [],
): Refusal => ({ code, short, message, highlight });

/**
 * Validate an outline and settle its axle.
 *
 * When `requestedHub` is given it is honoured if it lies inside the permissible
 * zone, and refused if it does not. When it is omitted the zone's deepest point is
 * used, which is why the product works on the first tap without anyone needing to
 * think about axles at all.
 */
export function validateOutline(
  rawOutline: Polygon,
  requestedHub?: Vec,
): ValidationResult {
  const original = dedupe(rawOutline);

  if (original.length < 3) {
    return {
      ok: false,
      zone: null,
      refusal: refuse(
        "too-few-points",
        "NOT ENOUGH OF A SHAPE",
        "That is too small to make a wheel. Draw a bigger loop.",
      ),
    };
  }

  // Crossing is tested before area on purpose. A bowtie encloses zero signed area,
  // so an area-first order refuses it as "no area", which is technically true and
  // useless to the visitor. Crossing is the specific, actionable diagnosis.
  if (selfIntersects(original)) {
    return {
      ok: false,
      zone: null,
      refusal: refuse(
        "self-intersecting",
        "THE LINE CROSSES ITSELF",
        "An outline cannot cross itself. Try again.",
      ),
    };
  }

  const bb = boundingBox(original);
  const span = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y);
  if (!(span > 0) || area(original) <= span * span * 1e-9) {
    return {
      ok: false,
      zone: null,
      refusal: refuse(
        "zero-area",
        "THE SHAPE IS FLAT",
        "That is a line, not a wheel. Draw a loop with an inside.",
      ),
    };
  }

  // First try the drawing exactly as it is, which is always the best fidelity.
  const directZone = hubZone(original);
  if (directZone.exists && directZone.suggested !== null) {
    const settled = settle(original, original, false, 0, directZone, requestedHub);
    if (settled) return settled;
  }

  // Otherwise bridge the pockets the axle cannot see and try again.
  const rollable = makeRollable(original);
  if (rollable) {
    const zone = hubZone(rollable.outline);
    if (zone.exists && zone.suggested !== null) {
      // Reaching here means the drawing had no workable axle position at all, so
      // bridging definitionally changed it. No need to second-guess that with a
      // threshold.
      const settled = settle(
        rollable.outline,
        original,
        true,
        rollable.deviation,
        zone,
        requestedHub,
      );
      if (settled) return settled;
    }
  }

  return {
    ok: false,
    zone: directZone,
    refusal: refuse(
      "cannot-roll",
      "THIS ONE WILL NOT ROLL",
      "This one cannot be made into a wheel. Try a rounder loop.",
      directZone.blockingVertices,
    ),
  };
}

function settle(
  outline: Polygon,
  original: Polygon,
  adjusted: boolean,
  deviation: number,
  zone: HubZone,
  requestedHub?: Vec,
): ValidationResult | null {
  if (zone.suggested === null) return null;

  if (requestedHub) {
    // Trust the zone, not the caller. An axle arriving from a shared link may sit
    // outside a zone computed from a slightly different outline.
    if (!pointInConvex(zone.zone, requestedHub)) {
      return {
        ok: false,
        zone,
        refusal: refuse(
          "axle-outside-zone",
          "AXLE TOO FAR OUT",
          "From there the axle cannot see the whole shape. Move it back into the shaded area and the road comes back.",
        ),
      };
    }
    return { ok: true, outline, original, adjusted, deviation, zone, hub: requestedHub };
  }

  return {
    ok: true,
    outline,
    original,
    adjusted,
    deviation,
    zone,
    hub: zone.suggested,
  };
}

/** Containment test for a convex ring, which is what the axle zone always is. */
function pointInConvex(ring: Polygon, p: Vec, tolerance = 1e-9): boolean {
  const n = ring.length;
  if (n < 3) return false;

  let scale = 0;
  for (const q of ring) scale = Math.max(scale, Math.abs(q.x), Math.abs(q.y));
  const eps = tolerance * Math.max(scale, 1);

  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const crossZ = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (crossZ < -eps) return false;
  }
  return true;
}

export { pointInConvex };
