/**
 * Freehand outline capture over a canvas.
 *
 * Captures in world coordinates via the supplied camera, so the stroke means the
 * same thing regardless of canvas size or device pixel ratio.
 *
 * Simplification runs through `simplifyClosed`, which splits the loop at geometric
 * extremes rather than at the first captured point. Plain Douglas-Peucker on a
 * closed ring always keeps its endpoints, which would freeze whatever wobble
 * happened where the pointer went down into a permanent corner.
 */

import { simplifyClosed, dedupe, boundingBox } from "../core/polygon.js";
import type { Polygon } from "../core/polygon.js";
import { type Vec, dist } from "../core/vec.js";
import { type Camera, toWorldX, toWorldY } from "../render/viewport.js";

export interface DrawHandlers {
  /** Called on every move with the raw in-progress stroke. */
  readonly onProgress: (stroke: Polygon) => void;
  /** Called on release with the cleaned, simplified, closed outline. */
  readonly onFinish: (outline: Polygon) => void;
  /** Called when the stroke was too small to be a shape. */
  readonly onDiscard: (reason: string) => void;
}

export interface DrawSession {
  readonly cancel: () => void;
  readonly isActive: () => boolean;
}

const MIN_POINTS = 8;
const MIN_SPAN_FRACTION = 0.06;

/**
 * Attach freehand capture. Returns a handle; call `cancel()` to detach.
 *
 * `cameraFor` is a callback rather than a value because the camera changes with
 * layout, and a stale camera would silently map the stroke to the wrong place.
 */
export function attachDrawing(
  canvas: HTMLCanvasElement,
  cameraFor: () => Camera | null,
  handlers: DrawHandlers,
): DrawSession {
  let stroke: Vec[] = [];
  let drawing = false;
  let pointerId: number | null = null;

  const pointToWorld = (ev: PointerEvent): Vec | null => {
    const cam = cameraFor();
    if (!cam) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    return { x: toWorldX(cam, sx), y: toWorldY(cam, sy) };
  };

  const onDown = (ev: PointerEvent): void => {
    if (drawing) return;
    const p = pointToWorld(ev);
    if (!p) return;
    drawing = true;
    pointerId = ev.pointerId;
    stroke = [p];
    canvas.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  };

  const onMove = (ev: PointerEvent): void => {
    if (!drawing || ev.pointerId !== pointerId) return;
    const p = pointToWorld(ev);
    if (!p) return;
    const last = stroke[stroke.length - 1];
    // Drop micro-moves so the stroke does not fill with duplicate samples.
    const cam = cameraFor();
    const minStep = cam ? 1.4 / cam.scale : 0;
    if (last && dist(last, p) < minStep) return;
    stroke.push(p);
    handlers.onProgress(stroke);
    ev.preventDefault();
  };

  const finish = (): void => {
    if (!drawing) return;
    drawing = false;
    pointerId = null;

    const cleaned = dedupe(stroke);
    if (cleaned.length < MIN_POINTS) {
      handlers.onDiscard("That stroke was too short to be a shape. Draw a closed loop.");
      stroke = [];
      return;
    }

    const box = boundingBox(cleaned);
    const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
    const cam = cameraFor();
    // Compare against the visible extent, so the threshold means the same thing on
    // a phone and on a desktop.
    const visible = cam ? canvas.getBoundingClientRect().width / cam.scale : 1;
    if (span < visible * MIN_SPAN_FRACTION) {
      handlers.onDiscard("That shape is too small to work with. Draw it bigger.");
      stroke = [];
      return;
    }

    // Simplify relative to the shape's own size, not in pixels.
    const outline = simplifyClosed(cleaned, span * 0.004);
    stroke = [];
    handlers.onFinish(outline);
  };

  const onUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    finish();
  };

  const onCancel = (): void => {
    drawing = false;
    pointerId = null;
    stroke = [];
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);

  return {
    cancel: () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      onCancel();
    },
    isActive: () => drawing,
  };
}
