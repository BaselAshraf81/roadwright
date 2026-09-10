/**
 * Upper band: the component detail.
 *
 * The outline drawn as an isolated part, the way a drawing sheet shows one
 * machined piece: hub crossed, permissible hub zone hatched, radius leader
 * dimensioned to the shortest and longest reach.
 *
 * This band replaced the plan view the form would normally carry. Roadwright's road
 * has no horizontal alignment, only a vertical profile, so a plan band would look
 * authentic and be empty. See the direction contract.
 */

import type { Polygon } from "../core/polygon.js";
import { boundingBox } from "../core/polygon.js";
import type { HubZone } from "../core/kernel.js";
import type { Vec } from "../core/vec.js";
import { INK, WEIGHT, sheetFont } from "./theme.js";
import {
  type Camera,
  type Viewport,
  crisp,
  fitCamera,
  toScreenX,
  toScreenY,
} from "./viewport.js";

export interface DetailState {
  readonly outline: Polygon;
  readonly hub: Vec | null;
  readonly zone: HubZone | null;
  /** Vertex indices to call out, used when a refusal points at a notch. */
  readonly highlight: readonly number[];
  readonly rMin: number | null;
  readonly rMax: number | null;
  /** Data-table figures. Null when the outline has no road. */
  readonly period: number | null;
  readonly rutDepth: number | null;
  readonly interference: number | null;
  /**
   * An in-progress freehand stroke, drawn instead of the settled part.
   *
   * Kept separate from `outline` on purpose. The camera is fitted to `outline`, so a
   * stroke can grow without the view moving underneath the pointer.
   */
  readonly preview: Polygon | null;
  /**
   * What the visitor actually drew, when it had to be bridged to make a wheel.
   * Drawn faintly behind the part so the change is visible rather than silent.
   */
  readonly ghost: Polygon | null;
  /**
   * A stroke that was turned away, drawn over the part it failed to replace.
   *
   * Shown rather than discarded. A stroke that vanishes on release reads as the tool
   * being broken, which is exactly how the first version was reported.
   */
  readonly rejected: Polygon | null;
  /** Short reason, stamped on the band beside the rejected stroke. */
  readonly rejectedNote: string | null;
  /** Points on the rejected stroke worth circling, such as where it crosses itself. */
  readonly rejectedMarks: readonly Vec[];
}

/**
 * Dimension table, the way a drawing sheet carries its figures beside the part.
 *
 * This exists because a wide band holding one small part is mostly bare paper, and
 * bare paper reading as unfinished is exactly the flaw that lost the pen-plotter
 * direction. Sheet furniture carrying real numbers is the honest way to fill it.
 */
function drawDataTable(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  state: DetailState,
): void {
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["CORNERS", String(state.outline.length)],
    ["SHORTEST REACH", state.rMin !== null ? state.rMin.toFixed(3) : "-"],
    ["LONGEST REACH", state.rMax !== null ? state.rMax.toFixed(3) : "-"],
    ["ROAD LENGTH", state.period !== null ? state.period.toFixed(3) : "-"],
    ["DIP DEPTH", state.rutDepth !== null ? state.rutDepth.toFixed(3) : "-"],
    [
      "CATCHES BY",
      state.interference !== null ? `${(state.interference * 100).toFixed(1)}%` : "-",
    ],
  ];

  const rowH = 15;
  const labelW = 96;
  const valueW = 58;
  const tableW = labelW + valueW;
  const tableH = rowH * rows.length;
  const x = vp.width - tableW - 12;
  // Cleared below the draw button, which is a real DOM control sitting over this
  // band's top-right corner. The two used to overlap and the button won.
  const y = 66;

  // Skip it rather than crowd the part on a narrow band. The part is the subject;
  // the table is supporting information and gives way first.
  if (vp.width < tableW + 260) return;

  ctx.font = sheetFont(9.5, 500);
  ctx.textBaseline = "middle";

  ctx.strokeStyle = INK.graphite;
  ctx.lineWidth = WEIGHT.hair;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const ry = y + i * rowH;

    ctx.strokeRect(crisp(x), crisp(ry), labelW, rowH);
    ctx.strokeRect(crisp(x + labelW), crisp(ry), valueW, rowH);

    ctx.fillStyle = INK.graphite;
    ctx.textAlign = "left";
    ctx.fillText(row[0], x + 5, ry + rowH / 2 + 0.5);

    ctx.fillStyle = INK.road;
    ctx.textAlign = "right";
    ctx.fillText(row[1], x + labelW + valueW - 5, ry + rowH / 2 + 0.5);
  }

  ctx.fillStyle = INK.graphite;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.font = sheetFont(9, 600);
  ctx.fillText("MEASUREMENTS", x, y - 4);
  void tableH;
}

