/**
 * Minimal 2D vector helpers.
 *
 * Pure. No DOM, no canvas, no browser globals, so `src/core` runs under a plain
 * test runner. That is what makes the correctness claims checkable.
 */

export interface Vec {
  readonly x: number;
  readonly y: number;
}

export const vec = (x: number, y: number): Vec => ({ x, y });

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });

export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });

export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });

export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;

/** z component of the 3D cross product, positive when b is left of a. */
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;

export const length = (a: Vec): number => Math.hypot(a.x, a.y);

export const dist = (a: Vec, b: Vec): number => Math.hypot(b.x - a.x, b.y - a.y);

export const normalize = (a: Vec): Vec => {
  const l = Math.hypot(a.x, a.y);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};

/** Unit vector at angle theta, measured counterclockwise from +x. */
export const unit = (theta: number): Vec => ({
  x: Math.cos(theta),
  y: Math.sin(theta),
});

/** Perpendicular, rotated a quarter turn counterclockwise. */
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });

export const lerp = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Wrap an angle into [0, 2*PI). */
export const wrapAngle = (theta: number): number => {
  const tau = Math.PI * 2;
  const r = theta % tau;
  return r < 0 ? r + tau : r;
};
