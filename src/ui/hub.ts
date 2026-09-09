/**
 * Hub dragging, clamped to the permissible zone.
 *
 * This is the solution to the hardest problem in the product. The wheel must be
 * star-shaped about its hub, so a badly placed hub means no road exists at all, and
 * nothing about that constraint is guessable from looking at a shape.
 *
 * Clamping the drag to the kernel makes a hub-caused failure structurally
 * impossible rather than something the interface apologises for. Sliding the hub
 * inside the zone still changes rut depth, so it stays a real creative control.
 *
 * Keyboard access is not an afterthought here: the hub is reachable and nudgeable
 * with arrow keys, because a drag-only control would put the product's main
 * variable out of reach.
 */

import { clampToZone } from "../core/kernel.js";
import type { Polygon } from "../core/polygon.js";
import { boundingBox } from "../core/polygon.js";
import type { Vec } from "../core/vec.js";
import { type Camera, toScreenX, toScreenY, toWorldX, toWorldY } from "../render/viewport.js";

export interface HubHandlers {
  readonly onMove: (hub: Vec) => void;
  readonly onHoverChange: (overHub: boolean) => void;
}

export interface HubDragging {
  readonly cancel: () => void;
  readonly isActive: () => boolean;
}

const GRAB_RADIUS_PX = 18;

export function attachHubDrag(
  canvas: HTMLCanvasElement,
  read: () => { camera: Camera | null; hub: Vec | null; zone: Polygon; outline: Polygon },
  handlers: HubHandlers,
): HubDragging {
  let dragging = false;
  let pointerId: number | null = null;

  const screenHub = (): { sx: number; sy: number } | null => {
    const { camera, hub } = read();
    if (!camera || !hub) return null;
    return { sx: toScreenX(camera, hub.x), sy: toScreenY(camera, hub.y) };
  };

  const localPoint = (ev: PointerEvent): { sx: number; sy: number } => {
    const rect = canvas.getBoundingClientRect();
    return { sx: ev.clientX - rect.left, sy: ev.clientY - rect.top };
  };

  const nearHub = (ev: PointerEvent): boolean => {
    const h = screenHub();
    if (!h) return false;
    const { sx, sy } = localPoint(ev);
    return Math.hypot(sx - h.sx, sy - h.sy) <= GRAB_RADIUS_PX;
  };

  const moveTo = (ev: PointerEvent): void => {
    const { camera, zone } = read();
    if (!camera) return;
    const { sx, sy } = localPoint(ev);
    const wanted = { x: toWorldX(camera, sx), y: toWorldY(camera, sy) };
    handlers.onMove(clampToZone(zone, wanted));
  };

  const onDown = (ev: PointerEvent): void => {
    if (!nearHub(ev)) return;
    dragging = true;
    pointerId = ev.pointerId;
    canvas.setPointerCapture(ev.pointerId);
    moveTo(ev);
    ev.preventDefault();
    ev.stopPropagation();
  };

  const onMove = (ev: PointerEvent): void => {
    if (!dragging) {
      handlers.onHoverChange(nearHub(ev));
      return;
    }
    if (ev.pointerId !== pointerId) return;
    moveTo(ev);
    ev.preventDefault();
  };

  const onUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
  };

  const onKey = (ev: KeyboardEvent): void => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (!keys.includes(ev.key)) return;
    const { hub, zone, outline } = read();
    if (!hub || zone.length === 0) return;

    const box = boundingBox(outline);
    const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
    const step = span * (ev.shiftKey ? 0.06 : 0.015);

    const dx = ev.key === "ArrowLeft" ? -step : ev.key === "ArrowRight" ? step : 0;
    const dy = ev.key === "ArrowDown" ? -step : ev.key === "ArrowUp" ? step : 0;

    handlers.onMove(clampToZone(zone, { x: hub.x + dx, y: hub.y + dy }));
    ev.preventDefault();
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("keydown", onKey);

  return {
    cancel: () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("keydown", onKey);
    },
    isActive: () => dragging,
  };
}
