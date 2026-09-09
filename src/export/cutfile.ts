/**
 * Fabrication export: the wheel and one period of road as a cut file.
 *
 * Real millimetres, a stated kerf, and an honest warning. A shape measured in screen
 * pixels is not a manufacturable file.
 *
 * The warning matters. Sharp-cornered wheels are perfectly valid in the integral and
 * jam in wood, because the corners bind in the ruts. MathWorld records the rolling
 * equilateral triangle as unbuildable for exactly this reason, which is what
 * calibrates the rut-depth threshold.
 */

import type { Polygon } from "../core/polygon.js";
import type { Road } from "../core/road.js";
import { bindVerdict } from "../render/theme.js";

export interface CutOptions {
  /** Longest wheel radius in millimetres. Sets the whole drawing's scale. */
  readonly wheelRadiusMm: number;
  /** Number of road periods to lay out. */
  readonly periods: number;
  /** Cutter kerf in millimetres, reported rather than compensated. */
  readonly kerfMm: number;
  /** Measured interference, so the file can warn honestly about binding. */
  readonly interference: number;
}

export const DEFAULT_CUT: Omit<CutOptions, "interference"> = {
  wheelRadiusMm: 60,
  periods: 3,
  kerfMm: 0.2,
};

const fmt = (n: number): string => n.toFixed(3);

/**
 * Build an SVG cut file.
 *
 * Geometry is in millimetres via an explicit `viewBox` plus `mm` width and height,
 * which is what makes cutting software open it at the intended size rather than
 * guessing from pixels.
 */
export function buildCutSvg(
  centredOutline: Polygon,
  road: Road,
  maxRadius: number,
  opts: CutOptions,
): string {
  if (centredOutline.length < 3) throw new Error("Nothing to cut.");
  if (!(maxRadius > 0)) throw new Error("The outline has no size.");

  // One world unit in millimetres.
  const k = opts.wheelRadiusMm / maxRadius;

  const wheelPts = centredOutline
    .map((p) => `${fmt(p.x * k)},${fmt(-p.y * k)}`)
    .join(" ");

  // Road, tiled, with the hub line as the datum reference.
  const roadPts: string[] = [];
  for (let tile = 0; tile < opts.periods; tile++) {
    const offset = tile * road.period;
    for (const p of road.points) {
      // Skip the duplicated closing point except on the final tile.
      if (tile < opts.periods - 1 && p === road.points[road.points.length - 1]) continue;
      roadPts.push(`${fmt((p.x + offset) * k)},${fmt(-p.y * k)}`);
    }
  }

  const roadWidthMm = road.period * opts.periods * k;
  const roadDepthMm = road.maxDepth * k;
  const wheelSpanMm = maxRadius * 2 * k;

  const margin = 10;
  const gap = 12;
  const totalW = Math.max(roadWidthMm, wheelSpanMm) + margin * 2;
  const totalH = wheelSpanMm + gap + roadDepthMm + margin * 2 + 14;

  const verdict = bindVerdict(opts.interference);
  const pct = (opts.interference * 100).toFixed(2);
  const warning =
    verdict === "binds"
      ? `WARNING this wheel drives ${pct} percent of the axle height into its own road, so the corners will bind exactly as a rolling equilateral triangle does. Cut it as a display piece, not as a working pair`
      : verdict === "marginal"
        ? `CAUTION measured interference is ${pct} percent of the axle height, so this pair needs generous clearance at the cusps`
        : `Measured interference is ${pct} percent of the axle height, so this pair should roll clear`;

  const wheelY = margin + maxRadius * k;
  const roadY = margin + wheelSpanMm + gap;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Roadwright cut file.
  Wheel and ${opts.periods} road period(s), derived from the outline by
  x(theta) = integral of r dtheta, y = -r.

  Units are millimetres. Longest wheel radius is ${fmt(opts.wheelRadiusMm)} mm.
  One road period measures ${fmt(road.period * k)} mm and the deepest rut is ${fmt(roadDepthMm)} mm.
  Kerf is reported, NOT compensated: paths are the true geometry, so offset by
  ${fmt(opts.kerfMm)} mm in your cutting software.

  ${warning}.
-->
<svg xmlns="http://www.w3.org/2000/svg"
     width="${fmt(totalW)}mm" height="${fmt(totalH)}mm"
     viewBox="0 0 ${fmt(totalW)} ${fmt(totalH)}">
  <g fill="none" stroke="#000000" stroke-width="0.1">
    <g id="wheel" transform="translate(${fmt(margin + maxRadius * k)} ${fmt(wheelY)})">
      <polygon points="${wheelPts}" />
    </g>
    <g id="road" transform="translate(${fmt(margin)} ${fmt(roadY)})">
      <polyline points="${roadPts.join(" ")}" />
      <line x1="0" y1="0" x2="${fmt(roadWidthMm)}" y2="0" stroke-dasharray="2,2" />
    </g>
  </g>
</svg>
`;
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke on the next turn so the click has definitely been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadCanvas(filename: string, canvas: HTMLCanvasElement): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, "image/png");
}

/**
 * Record the road band as a silent looping clip.
 *
 * Silent looping motion is the format the whole product was chosen for, so this is
 * a first-class output rather than a convenience. Uses MediaRecorder over
 * captureStream, which needs no extra payload.
 */
export function recordLoop(
  canvas: HTMLCanvasElement,
  durationMs: number,
  onDone: (ok: boolean) => void,
): (() => void) | null {
  const anyCanvas = canvas as HTMLCanvasElement & {
    captureStream?: (fps?: number) => MediaStream;
  };
  if (typeof anyCanvas.captureStream !== "function" || typeof MediaRecorder === "undefined") {
    onDone(false);
    return null;
  }

  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) {
    onDone(false);
    return null;
  }

  const stream = anyCanvas.captureStream(60);
  const chunks: Blob[] = [];
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });

  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "roadwright-loop.webm";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    onDone(true);
  };

  rec.start();
  const timer = setTimeout(() => {
    if (rec.state !== "inactive") rec.stop();
  }, durationMs);

  return () => {
    clearTimeout(timer);
    if (rec.state !== "inactive") rec.stop();
  };
}
