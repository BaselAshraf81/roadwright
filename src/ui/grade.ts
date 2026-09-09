/**
 * Tilting the road by dragging either end of the datum.
 *
 * Grade is the unit a real profile drawing uses, so this control is native to the
 * form rather than bolted on. The handles are drawn, not hidden, because an
 * invisible affordance is one nobody finds.
 *
 * The maths is exact rather than a fudge. The derivation only ever said the axle
 * travels along a straight line with the contact at distance r along the
 * perpendicular to that line. Gravity never entered it, so nothing requires the line
 * to be horizontal and the road profile relative to the datum is unchanged.
 */

export interface GradeHandlers {
  readonly onGrade: (grade: number) => void;
  readonly onHoverChange: (overHandle: boolean) => void;
  readonly onDragState: (dragging: "left" | "right" | null) => void;
}

export interface GradeTargets {
  readonly left: { x: number; y: number };
  readonly right: { x: number; y: number };
  readonly radius: number;
  /** Screen y to grade, for the side being dragged. */
  readonly gradeFor: (side: "left" | "right", screenY: number) => number;
}

export function attachGradeDrag(
  canvas: HTMLCanvasElement,
  read: () => GradeTargets | null,
  handlers: GradeHandlers,
): () => void {
  let dragging: "left" | "right" | null = null;
  let pointerId: number | null = null;

  const local = (ev: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };

  const hit = (ev: PointerEvent): "left" | "right" | null => {
    const t = read();
    if (!t) return null;
    const p = local(ev);
    if (Math.hypot(p.x - t.left.x, p.y - t.left.y) <= t.radius) return "left";
    if (Math.hypot(p.x - t.right.x, p.y - t.right.y) <= t.radius) return "right";
    return null;
  };

  const onDown = (ev: PointerEvent): void => {
    const side = hit(ev);
    if (!side) return;
    dragging = side;
    pointerId = ev.pointerId;
    handlers.onDragState(side);
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch {
      // A synthetic pointer has nothing to capture. Dragging still works.
    }
    ev.preventDefault();
  };

  const onMove = (ev: PointerEvent): void => {
    if (!dragging) {
      handlers.onHoverChange(hit(ev) !== null);
      return;
    }
    if (ev.pointerId !== pointerId) return;
    const t = read();
    if (!t) return;
    handlers.onGrade(t.gradeFor(dragging, local(ev).y));
    ev.preventDefault();
  };

  const onUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    dragging = null;
    pointerId = null;
    handlers.onDragState(null);
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  return () => {
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onUp);
  };
}
