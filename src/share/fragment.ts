/**
 * Share state in the URL fragment.
 *
 * The fragment is never sent to a server, so a shared outline stays on the two
 * machines that touched it. That is a privacy property, not just a convenience.
 *
 * Two forms:
 *   #f=square              a built-in form
 *   #p=<base36 pairs>      a drawn outline plus its hub
 *
 * Coordinates are quantised to a fixed grid before encoding. Fixed-point keeps the
 * link short and, more importantly, keeps it stable: a link must survive any later
 * change to how outlines are captured or simplified.
 */

import type { Polygon } from "../core/polygon.js";
import { type Vec, vec } from "../core/vec.js";

const GRID = 2048;

export interface SharedShape {
  readonly outline: Polygon;
  readonly hub: Vec | null;
}

const toGrid = (v: number): number => Math.round(v * GRID);

/** Signed integer to base36 with a leading marker for negatives. */
function encodeInt(n: number): string {
  return n < 0 ? `-${(-n).toString(36)}` : n.toString(36);
}

function decodeInt(s: string): number {
  return s.startsWith("-")
    ? -Number.parseInt(s.slice(1), 36)
    : Number.parseInt(s, 36);
}

export function encodePresetFragment(id: string): string {
  return `#f=${encodeURIComponent(id)}`;
}

export function encodeOutlineFragment(outline: Polygon, hub: Vec): string {
  const parts: string[] = [encodeInt(toGrid(hub.x)), encodeInt(toGrid(hub.y))];
  for (const p of outline) {
    parts.push(encodeInt(toGrid(p.x)), encodeInt(toGrid(p.y)));
  }
  return `#p=${parts.join(".")}`;
}

export type ParsedFragment =
  | { kind: "preset"; id: string }
  | { kind: "outline"; shape: SharedShape }
  | { kind: "none" };

/**
 * Parse a fragment.
 *
 * Never throws. A fragment is untrusted input arriving from a link somebody else
 * wrote, so malformed data resolves to `none` and the app falls back to a default
 * rather than failing to start.
 */
export function parseFragment(raw: string): ParsedFragment {
  const hash = raw.startsWith("#") ? raw.slice(1) : raw;
  if (hash.length === 0) return { kind: "none" };

  if (hash.startsWith("f=")) {
    const id = decodeURIComponent(hash.slice(2)).trim();
    // Restrict to a plain identifier so this can never be used as a lookup trick.
    if (!/^[a-z0-9-]{1,32}$/i.test(id)) return { kind: "none" };
    return { kind: "preset", id };
  }

  if (hash.startsWith("p=")) {
    const parts = hash.slice(2).split(".");
    // Hub pair plus at least three vertex pairs.
    if (parts.length < 8 || parts.length % 2 !== 0) return { kind: "none" };

    const nums: number[] = [];
    for (const part of parts) {
      if (!/^-?[0-9a-z]{1,8}$/.test(part)) return { kind: "none" };
      const n = decodeInt(part);
      if (!Number.isFinite(n)) return { kind: "none" };
      nums.push(n / GRID);
    }

    const hub = vec(nums[0]!, nums[1]!);
    const outline: Vec[] = [];
    for (let i = 2; i < nums.length; i += 2) {
      outline.push(vec(nums[i]!, nums[i + 1]!));
    }
    if (outline.length < 3) return { kind: "none" };

    return { kind: "outline", shape: { outline, hub } };
  }

  return { kind: "none" };
}

/** Replace the fragment without adding a history entry. */
export function writeFragment(fragment: string): void {
  const url = `${window.location.pathname}${window.location.search}${fragment}`;
  window.history.replaceState(null, "", url);
}

export function currentShareUrl(fragment: string): string {
  return `${window.location.origin}${window.location.pathname}${fragment}`;
}
