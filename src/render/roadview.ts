/**
 * Lower band: the road, the datum, and the wheel rolling on it.
 *
 * This is the payoff. The blue datum runs dead straight across the sheet while the
 * outline tumbles beneath it, and the straightness is the whole point.
 *
 * The road ahead of the wheel is drawn as a ghost line rather than left blank, so
 * the not-yet-rolled part is composed. That discipline was donated by the
 * seven-segment world, where unlit segments are designed too.
 */

import type { Polygon } from "../core/polygon.js";
import type { Road, RollTrack } from "../core/road.js";
import { contactOn } from "../core/road.js";
import type { Vec } from "../core/vec.js";
import { BIND, INK, WEIGHT, sheetFont } from "./theme.js";
import { type Camera, type Viewport, crisp } from "./viewport.js";

export interface RoadState {
  readonly road: Road;
  readonly track: RollTrack;
  /** Outline in hub-relative coordinates, so rotation is about the origin. */
  readonly centred: Polygon;
  readonly travelled: number;
  /** Draw the wheel and the travelled-versus-ahead split. */
  readonly rolling: boolean;
  /**
   * Measured interference. When the wheel collides with its own road, the overlap is
   * called out rather than left looking like a drawing error.
   */
  readonly interference: number;
  /**
   * Distance between the two hubs, in world units. Zero draws a single wheel.
   *
   * The wheels turn independently, so both hubs ride level at any wheelbase. What
   * changes is their relative phase: a whole number of road periods puts them in
   * identical orientation, because the closure condition makes theta advance by
   * exactly one turn per period.
   */
  readonly wheelbase: number;
  /**
   * Road grade as a rise over run, so 0.08 is an eight percent climb.
   *
   * The derivation never mentioned gravity. It only said the axle travels along a
   * straight line with the contact at distance r along the perpendicular to that
   * line. Nothing requires the line to be horizontal, so tilting it is exact rather
   * than an approximation: the road profile relative to the datum does not change at
   * all. Grade is also the unit a real profile drawing uses, so it is native here.
   */
  readonly grade: number;
  /** Draw the grade handles at each end of the datum. */
  readonly showGradeHandles: boolean;
}

export const GRADE_HANDLE_INSET = 26;
export const GRADE_HANDLE_RADIUS = 15;

/**
 * Where the datum sits on screen, given the grade.
 *
 * Screen y runs downward, so a climbing road means y falls as x rises. The pivot is
 * the assembly centre, which keeps the wheels put while the road tips around them.
 */
function datumGeometry(
  state: RoadState,
  camera: Camera,
): { pivotX: number; pivotY: number; screenYAt: (x: number) => number } {
  const pivotX =
    camera.originX + (state.travelled - state.wheelbase / 2) * camera.scale;
  const pivotY = camera.originY;
  return {
    pivotX,
    pivotY,
    screenYAt: (x: number) => pivotY - (x - pivotX) * state.grade,
  };
}

/** Screen positions of the two grade handles, for hit testing and drawing. */
export function gradeHandles(
  vp: Viewport,
  state: RoadState,
): { left: Vec; right: Vec } {
  const { camera } = roadView(vp, state);
  const { screenYAt } = datumGeometry(state, camera);
  const lx = GRADE_HANDLE_INSET;
  const rx = vp.width - GRADE_HANDLE_INSET;
  return {
    left: { x: lx, y: screenYAt(lx) },
    right: { x: rx, y: screenYAt(rx) },
  };
}

/**
 * Grade implied by dragging one handle to a screen y.
 *
 * Returned rather than applied, so the caller owns clamping and state.
 */
export function gradeFromHandleDrag(
  vp: Viewport,
  state: RoadState,
  side: "left" | "right",
  screenY: number,
): number {
  const { camera } = roadView(vp, state);
  const { pivotX, pivotY } = datumGeometry(state, camera);
  const x = side === "left" ? GRADE_HANDLE_INSET : vp.width - GRADE_HANDLE_INSET;
  const dx = x - pivotX;
  if (Math.abs(dx) < 1) return state.grade;
  return (pivotY - screenY) / dx;
}

