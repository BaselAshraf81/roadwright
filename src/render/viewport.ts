/**
 * Canvas sizing and world-to-screen mapping shared by both bands.
 *
 * Handles device pixel ratio once, in one place, so no drawing code has to think
 * about it and no line comes out blurry.
 */

export interface Viewport {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Logical CSS pixel size, which is what all drawing code works in. */
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

/**
 * Resize the backing store to the element's box and return a context already
 * scaled so that one unit equals one CSS pixel.
 *
 * Returns null when the element has no layout yet, which happens on the first
 * frame if a parent is still measuring.
 */
export function acquire(canvas: HTMLCanvasElement): Viewport | null {
  const rect = canvas.getBoundingClientRect();
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  if (width <= 0 || height <= 0) return null;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const backingW = Math.floor(width * dpr);
  const backingH = Math.floor(height * dpr);

  if (canvas.width !== backingW || canvas.height !== backingH) {
    canvas.width = backingW;
    canvas.height = backingH;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { canvas, ctx, width, height, dpr };
}

/** Uniform scale plus translation, y flipped so world y increases upward. */
export interface Camera {
  readonly scale: number;
  readonly originX: number;
  readonly originY: number;
}

export const toScreenX = (cam: Camera, x: number): number =>
  cam.originX + x * cam.scale;

export const toScreenY = (cam: Camera, y: number): number =>
  cam.originY - y * cam.scale;

export const toWorldX = (cam: Camera, sx: number): number =>
  (sx - cam.originX) / cam.scale;

export const toWorldY = (cam: Camera, sy: number): number =>
  (cam.originY - sy) / cam.scale;

/**
 * Fit a bounding box into a viewport with padding, centred.
 */
export function fitCamera(
  vp: Viewport,
  box: { min: { x: number; y: number }; max: { x: number; y: number } },
  padding: number,
): Camera {
  const spanX = Math.max(box.max.x - box.min.x, 1e-9);
  const spanY = Math.max(box.max.y - box.min.y, 1e-9);
  const usableW = Math.max(vp.width - padding * 2, 1);
  const usableH = Math.max(vp.height - padding * 2, 1);
  const scale = Math.min(usableW / spanX, usableH / spanY);

  const midX = (box.min.x + box.max.x) / 2;
  const midY = (box.min.y + box.max.y) / 2;

  return {
    scale,
    originX: vp.width / 2 - midX * scale,
    originY: vp.height / 2 + midY * scale,
  };
}

/** Crisp hairline offset: aligns a 1px stroke to the pixel grid. */
export const crisp = (v: number): number => Math.round(v) + 0.5;