const PADDING = 34;

/**
 * A refused stroke, its fault, and the reason, all on the drawing.
 *
 * Deliberately loud. This is the one message in the product that a visitor is
 * guaranteed to hit by accident, and the margin note alone was demonstrably too
 * quiet: the stroke disappeared, the previous shape came back, and the explanation
 * sat in small type below the drawing. Stamping it here puts the reason where the
 * stroke was, and circling the crossing answers the question the sentence cannot,
 * which is where the problem is.
 */
function drawRejected(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  cam: Camera,
  stroke: Polygon,
  note: string,
  marks: readonly Vec[],
): void {
  if (stroke.length >= 2) {
    ctx.beginPath();
    stroke.forEach((p, i) => {
      const sx = toScreenX(cam, p.x);
      const sy = toScreenY(cam, p.y);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    // Solid and heavy. This is the subject of the band now, not an annotation on
    // something else, so it carries the same weight a settled part would.
    ctx.strokeStyle = INK.outline;
    ctx.lineWidth = WEIGHT.heavy;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  // Circle the fault. A drawing calls out a defect, it does not describe it.
  for (const m of marks) {
    const sx = toScreenX(cam, m.x);
    const sy = toScreenY(cam, m.y);
    ctx.strokeStyle = INK.outline;
    ctx.lineWidth = WEIGHT.medium;
    ctx.beginPath();
    ctx.arc(sx, sy, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx - 5.5, sy - 5.5);
    ctx.lineTo(sx + 5.5, sy + 5.5);
    ctx.moveTo(sx + 5.5, sy - 5.5);
    ctx.lineTo(sx - 5.5, sy + 5.5);
    ctx.stroke();
  }

  // Stamped across the foot of the band, in the visitor's own ink so it reads as a
  // result rather than as chrome.
  ctx.font = sheetFont(12, 700);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const boxW = Math.min(ctx.measureText(note).width + 26, vp.width - 24);
  const boxH = 26;
  const boxX = (vp.width - boxW) / 2;
  const boxY = vp.height - boxH - 12;

  ctx.fillStyle = INK.band;
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = INK.outline;
  ctx.lineWidth = WEIGHT.medium;
  ctx.strokeRect(crisp(boxX), crisp(boxY), boxW, boxH);
  ctx.fillStyle = INK.outline;
  ctx.fillText(note, vp.width / 2, boxY + boxH / 2 + 1);

  // The band's own frame turns oxide, so the whole figure reads as flagged.
  ctx.strokeStyle = INK.outline;
  ctx.lineWidth = WEIGHT.medium;
  ctx.strokeRect(crisp(1), crisp(1), vp.width - 3, vp.height - 3);
}

/** Camera that frames the outline, exported so hit-testing can share it. */
export function detailCamera(vp: Viewport, outline: Polygon): Camera {
  const box = boundingBox(outline);
  // Grow the box slightly so dimension leaders have room outside the part.
  const grow = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) * 0.16;
  return fitCamera(
    vp,
    {
      min: { x: box.min.x - grow, y: box.min.y - grow },
      max: { x: box.max.x + grow, y: box.max.y + grow },
    },
    PADDING,
  );
}

function tracePolygon(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  poly: Polygon,
): void {
  ctx.beginPath();
  poly.forEach((p, i) => {
    const sx = toScreenX(cam, p.x);
    const sy = toScreenY(cam, p.y);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
}

/** Diagonal hatching, the drafting convention for a called-out region. */
function hatchRegion(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  poly: Polygon,
  spacing = 7,
): void {
  if (poly.length < 3) return;

  ctx.save();
  tracePolygon(ctx, cam, poly);
  ctx.clip();

  const box = boundingBox(poly);
  const x0 = toScreenX(cam, box.min.x);
  const x1 = toScreenX(cam, box.max.x);
  const y0 = toScreenY(cam, box.max.y);
  const y1 = toScreenY(cam, box.min.y);

  ctx.strokeStyle = INK.graphite;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = WEIGHT.hair;
  ctx.beginPath();
  const span = x1 - x0 + (y1 - y0);
  for (let d = -span; d < span; d += spacing) {
    ctx.moveTo(x0 + d, y0);
    ctx.lineTo(x0 + d + (y1 - y0), y1);
  }
  ctx.stroke();
  ctx.restore();
}

/** Hub mark: a centre cross with a small circle, as a drawing would show it. */
function drawHubMark(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  hub: Vec,
): void {
  const cx = toScreenX(cam, hub.x);
  const cy = toScreenY(cam, hub.y);
  const arm = 11;

  ctx.strokeStyle = INK.road;
  ctx.lineWidth = WEIGHT.thin;
  ctx.beginPath();
  ctx.moveTo(cx - arm, cy);
  ctx.lineTo(cx + arm, cy);
  ctx.moveTo(cx, cy - arm);
  ctx.lineTo(cx, cy + arm);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
  ctx.stroke();
}

/** Dimension leader from the hub outward, with an arrowhead and a label. */
function drawRadiusLeader(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  hub: Vec,
  radius: number,
  angle: number,
  label: string,
): void {
  const x0 = toScreenX(cam, hub.x);
  const y0 = toScreenY(cam, hub.y);
  const x1 = toScreenX(cam, hub.x + Math.cos(angle) * radius);
  const y1 = toScreenY(cam, hub.y + Math.sin(angle) * radius);

  ctx.strokeStyle = INK.graphite;
  ctx.fillStyle = INK.graphite;
  ctx.lineWidth = WEIGHT.hair;

  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();

  // Arrowhead at the outline end.
  const screenAngle = Math.atan2(y1 - y0, x1 - x0);
  const head = 7;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(
    x1 - head * Math.cos(screenAngle - 0.32),
    y1 - head * Math.sin(screenAngle - 0.32),
  );
  ctx.lineTo(
    x1 - head * Math.cos(screenAngle + 0.32),
    y1 - head * Math.sin(screenAngle + 0.32),
  );
  ctx.closePath();
  ctx.fill();

  // Label just beyond the arrowhead, nudged clear of the line.
  ctx.font = sheetFont(11, 600);
  ctx.textAlign = Math.cos(screenAngle) >= 0 ? "left" : "right";
  ctx.textBaseline = "middle";
  const off = 9;
  ctx.fillText(
    label,
    x1 + Math.cos(screenAngle) * off,
    y1 + Math.sin(screenAngle) * off,
  );
}

export function drawDetail(vp: Viewport, state: DetailState): void {
  const { ctx, width, height } = vp;
  const { outline, hub, zone, highlight, rMin, rMax, preview, ghost } = state;

  ctx.fillStyle = INK.band;
  ctx.fillRect(0, 0, width, height);

  if (outline.length < 3) return;

  // Always fitted to the settled outline, never to the live stroke. Refitting while
  // a stroke grows would remap every following point through a different camera,
  // which silently corrupts the captured shape.
  const cam = detailCamera(vp, outline);

  // A stroke in progress owns the band: draw it and nothing else, so the previous
  // part does not read as being part of what is being drawn.
  if (preview) {
    if (preview.length >= 2) {
      ctx.beginPath();
      preview.forEach((p, i) => {
        const sx = toScreenX(cam, p.x);
        const sy = toScreenY(cam, p.y);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.strokeStyle = INK.outline;
      ctx.lineWidth = WEIGHT.heavy;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();

      // Show where the loop would close, since a closed ring is the requirement.
      const first = preview[0]!;
      const last = preview[preview.length - 1]!;
      ctx.beginPath();
      ctx.moveTo(toScreenX(cam, last.x), toScreenY(cam, last.y));
      ctx.lineTo(toScreenX(cam, first.x), toScreenY(cam, first.y));
      ctx.strokeStyle = INK.graphite;
      ctx.lineWidth = WEIGHT.hair;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.font = sheetFont(10, 600);
    ctx.fillStyle = INK.graphite;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("FIG 1  COMPONENT DETAIL", 12, 10);
    ctx.fillText("CAPTURING OUTLINE", 12, 24);
    ctx.strokeStyle = INK.graphite;
    ctx.lineWidth = WEIGHT.thin;
    ctx.strokeRect(crisp(0), crisp(0), width - 1, height - 1);
    return;
  }

  /*
   * A refusal owns the band, exactly the way a stroke in progress does.
   *
   * The first attempt drew the rejected stroke over the settled part with the zone
   * hatch and both dimension leaders still showing. Everything was in the same oxide
   * ink and the fault had to compete with four other things for attention, which is
   * the opposite of what a refusal needs. The shape still being solved stays as a
   * faint reference so the band does not look like it lost it, and FIG 2 goes on
   * rolling it.
   */
  if (state.rejected && state.rejectedNote) {
    tracePolygon(ctx, cam, outline);
    ctx.strokeStyle = INK.graphite;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = WEIGHT.thin;
    ctx.stroke();
    ctx.globalAlpha = 1;

    drawRejected(ctx, vp, cam, state.rejected, state.rejectedNote, state.rejectedMarks);

    ctx.font = sheetFont(10, 600);
    ctx.fillStyle = INK.graphite;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("FIG 1  YOUR WHEEL", 12, 10);
    ctx.fillStyle = INK.outline;
    ctx.fillText("OUTLINE REFUSED", 12, 24);
    ctx.font = sheetFont(9, 500);
    ctx.fillStyle = INK.graphite;
    ctx.fillText("FAINT: THE SHAPE STILL IN USE", 12, 40);
    return;
  }

  // Permissible hub zone, hatched, drawn under the part.
  if (zone && zone.exists && zone.zone.length >= 3) {
    hatchRegion(ctx, cam, zone.zone);
    ctx.strokeStyle = INK.graphite;
    ctx.lineWidth = WEIGHT.hair;
    ctx.setLineDash([4, 3]);
    tracePolygon(ctx, cam, zone.zone);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // What was drawn, when it differs from what is being solved.
  if (ghost && ghost.length >= 3) {
    tracePolygon(ctx, cam, ghost);
    ctx.strokeStyle = INK.outline;
    ctx.globalAlpha = 0.32;
    ctx.lineWidth = WEIGHT.thin;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // The part itself, in the visitor's own ink.
  tracePolygon(ctx, cam, outline);
  ctx.strokeStyle = INK.outline;
  ctx.lineWidth = WEIGHT.heavy;
  ctx.lineJoin = "round";
  ctx.stroke();

  // Called-out vertices, when a refusal has something to point at.
  if (highlight.length > 0) {
    ctx.strokeStyle = INK.outline;
    ctx.lineWidth = WEIGHT.medium;
    for (const i of highlight) {
      const p = outline[i];
      if (!p) continue;
      const sx = toScreenX(cam, p.x);
      const sy = toScreenY(cam, p.y);
      ctx.beginPath();
      ctx.arc(sx, sy, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  if (hub) {
    // Shortest and longest reach, which is what sets the rut depth.
    if (rMin !== null && rMax !== null) {
      drawRadiusLeader(ctx, cam, hub, rMin, Math.PI * 1.15, `MIN ${rMin.toFixed(3)}`);
      drawRadiusLeader(ctx, cam, hub, rMax, Math.PI * 0.28, `MAX ${rMax.toFixed(3)}`);
    }
    drawHubMark(ctx, cam, hub);
  }

  // Band caption, lettered into the sheet rather than floated above it.
  ctx.font = sheetFont(10, 600);
  ctx.fillStyle = INK.graphite;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("FIG 1  YOUR WHEEL", 12, 10);

  /*
   * Captions are written short on a narrow band, never drawn long and clipped.
   *
   * The draw button is a real DOM control pinned to this band's top right corner, so
   * on a phone the long form of these lines ran straight under it. Same rule the
   * refusal stamp already follows: write the short version, do not truncate the long
   * one. The arrow-key line goes first, because a phone has no arrow keys.
   */
  const tight = width < 560;
  ctx.fillText(
    zone && zone.exists
      ? tight
        ? "SHADED: AXLE ZONE"
        : "SHADED: WHERE THE AXLE CAN GO"
      : tight
        ? "NO AXLE WORKS"
        : "NO AXLE POSITION WORKS",
    12,
    24,
  );
  ctx.font = sheetFont(9, 500);
  // Says what is actually true. The arrow keys act on this band, so it has to hold
  // focus first, and claiming they just work led to a visitor pressing them, getting
  // a scrolled page, and reasonably calling it broken.
  ctx.fillText(
    tight ? "DRAG THE AXLE" : "DRAG THE AXLE, OR CLICK HERE AND USE THE ARROW KEYS",
    12,
    40,
  );
  if (ghost) ctx.fillText("DASHED: WHAT YOU DREW", 12, 54);

  drawDataTable(ctx, vp, state);

  // Band frame.
  ctx.strokeStyle = INK.graphite;
  ctx.lineWidth = WEIGHT.thin;
  ctx.strokeRect(crisp(0), crisp(0), width - 1, height - 1);
}