const SIDE_PADDING = 30;
const TOP_PADDING = 26;
const FOOT_ROOM = 38;
/**
 * Extra height above the axle line, as a multiple of the wheel's reach, to seat the
 * car body. The body is about 2.3 reaches tall, and the wheel itself needs one, so
 * the surplus over the wheel is 1.3.
 */
const BODY_HEADROOM = 1.3;

/**
 * Camera and visible span for the road band, solved together.
 *
 * The vertical fit has to account for BOTH directions from the datum. The hub rides
 * on the datum, so the wheel reaches `maxDepth` above it while the road drops
 * `maxDepth` below it, and scaling to the road alone crops the wheel off the top of
 * the band. Total vertical extent is therefore twice the deepest rut.
 *
 * Horizontally the wheel sits at a fixed fraction across the band and the road
 * slides under it. A moving wheel against a still rule is what invites the eye to
 * check that the rule really does not move.
 */
export function roadView(
  vp: Viewport,
  state: RoadState,
): { camera: Camera; span: number } {
  const { road, travelled, rolling, wheelbase } = state;

  const reach = Math.max(road.maxDepth, 1e-6);
  // Below the axle line: the road, one reach deep. Above it: the wheel, one reach,
  // plus the car body's surplus over the wheel when an assembly is shown.
  const headroom = wheelbase > 0 ? BODY_HEADROOM : 0;
  const totalVertical = reach * 2 + reach * headroom;

  const usableW = Math.max(vp.width - SIDE_PADDING * 2, 1);
  const usableH = Math.max(vp.height - TOP_PADDING - FOOT_ROOM, 1);

  // Height sets the scale, because the wheel is the tallest thing on the band.
  let scale = usableH / totalVertical;
  let span = usableW / scale;

  // Never show less than a period and a bit, so the repeat is legible, and always
  // enough to hold the whole assembly. If either forces a wider span, the scale
  // shrinks to match and the wheels get smaller rather than being cropped.
  const minSpan = Math.max(road.period * 1.35, wheelbase + road.period * 1.15);
  if (span < minSpan) {
    span = minSpan;
    scale = usableW / span;
  }

  // When width limited the scale, the block no longer fills the height, so centre
  // it. Without this the road rides high with dead paper beneath it, which is most
  // noticeable on a phone.
  const slack = Math.max(0, usableH - totalVertical * scale);

  // Frame the assembly rather than the lead wheel, so a long wheelbase does not push
  // the trailing wheel off the sheet.
  const assemblyCentre = travelled - wheelbase / 2;
  const camX = rolling
    ? assemblyCentre - span * 0.46
    : road.period / 2 - span / 2;

  return {
    camera: {
      scale,
      originX: SIDE_PADDING - camX * scale,
      originY: TOP_PADDING + slack / 2 + reach * (1 + headroom) * scale,
    },
    span,
  };
}

function traceRoad(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  road: Road,
  fromX: number,
  toX: number,
): void {
  const { points, period } = road;
  const firstTile = Math.floor(fromX / period) - 1;
  const lastTile = Math.ceil(toX / period) + 1;

  ctx.beginPath();
  let started = false;
  for (let tile = firstTile; tile <= lastTile; tile++) {
    const offset = tile * period;
    for (const p of points) {
      const wx = p.x + offset;
      if (wx < fromX - period || wx > toX + period) continue;
      const sx = cam.originX + wx * cam.scale;
      const sy = cam.originY - p.y * cam.scale;
      if (!started) {
        ctx.moveTo(sx, sy);
        started = true;
      } else {
        ctx.lineTo(sx, sy);
      }
    }
  }
}

