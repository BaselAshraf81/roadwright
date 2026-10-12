/**
 * Dragging the corners of a polygon.
 *
 * A visitor who has never drawn anything can still reshape the wheel: grab a corner,
 * pull it, and the road under it changes in real time. It is the gentlest way in, and
 * the one a teacher asked for, so drawing from scratch becomes something you discover
 * after your curiosity is already up.
 *
 * Only shown for outlines with few corners. A freehand loop has dozens, and a dozen
 * tiny handles would be noise on top of the part.
 *
 * The axle always wins a tie. Its handler runs on the same canvas, and two handlers
 * both claiming one press would start two drags at once.
 */

import type { Polygon } from "../core/polygon.js";
import type { Vec } from "../core/vec.js";
import { type Camera, toScreenX, toScreenY, toWorldX, toWorldY } from "../render/viewport.js";

/** Outlines with more corners than this get no handles. */
export const MAX_HANDLES = 24;

const GRAB_RADIUS_PX = 14;
/** Matches the axle's own grab radius in `hub.ts`. */
const HUB_RADIUS_PX = 18;

export interface VertexHandlers {
  /** A drag began. The caller freezes the camera here so the view cannot move. */
  readonly onStart: () => void;
  readonly onMove: (index: number, to: Vec) => void;
  readonly onEnd: () => void;
  readonly onHoverChange: (over: boolean) => void;
}

export interface VertexDragging {
  readonly cancel: () => void;
  readonly isActive: () => boolean;
}

export function attachVertexDrag(
  canvas: HTMLCanvasElement,
  read: () => {
    camera: Camera | null;
    vertices: Polygon | null;
    hub: Vec | null;
    enabled: boolean;
  },
  handlers: VertexHandlers,
): VertexDragging {
  let dragging = false;
  let pointerId: number | null = null;
  let index = -1;

  const localPoint = (ev: PointerEvent): { sx: number; sy: number } => {
    const rect = canvas.getBoundingClientRect();
    return { sx: ev.clientX - rect.left, sy: ev.clientY - rect.top };
  };

  /** Index of the corner under the pointer, or -1. The axle wins when it is close. */
  const hit = (ev: PointerEvent): number => {
    const { camera, vertices, hub, enabled } = read();
    if (!enabled || !camera || !vertices) return -1;
    const { sx, sy } = localPoint(ev);

    if (hub) {
      const dh = Math.hypot(sx - toScreenX(camera, hub.x), sy - toScreenY(camera, hub.y));
      if (dh <= HUB_RADIUS_PX) return -1;
    }

    let best = -1;
    let bestD = GRAB_RADIUS_PX;
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i]!;
      const d = Math.hypot(sx - toScreenX(camera, v.x), sy - toScreenY(camera, v.y));
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  const moveTo = (ev: PointerEvent): void => {
    const { camera } = read();
    if (!camera) return;
    const { sx, sy } = localPoint(ev);
    handlers.onMove(index, { x: toWorldX(camera, sx), y: toWorldY(camera, sy) });
  };

  const onDown = (ev: PointerEvent): void => {
    const i = hit(ev);
    if (i < 0) return;
    dragging = true;
    pointerId = ev.pointerId;
    index = i;
    canvas.setPointerCapture(ev.pointerId);
    handlers.onStart();
    moveTo(ev);
    ev.preventDefault();
  };

  const onMove = (ev: PointerEvent): void => {
    if (!dragging) {
      handlers.onHoverChange(hit(ev) >= 0);
      return;
    }
    if (ev.pointerId !== pointerId) return;
    moveTo(ev);
    ev.preventDefault();
  };

  const onUp = (ev: PointerEvent): void => {
    if (!dragging || ev.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    index = -1;
    handlers.onEnd();
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  return {
    cancel: () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    },
    isActive: () => dragging,
  };
}