/**
 * Station ticks along the foot.
 *
 * Numbered by position WITHIN one period, not by total distance travelled. The road
 * repeats, so a running total climbs forever and tells the visitor nothing: a
 * station reading 56.41 is just a clock. Within-period numbering makes the ticks
 * mean what stations mean on a real drawing, a position along the thing being built.
 */
function drawStations(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  fromX: number,
  toX: number,
  period: number,
): void {
  const footY = vp.height - 24;

  ctx.strokeStyle = INK.graphite;
  ctx.fillStyle = INK.graphite;
  ctx.lineWidth = WEIGHT.hair;
  ctx.font = sheetFont(9, 500);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  ctx.beginPath();
  ctx.moveTo(0, crisp(footY));
  ctx.lineTo(vp.width, crisp(footY));
  ctx.stroke();

  const step = period / 10;
  const firstIndex = Math.floor(fromX / step);
  const lastIndex = Math.ceil(toX / step);

  ctx.beginPath();
  for (let i = firstIndex; i <= lastIndex; i++) {
    const sx = cam.originX + i * step * cam.scale;
    if (sx < -20 || sx > vp.width + 20) continue;
    // Every fifth tick is a half period, which is the major station.
    const major = ((i % 5) + 5) % 5 === 0;
    ctx.moveTo(crisp(sx), footY);
    ctx.lineTo(crisp(sx), footY + (major ? 8 : 4));
  }
  ctx.stroke();

  // The caption owns the right end of the foot rule, so station numbers stop short
  // of it rather than printing on top of it.
  const captionWidth = 132;
  const numberLimit = vp.width - captionWidth - 14;

  for (let i = firstIndex; i <= lastIndex; i++) {
    if (((i % 5) + 5) % 5 !== 0) continue;
    const sx = cam.originX + i * step * cam.scale;
    if (sx < 20 || sx > numberLimit) continue;
    // Fold onto one period: 0, half, 0, half, and so on.
    const within = ((((i % 10) + 10) % 10) * step);
    ctx.fillText(within.toFixed(2), sx, footY + 10);
  }

  ctx.textAlign = "right";
  ctx.fillText("STATION, ONE PERIOD", vp.width - 12, footY + 10);
}

/** Rough hub-to-outline distance along a direction, for sizing the index tick. */
function radiusAt(centred: Polygon, angle: number): number {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  let best = 0;
  for (const p of centred) {
    const along = p.x * ux + p.y * uy;
    if (along > best) best = along;
  }
  return best > 0 ? best : 1;
}

/** Trace the wheel at a given position, without stroking or filling it. */
function traceWheel(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  centred: Polygon,
  hubX: number,
  contactTheta: number,
): void {
  // The point at contactTheta must point down, which is screen-down and world
  // angle -PI/2. Rolling to the right therefore turns the wheel clockwise.
  const rotation = -Math.PI / 2 - contactTheta;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const hubSx = cam.originX + hubX * cam.scale;
  const hubSy = cam.originY;

  ctx.beginPath();
  centred.forEach((p, i) => {
    const rx = p.x * cos - p.y * sin;
    const ry = p.x * sin + p.y * cos;
    const sx = hubSx + rx * cam.scale;
    const sy = hubSy - ry * cam.scale;
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
}

/**
 * The region below the road surface, as a closed path down to the band foot.
 * Used to clip the interference callout to exactly the ground the wheel invades.
 */
function traceBelowRoad(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  road: Road,
  fromX: number,
  toX: number,
  bottomY: number,
): void {
  const { points, period } = road;
  const firstTile = Math.floor(fromX / period) - 1;
  const lastTile = Math.ceil(toX / period) + 1;

  const coords: Array<[number, number]> = [];
  for (let tile = firstTile; tile <= lastTile; tile++) {
    const offset = tile * period;
    for (const p of points) {
      const wx = p.x + offset;
      if (wx < fromX - period || wx > toX + period) continue;
      coords.push([cam.originX + wx * cam.scale, cam.originY - p.y * cam.scale]);
    }
  }
  if (coords.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(coords[0]![0], coords[0]![1]);
  for (let i = 1; i < coords.length; i++) ctx.lineTo(coords[i]![0], coords[i]![1]);
  ctx.lineTo(coords[coords.length - 1]![0], bottomY);
  ctx.lineTo(coords[0]![0], bottomY);
  ctx.closePath();
}

/**
 * The car body, traced from Basel's own sketch.
 *
 * A side elevation facing left: long bonnet, tall cabin, windscreen, headrest and
 * steering wheel, open along the bottom where the wheels go. Coordinates are
 * normalised to 0..1, x left to right and y top to bottom, so the drawing scales to
 * whatever wheelbase is set.
 *
 * Kept as the author's own line rather than redrawn into something neater. It is the
 * one hand-made thing on a sheet full of computed curves, and the chassis it sits on
 * is what makes the level ride legible.
 */
const CAR_SILHOUETTE: ReadonlyArray<readonly [number, number]> = [
  // Both ends are pulled down to 1.0 so the underside closes flat. In the sketch the
  // line simply stops in mid-air at each end, which is fine for an open drawing but
  // would close on a diagonal once filled, and that diagonal reads as a mistake.
  [0.0, 1.0],
  [0.022, 0.74],
  [0.05, 0.642],
  [0.088, 0.594],
  [0.133, 0.57],
  [0.196, 0.562],
  [0.272, 0.56],
  [0.311, 0.563],
  [0.33, 0.5],
  [0.356, 0.391],
  [0.385, 0.27],
  [0.417, 0.152],
  [0.445, 0.07],
  [0.472, 0.013],
  [0.517, 0.0],
  [0.563, 0.004],
  [0.606, 0.013],
  [0.645, 0.05],
  [0.678, 0.113],
  [0.703, 0.23],
  [0.722, 0.364],
  [0.736, 0.462],
  [0.744, 0.517],
  [0.783, 0.522],
  [0.828, 0.526],
  [0.865, 0.556],
  [0.9, 0.603],
  [0.937, 0.7],
  [0.972, 0.815],
  [0.99, 0.93],
  [1.0, 1.0],
];

/** Windscreen and A-pillar, the inner line in the sketch. */
const CAR_PILLAR: ReadonlyArray<readonly [number, number]> = [
  [0.581, 0.04],
  [0.571, 0.2],
  [0.567, 0.404],
  [0.605, 0.475],
  [0.649, 0.53],
];

function drawCarBody(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  leadX: number,
  trailX: number,
  reachPx: number,
): void {
  // Lifted clear of the axle line rather than sitting on it. A real floor sits above
  // the axle anyway, and when the two coincided the body's dark sill painted over the
  // blue datum, which is the one line on the sheet that must always stay readable.
  const deckY = cam.originY - reachPx * 0.22;
  const x1 = cam.originX + trailX * cam.scale;
  const x2 = cam.originX + leadX * cam.scale;
  const span = x2 - x1;
  if (span < 54) return; // Too cramped for the body to read.

  // The body overhangs both axles, as a real one does.
  const overhang = span * 0.15;
  const left = x1 - overhang;
  const bodyW = span + overhang * 2;
  // Height comes from the WHEEL, not the width. Tying it to width made the car
  // stretch into a flat sliver whenever the wheelbase grew. A real body is roughly
  // one and a bit wheel diameters tall, so that is the ratio used here.
  const bodyH = reachPx * 2.3;
  const top = deckY - bodyH;

  const px = (n: number): number => left + n * bodyW;
  const py = (n: number): number => top + n * bodyH;

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Silhouette, closed along the bottom so it can be filled and so the wheels drawn
  // afterwards cover it.
  ctx.beginPath();
  ctx.moveTo(px(CAR_SILHOUETTE[0]![0]), py(CAR_SILHOUETTE[0]![1]));
  for (const [nx, ny] of CAR_SILHOUETTE.slice(1)) ctx.lineTo(px(nx), py(ny));
  ctx.closePath();
  ctx.fillStyle = INK.band;
  ctx.fill();
  ctx.strokeStyle = INK.road;
  ctx.lineWidth = WEIGHT.medium;
  ctx.stroke();

  ctx.lineWidth = WEIGHT.thin;

  // Windscreen and pillar.
  ctx.beginPath();
  ctx.moveTo(px(CAR_PILLAR[0]![0]), py(CAR_PILLAR[0]![1]));
  for (const [nx, ny] of CAR_PILLAR.slice(1)) ctx.lineTo(px(nx), py(ny));
  ctx.stroke();

  // Only draw the cabin details once there is room for them to read.
  if (bodyW < 150) return;

  // Headrest.
  const hrX = px(0.661);
  const hrY = py(0.146);
  const hrW = px(0.694) - hrX;
  const hrH = py(0.305) - hrY;
  ctx.beginPath();
  ctx.moveTo(hrX, hrY + hrH * 0.3);
  ctx.quadraticCurveTo(hrX, hrY, hrX + hrW * 0.5, hrY);
  ctx.quadraticCurveTo(hrX + hrW, hrY, hrX + hrW, hrY + hrH * 0.3);
  ctx.lineTo(hrX + hrW, hrY + hrH);
  ctx.lineTo(hrX, hrY + hrH);
  ctx.closePath();
  ctx.stroke();

  // Steering wheel.
  ctx.beginPath();
  ctx.arc(px(0.702), py(0.444), Math.max(3, bodyW * 0.024), 0, Math.PI * 2);
  ctx.stroke();

  // Dash, the short run from the pillar to the steering column.
  ctx.beginPath();
  ctx.moveTo(px(0.645), py(0.35));
  ctx.lineTo(px(0.7), py(0.40));
  ctx.stroke();
}

/** The wheel, rotated so its contact point faces straight down. */
function drawWheel(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  centred: Polygon,
  hubX: number,
  contactTheta: number,
): void {
  traceWheel(ctx, cam, centred, hubX, contactTheta);

  // Filled, so the wheel hides the chassis behind it the way a real wheel does.
  // This is safe for the road because a wheel that rolls only touches the road at a
  // point, so there is nothing of the road underneath to lose. Where a wheel does
  // overlap the road that is a genuine clash, and the callout is drawn afterwards so
  // it survives the fill.
  ctx.fillStyle = INK.band;
  ctx.fill();

  ctx.strokeStyle = INK.outline;
  ctx.lineWidth = WEIGHT.heavy;
  ctx.lineJoin = "round";
  ctx.stroke();

  const hubSx = cam.originX + hubX * cam.scale;
  const hubSy = cam.originY;

  // Index tick, the drawing convention for a timed part. It points along the
  // outline's own zero direction, so two wheels in phase show parallel ticks and two
  // out of phase do not. This is what makes the wheelbase relationship visible.
  const rotation = -Math.PI / 2 - contactTheta;
  const tickLen = Math.min(26, 0.42 * cam.scale * radiusAt(centred, 0));
  ctx.strokeStyle = INK.graphite;
  ctx.lineWidth = WEIGHT.medium;
  ctx.beginPath();
  ctx.moveTo(hubSx, hubSy);
  ctx.lineTo(
    hubSx + Math.cos(rotation) * tickLen,
    hubSy - Math.sin(rotation) * tickLen,
  );
  ctx.stroke();

  // Hub mark, so the eye has something to track against the datum.
  ctx.strokeStyle = INK.road;
  ctx.lineWidth = WEIGHT.thin;
  ctx.beginPath();
  ctx.moveTo(hubSx - 8, hubSy);
  ctx.lineTo(hubSx + 8, hubSy);
  ctx.moveTo(hubSx, hubSy - 8);
  ctx.lineTo(hubSx, hubSy + 8);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(hubSx, hubSy, 3.5, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * The band when no road exists.
 *
 * Composed rather than blank. Unlit segments are designed too, which is the
 * discipline this project took from the seven-segment world, and a drawing marked
 * void is a real drawing while an empty rectangle just looks broken. The datum still
 * runs across it, because the datum is true regardless of whether a road was found.
 */
export function drawVoidBand(vp: Viewport, reason: string): void {
  const { ctx, width, height } = vp;

  ctx.fillStyle = INK.band;
  ctx.fillRect(0, 0, width, height);

  // The datum sits high, so the void hatch owns most of the band. With no wheel to
  // make room for above it, centring the datum would leave the top third dead.
  const datumY = TOP_PADDING + (height - TOP_PADDING - FOOT_ROOM) * 0.16;

  // Diagonal hatch across the region that would have carried the road.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, datumY, width, height - FOOT_ROOM - datumY);
  ctx.clip();
  ctx.strokeStyle = INK.graphite;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = WEIGHT.hair;
  ctx.beginPath();
  for (let d = -height; d < width + height; d += 11) {
    ctx.moveTo(d, height);
    ctx.lineTo(d + height, 0);
  }
  ctx.stroke();
  ctx.restore();

  // The datum holds, because it does not depend on a road being found.
  ctx.strokeStyle = INK.datum;
  ctx.lineWidth = WEIGHT.medium;
  ctx.beginPath();
  ctx.moveTo(0, crisp(datumY));
  ctx.lineTo(width, crisp(datumY));
  ctx.stroke();

  ctx.font = sheetFont(10, 600);
  ctx.fillStyle = INK.datum;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("AXLE LINE", 12, datumY - 6);

  ctx.font = sheetFont(10, 600);
  ctx.fillStyle = INK.graphite;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("FIG 2  ROAD PROFILE", 12, 10);
  ctx.textAlign = "right";
  ctx.fillText("VOID", width - 12, 10);

  // The reason, stamped in the visitor's own ink so it reads as a result.
  const stamp = "NO ROAD FOR THIS SHAPE";
  ctx.font = sheetFont(15, 700);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const boxW = Math.min(ctx.measureText(stamp).width + 34, width - 40);
  const boxH = 34;
  const boxX = (width - boxW) / 2;
  const boxY = datumY + (height - FOOT_ROOM - datumY) / 2 - boxH / 2;

  ctx.fillStyle = INK.band;
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = INK.outline;
  ctx.lineWidth = WEIGHT.medium;
  ctx.strokeRect(crisp(boxX), crisp(boxY), boxW, boxH);
  ctx.fillStyle = INK.outline;
  ctx.fillText(stamp, width / 2, boxY + boxH / 2 + 1);

  // A written short label, never a truncated sentence. The full wording is in the
  // margin readout, so the stamp only has to name the cause.
  ctx.font = sheetFont(10, 500);
  ctx.fillStyle = INK.graphite;
  ctx.textBaseline = "top";
  ctx.fillText(reason, width / 2, boxY + boxH + 10);

  ctx.strokeStyle = INK.graphite;
  ctx.lineWidth = WEIGHT.thin;
  ctx.strokeRect(crisp(0), crisp(0), width - 1, height - 1);
}

export function drawRoadBand(vp: Viewport, state: RoadState): void {
  const { ctx, width, height } = vp;
  const { road, track, centred, travelled, rolling } = state;

  ctx.fillStyle = INK.band;
  ctx.fillRect(0, 0, width, height);

  const { camera: cam } = roadView(vp, state);
  const fromX = (0 - cam.originX) / cam.scale;
  const toX = (width - cam.originX) / cam.scale;

  // Stations stay upright. They mark horizontal chainage, and on a real profile
  // sheet the ground line climbs across a vertical station grid rather than the grid
  // tipping with it.
  drawStations(ctx, cam, vp, fromX, toX, road.period);

  // Everything that belongs to the road tips together. The profile relative to the
  // datum is untouched, which is why this is exact rather than an approximation.
  const { pivotX, pivotY } = datumGeometry(state, cam);
  const tilted = Math.abs(state.grade) > 1e-6;
  ctx.save();
  if (tilted) {
    ctx.translate(pivotX, pivotY);
    ctx.rotate(-Math.atan(state.grade));
    ctx.translate(-pivotX, -pivotY);
  }

  const leadX = rolling ? travelled : road.period / 2;
  const trailX = leadX - state.wheelbase;
  const hubX = leadX;
  const contact = contactOn(track, leadX);
  const trailContact = contactOn(track, trailX);
  const hasAssembly = state.wheelbase > 0;

  // Road ahead of the wheel, ghosted. Composed absence, not blank paper.
  if (rolling) {
    ctx.save();
    ctx.beginPath();
    const splitSx = cam.originX + hubX * cam.scale;
    ctx.rect(splitSx, 0, width - splitSx, height);
    ctx.clip();
    traceRoad(ctx, cam, road, fromX, toX);
    ctx.strokeStyle = INK.graphite;
    ctx.globalAlpha = 0.45;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = WEIGHT.thin;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Road already rolled, in full drafting ink. This is the computed answer.
  ctx.save();
  if (rolling) {
    const splitSx = cam.originX + hubX * cam.scale;
    ctx.beginPath();
    ctx.rect(0, 0, splitSx, height);
    ctx.clip();
  }
  traceRoad(ctx, cam, road, fromX, toX);
  ctx.strokeStyle = INK.road;
  ctx.lineWidth = WEIGHT.heavy;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();

  // The datum. Slate blue, reserved, and the only dead straight line on the sheet.
  ctx.strokeStyle = INK.datum;
  ctx.lineWidth = WEIGHT.medium;
  ctx.beginPath();
  ctx.moveTo(0, crisp(cam.originY));
  ctx.lineTo(width, crisp(cam.originY));
  ctx.stroke();

  ctx.font = sheetFont(10, 600);
  ctx.fillStyle = INK.datum;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("AXLE LINE  DRAG EITHER END TO TILT", 12, cam.originY - 6);

  if (rolling) {
    const wheels: ReadonlyArray<{ x: number; theta: number }> = hasAssembly
      ? [
          { x: trailX, theta: trailContact.theta },
          { x: leadX, theta: contact.theta },
        ]
      : [{ x: leadX, theta: contact.theta }];

    // Clash callouts, drawn before the wheels so the outlines stay crisp on top.
    // A wheel with sharp enough corners genuinely drives into the road it derived,
    // and the overlap is the single most interesting thing on the sheet when it
    // happens. Marking it turns an apparent glitch into the finding it actually is.
    if (state.interference >= BIND.clear) {
      ctx.save();
      traceBelowRoad(ctx, cam, road, fromX, toX, height);
      ctx.clip();
      for (const w of wheels) {
        traceWheel(ctx, cam, centred, w.x, w.theta);
        ctx.fillStyle = INK.outline;
        ctx.globalAlpha = 0.28;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = INK.outline;
        ctx.lineWidth = WEIGHT.medium;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // Body and chassis first, so the filled wheels cover them as real wheels would.
    if (hasAssembly) {
      drawCarBody(ctx, cam, leadX, trailX, road.maxDepth * cam.scale);
    }

    for (const w of wheels) drawWheel(ctx, cam, centred, w.x, w.theta);

    // Clash lens again, on top of the filled wheels, because the fill would
    // otherwise bury the one thing the visitor most needs to see.
    if (state.interference >= BIND.clear) {
      ctx.save();
      traceBelowRoad(ctx, cam, road, fromX, toX, height);
      ctx.clip();
      for (const w of wheels) {
        traceWheel(ctx, cam, centred, w.x, w.theta);
        ctx.fillStyle = INK.outline;
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    if (state.interference >= BIND.clear) {
      const label =
        state.interference >= BIND.binds
          ? `THE WHEEL CATCHES THE ROAD BY ${(state.interference * 100).toFixed(1)}%, SO IT WOULD JAM`
          : `THE WHEEL GRAZES THE ROAD BY ${(state.interference * 100).toFixed(1)}%`;
      ctx.font = sheetFont(10, 700);
      ctx.fillStyle = INK.outline;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(label, width / 2, TOP_PADDING - 16);
    }
  }

  ctx.restore();

  // Grade handles and callouts live on the untilted sheet, because they are controls
  // and annotation rather than part of the road.
  if (rolling && state.showGradeHandles) {
    const handles = gradeHandles(vp, state);
    ctx.strokeStyle = INK.datum;
    ctx.fillStyle = INK.band;
    ctx.lineWidth = WEIGHT.medium;
    for (const h of [handles.left, handles.right]) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Up and down chevrons, so the handle says which way it moves.
      ctx.beginPath();
      ctx.moveTo(h.x - 3.5, h.y - 2.5);
      ctx.lineTo(h.x, h.y - 5.5);
      ctx.lineTo(h.x + 3.5, h.y - 2.5);
      ctx.moveTo(h.x - 3.5, h.y + 2.5);
      ctx.lineTo(h.x, h.y + 5.5);
      ctx.lineTo(h.x + 3.5, h.y + 2.5);
      ctx.lineWidth = WEIGHT.thin;
      ctx.stroke();
      ctx.lineWidth = WEIGHT.medium;
    }
  }

  ctx.font = sheetFont(10, 600);
  ctx.fillStyle = INK.graphite;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("FIG 2  ROAD PROFILE", 12, 10);

  // Grade callout, the way a profile sheet states one.
  if (Math.abs(state.grade) > 1e-6) {
    const pct = state.grade * 100;
    const sense = pct > 0 ? "UP" : "DOWN";
    ctx.fillText(`GRADE ${Math.abs(pct).toFixed(1)}% ${sense}`, 12, 24);
  }

  ctx.textAlign = "right";
  ctx.fillText(`PERIOD ${road.period.toFixed(4)}`, width - 12, 10);

  // Phase between the two wheels. Zero at a whole number of periods, because the
  // closure condition advances theta by exactly one turn per period. Reported rather
  // than asserted, so a visitor can check the claim against the index ticks.
  if (rolling && hasAssembly) {
    const tau = Math.PI * 2;
    const offset = ((contact.theta - trailContact.theta) % tau + tau) % tau;
    const degrees = (offset * 180) / Math.PI;
    const inPhase = Math.min(degrees, 360 - degrees) < 1.5;
    ctx.fillStyle = inPhase ? INK.road : INK.graphite;
    ctx.fillText(
      inPhase ? "WHEELS TURNED ALIKE" : `WHEELS ${degrees.toFixed(0)} DEG APART`,
      width - 12,
      24,
    );

    // Below twice the longest reach the two wheels are closer than their own width,
    // so they are drawn passing through each other. Stated plainly rather than left
    // looking like a drawing fault, which is the same rule the clash callout follows.
    if (state.wheelbase < road.maxDepth * 2) {
      ctx.fillStyle = INK.outline;
      ctx.fillText("WHEELS SET CLOSER THAN THEIR OWN WIDTH", width - 12, 38);
    }
    ctx.fillStyle = INK.graphite;
  }

  ctx.strokeStyle = INK.graphite;
  ctx.lineWidth = WEIGHT.thin;
  ctx.strokeRect(crisp(0), crisp(0), width - 1, height - 1);
}
