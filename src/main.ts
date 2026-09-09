/**
 * Wiring only. No geometry lives here.
 *
 * State flows one way: an outline plus a hub goes through `validateOutline`, and
 * everything drawn or reported downstream comes from that single result. There is
 * no second place that decides whether a shape is valid.
 */

import type { HubZone } from "./core/kernel.js";
import type { Polygon } from "./core/polygon.js";
import { boundingBox } from "./core/polygon.js";
import { PRESETS, presetById } from "./core/presets.js";
import {
  type Road,
  type RollTrack,
  contactOn,
  interference,
  prepareRoll,
  roadFromProfile,
} from "./core/road.js";
import { validateOutline } from "./core/validate.js";
import { type Vec, sub } from "./core/vec.js";
import { radiusExtent, radiusProfile } from "./core/wheel.js";
import {
  DEFAULT_CUT,
  buildCutSvg,
  downloadCanvas,
  downloadText,
  recordLoop,
} from "./export/cutfile.js";
import { drawDetail, detailCamera } from "./render/detail.js";
import {
  type RoadState,
  GRADE_HANDLE_RADIUS,
  drawRoadBand,
  drawVoidBand,
  gradeFromHandleDrag,
  gradeHandles,
} from "./render/roadview.js";
import { BIND, bindVerdict } from "./render/theme.js";
import { type Camera, type Viewport, acquire } from "./render/viewport.js";
import {
  currentShareUrl,
  encodeOutlineFragment,
  encodePresetFragment,
  parseFragment,
  writeFragment,
} from "./share/fragment.js";
import {
  type SpinVoice,
  SpinTrigger,
  createSpinVoice,
  isSupported as spinSupported,
} from "./audio/spin.js";
import { attachDrawing } from "./ui/draw.js";
import { attachGradeDrag } from "./ui/grade.js";
import { attachHubDrag } from "./ui/hub.js";

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node as T;
};

const detailCanvas = el<HTMLCanvasElement>("detail-canvas");
const roadCanvas = el<HTMLCanvasElement>("road-canvas");
const readout = el<HTMLParagraphElement>("readout");
const formList = el<HTMLDivElement>("form-list");
const gauge = el<HTMLDivElement>("gauge");
const gaugeFill = el<HTMLDivElement>("gauge-fill");
const gaugeValue = el<HTMLSpanElement>("gauge-value");
const speedInput = el<HTMLInputElement>("speed");
const speedValue = el<HTMLSpanElement>("speed-value");
const wheelbaseInput = el<HTMLInputElement>("wheelbase");
const wheelbaseValue = el<HTMLSpanElement>("wheelbase-value");
const soundBtn = el<HTMLButtonElement>("sound-btn");
const drawBtn = el<HTMLButtonElement>("draw-btn");
const drawBtnLabel = el<HTMLSpanElement>("draw-btn-label");
const stopBtn = el<HTMLButtonElement>("stop-btn");
const shareBtn = el<HTMLButtonElement>("share-btn");
const pngBtn = el<HTMLButtonElement>("png-btn");
const svgBtn = el<HTMLButtonElement>("svg-btn");
const videoBtn = el<HTMLButtonElement>("video-btn");
const stampStatus = el<HTMLSpanElement>("stamp-status");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

interface Solved {
  readonly outline: Polygon;
  /** Exactly what the visitor drew, ghosted in FIG 1 when it had to be bridged. */
  readonly original: Polygon;
  readonly adjusted: boolean;
  readonly deviation: number;
  readonly hub: Vec;
  readonly zone: HubZone;
  /** Outline translated so the hub sits at the origin. */
  readonly centred: Polygon;
  readonly road: Road;
  readonly track: RollTrack;
  readonly rMin: number;
  readonly rMax: number;
  readonly rutDepth: number;
  /** Measured, not inferred: how far the wheel drives into its own road. */
  readonly interference: number;
}

interface AppState {
  outline: Polygon;
  hub: Vec | null;
  solved: Solved | null;
  refusal: { message: string; short: string; highlight: readonly number[] } | null;
  travelled: number;
  speed: number;
  paused: boolean;
  drawingMode: boolean;
  strokePreview: Polygon | null;
  sourceId: string | null;
  recording: boolean;
  /** Wheelbase in road periods. Zero draws a single wheel. */
  wheelbasePeriods: number;
  soundOn: boolean;
  /** Road grade as rise over run. Dragging either end of the datum sets it. */
  grade: number;
  gradeDrag: "left" | "right" | null;
}

const state: AppState = {
  outline: [],
  hub: null,
  solved: null,
  refusal: null,
  travelled: 0,
  speed: 0.8,
  paused: reducedMotion.matches,
  drawingMode: false,
  strokePreview: null,
  sourceId: null,
  recording: false,
  wheelbasePeriods: 1,
  // Off until asked for. The payoff has to read muted, and audio may not start
  // without an explicit gesture.
  soundOn: false,
  grade: 0,
  gradeDrag: null,
};

/** Grade is clamped to a range a road could plausibly be built at. */
const MAX_GRADE = 0.35;

let spinVoice: SpinVoice | null = null;
const spinTrigger = new SpinTrigger();

let detailCam: Camera | null = null;

/**
 * Eased view of the road.
 *
 * Dragging the hub used to snap the road instantly, which made the connection
 * between the two bands hard to read. The fix is not to lag the drag: the hub marker
 * in FIG 1 stays exactly on the pointer, and every number reports the true answer.
 * Only FIG 2's road eases, because the road is a consequence of the hub rather than
 * the thing being touched.
 *
 * Both the eased road and its wheel are derived from `displayHub`, so they always
 * agree with each other. Interpolating between two hubs inside the permissible zone
 * is always safe, because the zone is a convex region and therefore contains every
 * point on the segment between them.
 */
let displayHub: Vec | null = null;
let displayRoad: Road | null = null;
let displayTrack: RollTrack | null = null;
let displayCentred: Polygon = [];
let morphing = false;

/**
 * Easing time constant, and the distance at which the morph snaps shut.
 *
 * Exponential easing looks finished after two or three time constants, but its tail
 * runs forever, so the snap threshold decides how long the frames keep being spent.
 * At 1e-3 of the wheel's reach the remaining motion is comfortably sub-pixel, and
 * the morph closes in roughly 260 ms instead of dragging on past 400 ms.
 */
const MORPH_TAU = 0.038;
const MORPH_SNAP = 1e-3;

function profileAt(outline: Polygon, hub: Vec): {
  road: Road;
  track: RollTrack;
  centred: Polygon;
} {
  const profile = radiusProfile(outline, hub, 1024);
  return {
    road: roadFromProfile(profile),
    track: prepareRoll(profile),
    centred: outline.map((p) => sub(p, hub)),
  };
}

/** Rebuild the eased view, preserving roll phase across a period change. */
function rebuildDisplay(hub: Vec): void {
  const s = state.solved;
  if (!s) return;
  try {
    const previousPeriod = displayRoad?.period ?? null;
    const next = profileAt(s.outline, hub);

    // Keep the wheel where it is in the cycle. Holding absolute distance while the
    // period shifts would make the wheel jump mid-morph.
    if (previousPeriod && previousPeriod > 0) {
      const phase = (state.travelled % previousPeriod) / previousPeriod;
      const whole = Math.floor(state.travelled / previousPeriod);
      state.travelled = (whole + phase) * next.road.period;
    }

    displayHub = hub;
    displayRoad = next.road;
    displayTrack = next.track;
    displayCentred = next.centred;
  } catch {
    // Should not happen for a hub inside a convex zone, but never let the view
    // easing break the app: fall back to the settled solution.
    displayHub = s.hub;
    displayRoad = s.road;
    displayTrack = s.track;
    displayCentred = s.centred;
    morphing = false;
  }
}

function snapDisplay(): void {
  const s = state.solved;
  if (!s) {
    displayHub = null;
    displayRoad = null;
    displayTrack = null;
    displayCentred = [];
    morphing = false;
    return;
  }
  displayHub = s.hub;
  displayRoad = s.road;
  displayTrack = s.track;
  displayCentred = s.centred;
  morphing = false;
}

/**
 * Solve an outline and hub into everything the sheet needs, or record a refusal.
 * The only place that decides validity.
 */
function solve(outline: Polygon, requestedHub?: Vec, animate = false): void {
  const result = validateOutline(outline, requestedHub);

  if (!result.ok) {
    state.solved = null;
    snapDisplay();
    state.refusal = {
      message: result.refusal.message,
      short: result.refusal.short,
      highlight: result.refusal.highlight,
    };
    state.outline = outline;
    state.hub = requestedHub ?? null;
    return;
  }

  try {
    const profile = radiusProfile(result.outline, result.hub, 1024);
    const road = roadFromProfile(profile);
    const extent = radiusExtent(profile);
    const centred = result.outline.map((p) => sub(p, result.hub));
    const track = prepareRoll(profile);

    state.solved = {
      outline: result.outline,
      original: result.original,
      adjusted: result.adjusted,
      deviation: result.deviation,
      hub: result.hub,
      zone: result.zone,
      centred,
      road,
      track,
      rMin: extent.min,
      rMax: extent.max,
      rutDepth: extent.rutDepth,
      interference: interference(centred, road, track),
    };
    state.outline = result.outline;
    state.hub = result.hub;
    state.refusal = null;

    // Ease only when the same outline's hub moved. A new outline snaps, because
    // morphing between unrelated shapes would be noise rather than explanation.
    if (animate && displayHub && displayRoad) morphing = true;
    else snapDisplay();
  } catch (err) {
    // radiusProfile throws with a visitor-facing sentence when a ray cannot resolve.
    state.solved = null;
    state.outline = result.outline;
    state.hub = result.hub;
    state.refusal = {
      message: err instanceof Error ? err.message : "That outline has no road.",
      short: "THE HUB CANNOT RESOLVE THIS OUTLINE",
      highlight: [],
    };
    snapDisplay();
  }
}

function describe(): string {
  if (state.refusal) return state.refusal.message;
  const s = state.solved;
  if (!s) return "Pick a shape or draw your own, and the sheet works out the road.";

  const verdict = bindVerdict(s.interference);
  const pct = (s.interference * 100).toFixed(1);
  const buildNote =
    verdict === "binds"
      ? `Build this and it will jam: the corners bite ${pct} percent of the way into the road.`
      : verdict === "marginal"
        ? `It grazes the road by ${pct} percent, so a real one would need clearance at the dips.`
        : "Nothing catches, so a real one would roll.";

  // Say what was changed before saying anything else about it. Adjusting a drawing
  // and then reporting figures as if nothing happened would be the dishonest version.
  const adjustedNote = s.adjusted
    ? `Your outline had a pocket the axle could not see into, so it was bridged across to make a wheel. The faint line shows what you drew. `
    : "";

  const gradeNote =
    Math.abs(state.grade) > 1e-6
      ? ` The road climbs at ${Math.abs(state.grade * 100).toFixed(1)} percent, and the axle still tracks it exactly.`
      : "";

  return `${adjustedNote}One length of road measures ${s.road.period.toFixed(2)} and the axle sits ${s.rMax.toFixed(2)} above the lowest dip. ${buildNote}${gradeNote}`;
}

function paintChrome(): void {
  readout.textContent = describe();
  readout.classList.toggle("is-refusal", state.refusal !== null);

  // The gauge is a budget you watch yourself approach, not a verdict delivered
  // once you arrive. The bar spans 0 to BIND.binds * 2, so the binding threshold
  // lands on the printed mark at 50%. Keep those two numbers in step.
  const bind = state.solved?.interference ?? 0;
  const full = BIND.binds * 2;
  // Transform, not width: animating width thrashes layout every frame.
  const ratio = Math.min(1, bind / full);
  gaugeFill.style.transform = `scaleX(${ratio.toFixed(4)})`;
  gaugeValue.textContent = `${(bind * 100).toFixed(2)}%`;

  const verdict = bindVerdict(bind);
  gauge.classList.toggle("is-tight", verdict === "marginal");
  gauge.classList.toggle("is-jamming", verdict === "binds");
  gauge.setAttribute(
    "aria-label",
    `Interference ${(bind * 100).toFixed(2)} percent of the axle height. ${
      verdict === "binds"
        ? "The wheel collides with its own road, so it cannot turn."
        : verdict === "marginal"
          ? "The wheel grazes the road and needs clearance."
          : "The wheel rides clear."
    }`,
  );

  drawBtn.setAttribute("aria-pressed", String(state.drawingMode));
  // Only the label changes, so the pencil glyph survives the update.
  drawBtnLabel.textContent = state.drawingMode ? "Cancel" : "Draw your own";
  stopBtn.textContent = state.paused ? "Resume roll" : "Pause roll";

  const wb = state.wheelbasePeriods;
  wheelbaseValue.textContent = wb === 0 ? "One wheel" : `${wb.toFixed(2)} P`;

  soundBtn.setAttribute("aria-pressed", String(state.soundOn));
  soundBtn.textContent = state.soundOn ? "Spin sound on" : "Spin sound off";
  soundBtn.disabled = !spinSupported();

  const rollable = state.solved !== null;
  for (const b of [stopBtn, pngBtn, svgBtn, videoBtn, shareBtn]) b.disabled = !rollable;

  for (const btn of Array.from(formList.children)) {
    const id = (btn as HTMLElement).dataset["preset"];
    btn.setAttribute("aria-pressed", String(id === state.sourceId));
  }
}

function paintCanvases(): void {
  const detailVp = acquire(detailCanvas);
  if (detailVp) {
    // The camera follows the settled outline only. Fitting it to the live stroke
    // would move the view under the pointer and corrupt the capture.
    detailCam = state.outline.length >= 3 ? detailCamera(detailVp, state.outline) : null;
    drawDetail(detailVp, {
      outline: state.outline,
      // Shown faintly behind the part whenever bridging changed the drawing, so the
      // visitor can see exactly what was altered.
      ghost: state.solved?.adjusted ? state.solved.original : null,
      preview: state.strokePreview,
      hub: state.strokePreview ? null : state.hub,
      zone: state.strokePreview ? null : (state.solved?.zone ?? null),
      highlight: state.refusal?.highlight ?? [],
      rMin: state.solved?.rMin ?? null,
      rMax: state.solved?.rMax ?? null,
      period: state.solved?.road.period ?? null,
      rutDepth: state.solved?.rutDepth ?? null,
      interference: state.solved?.interference ?? null,
    });
  }

  const roadVp = acquire(roadCanvas);
  if (roadVp && state.solved && displayRoad && displayTrack) {
    drawRoadBand(roadVp, {
      // The eased view, so the road deforms into place rather than snapping.
      road: displayRoad,
      track: displayTrack,
      centred: displayCentred,
      travelled: state.travelled,
      rolling: true,
      // The true measurement, never a mid-morph value. Numbers do not animate.
      interference: state.solved.interference,
      wheelbase: state.wheelbasePeriods * displayRoad.period,
      grade: state.grade,
      showGradeHandles: true,
    });
  } else if (roadVp) {
    drawVoidBand(roadVp, state.refusal?.short ?? "NO OUTLINE SELECTED");
  }
}

function render(): void {
  paintChrome();
  paintCanvases();
}

/**
 * Sound the whistle when the wheel whips round a tight corner.
 *
 * Rolling without slipping gives omega = v / r, so the spin ratio against the wheel's
 * slowest point is simply rMax / r at the contact. No differentiation needed, and the
 * figure is the real angular velocity rather than a stand-in for it.
 */
function maybeWhistle(nowSeconds: number): void {
  if (!state.soundOn || !spinVoice || !state.solved || !displayTrack) return;

  const contact = contactOn(displayTrack, state.travelled);
  if (!(contact.radius > 0)) return;

  const ratio = state.solved.rMax / contact.radius;
  const intensity = spinTrigger.update(ratio, nowSeconds);
  if (intensity !== null) spinVoice.play(intensity);
}

// A render loop must reschedule even if drawing throws, or one bad frame freezes
// the page permanently.
let lastTs: number | null = null;
function frame(ts: number): void {
  try {
    const dt = lastTs === null ? 0 : Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;

    let dirty = false;

    // Ease the displayed hub toward the real one, so the road deforms visibly.
    if (morphing && state.solved && displayHub) {
      const target = state.solved.hub;
      const k = 1 - Math.exp(-dt / MORPH_TAU);
      const next = {
        x: displayHub.x + (target.x - displayHub.x) * k,
        y: displayHub.y + (target.y - displayHub.y) * k,
      };

      const span = Math.max(state.solved.rMax, 1e-9);
      if (Math.hypot(target.x - next.x, target.y - next.y) < span * MORPH_SNAP) {
        snapDisplay();
      } else {
        rebuildDisplay(next);
      }
      dirty = true;
    }

    if (!state.paused && state.solved && state.speed > 0) {
      state.travelled += state.speed * state.solved.rMax * dt * 1.6;
      dirty = true;
      maybeWhistle(ts / 1000);
    }

    if (dirty) paintCanvases();
  } catch (err) {
    console.error(err);
  } finally {
    requestAnimationFrame(frame);
  }
}

function loadPreset(id: string): void {
  const preset = presetById(id);
  if (!preset) return;
  state.sourceId = id;
  state.travelled = 0;
  state.strokePreview = null;
  solve(preset.outline);
  writeFragment(encodePresetFragment(id));
  render();
}

function buildFormButtons(): void {
  for (const preset of PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = preset.label;
    btn.dataset["preset"] = preset.id;
    btn.setAttribute("aria-pressed", "false");
    if (preset.note) btn.title = preset.note;
    btn.addEventListener("click", () => {
      if (state.drawingMode) setDrawingMode(false);
      loadPreset(preset.id);
    });
    formList.appendChild(btn);
  }
}

function setDrawingMode(on: boolean): void {
  state.drawingMode = on;
  state.strokePreview = null;
  detailCanvas.classList.toggle("is-drawing", on);
  readout.textContent = on
    ? "Draw a closed loop in the upper band. Release to solve its road."
    : describe();
  render();
}

// Drawing happens in the detail band, which is where the part lives.
attachDrawing(
  detailCanvas,
  () => detailCam,
  {
    onProgress: (stroke) => {
      if (!state.drawingMode) return;
      state.strokePreview = stroke;
      paintCanvases();
    },
    onFinish: (outline) => {
      if (!state.drawingMode) return;
      state.strokePreview = null;
      state.sourceId = null;
      state.travelled = 0;
      solve(outline);
      if (state.solved) {
        writeFragment(encodeOutlineFragment(state.solved.outline, state.solved.hub));
      }
      setDrawingMode(false);
    },
    onDiscard: (reason) => {
      if (!state.drawingMode) return;
      state.strokePreview = null;
      readout.textContent = reason;
      readout.classList.add("is-refusal");
      paintCanvases();
    },
  },
);

// Hub dragging, clamped to the permissible zone so it cannot be made invalid.
attachHubDrag(
  detailCanvas,
  () => ({
    camera: detailCam,
    hub: state.hub,
    zone: state.solved?.zone.zone ?? [],
    outline: state.outline,
  }),
  {
    onMove: (hub) => {
      if (state.drawingMode) return;
      // Ease the road, unless the visitor asked for less motion.
      solve(state.outline, hub, !reducedMotion.matches);
      if (state.solved) {
        state.sourceId = null;
        writeFragment(encodeOutlineFragment(state.solved.outline, state.solved.hub));
      }
      render();
    },
    onHoverChange: (over) => {
      if (state.drawingMode) return;
      detailCanvas.classList.toggle("can-drag-hub", over);
    },
  },
);

detailCanvas.tabIndex = 0;
detailCanvas.setAttribute("role", "application");
detailCanvas.setAttribute(
  "aria-label",
  "Your shape. Drag the axle, or nudge it with the arrow keys, to change the road.",
);

// Tilting the road by dragging either end of the datum.
attachGradeDrag(
  roadCanvas,
  () => {
    const vp = peekRoadViewport();
    if (!vp || !state.solved || !displayRoad || !displayTrack) return null;
    const rs = roadStateFor(displayRoad, displayTrack);
    const handles = gradeHandles(vp, rs);
    return {
      left: handles.left,
      right: handles.right,
      radius: GRADE_HANDLE_RADIUS,
      gradeFor: (side, screenY) => gradeFromHandleDrag(vp, rs, side, screenY),
    };
  },
  {
    onGrade: (grade) => {
      state.grade = Math.max(-MAX_GRADE, Math.min(MAX_GRADE, grade));
      paintChrome();
      paintCanvases();
    },
    onHoverChange: (over) => {
      roadCanvas.style.cursor = over ? "ns-resize" : "";
    },
    onDragState: (side) => {
      state.gradeDrag = side;
    },
  },
);

/** Read the road canvas viewport without clearing it. */
function peekRoadViewport(): Viewport | null {
  const rect = roadCanvas.getBoundingClientRect();
  const ctx = roadCanvas.getContext("2d");
  if (!ctx || rect.width <= 0 || rect.height <= 0) return null;
  return {
    canvas: roadCanvas,
    ctx,
    width: Math.floor(rect.width),
    height: Math.floor(rect.height),
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  };
}

/** The state the road band is currently drawn with, shared with hit testing. */
function roadStateFor(road: Road, track: RollTrack): RoadState {
  return {
    road,
    track,
    centred: displayCentred,
    travelled: state.travelled,
    rolling: true,
    interference: state.solved?.interference ?? 0,
    wheelbase: state.wheelbasePeriods * road.period,
    grade: state.grade,
    showGradeHandles: true,
  };
}

drawBtn.addEventListener("click", () => setDrawingMode(!state.drawingMode));

stopBtn.addEventListener("click", () => {
  state.paused = !state.paused;
  render();
});

speedInput.addEventListener("input", () => {
  state.speed = Number(speedInput.value);
  speedValue.textContent = state.speed.toFixed(2);
});

wheelbaseInput.addEventListener("input", () => {
  state.wheelbasePeriods = Number(wheelbaseInput.value);
  paintChrome();
  paintCanvases();
});

soundBtn.addEventListener("click", () => {
  // Created inside the click, because an AudioContext made outside a gesture starts
  // suspended and never produces sound.
  if (!state.soundOn) {
    if (!spinVoice) spinVoice = createSpinVoice();
    if (!spinVoice) {
      stampStatus.textContent = "This browser has no audio support";
      setTimeout(() => {
        stampStatus.textContent = "Sheet 1 of 1";
      }, 2600);
      return;
    }
    spinTrigger.reset();
    state.soundOn = true;
  } else {
    state.soundOn = false;
  }
  paintChrome();
});

shareBtn.addEventListener("click", async () => {
  const url = currentShareUrl(window.location.hash || "");
  try {
    await navigator.clipboard.writeText(url);
    stampStatus.textContent = "Link copied";
  } catch {
    stampStatus.textContent = "Copy failed, the link is in the address bar";
  }
  setTimeout(() => {
    stampStatus.textContent = "Sheet 1 of 1";
  }, 2600);
});

pngBtn.addEventListener("click", () => {
  downloadCanvas("roadwright-sheet.png", roadCanvas);
});

svgBtn.addEventListener("click", () => {
  const s = state.solved;
  if (!s) return;
  const svg = buildCutSvg(s.centred, s.road, s.rMax, {
    ...DEFAULT_CUT,
    interference: s.interference,
  });
  downloadText("roadwright-cut.svg", svg, "image/svg+xml");
  stampStatus.textContent = "Cut file saved, millimetres";
  setTimeout(() => {
    stampStatus.textContent = "Sheet 1 of 1";
  }, 2600);
});

videoBtn.addEventListener("click", () => {
  if (state.recording || !state.solved) return;
  // One full period is exactly one seamless loop.
  const periodSeconds = state.solved.road.period / Math.max(state.speed * state.solved.rMax * 1.6, 0.001);
  const durationMs = Math.min(Math.max(periodSeconds * 1000, 1200), 12000);

  const wasPaused = state.paused;
  state.paused = false;
  state.recording = true;
  videoBtn.disabled = true;
  stampStatus.textContent = "Recording loop";

  const stop = recordLoop(roadCanvas, durationMs, (ok) => {
    state.recording = false;
    state.paused = wasPaused;
    videoBtn.disabled = false;
    stampStatus.textContent = ok ? "Loop saved" : "This browser cannot record canvas";
    setTimeout(() => {
      stampStatus.textContent = "Sheet 1 of 1";
    }, 2600);
  });
  if (!stop) {
    state.recording = false;
    state.paused = wasPaused;
    videoBtn.disabled = false;
  }
});

reducedMotion.addEventListener("change", () => {
  state.paused = reducedMotion.matches;
  render();
});

let resizeQueued = false;
window.addEventListener("resize", () => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    render();
  });
});

/** Restore from the fragment, falling back to the square rather than failing. */
function applyFragment(): void {
  const parsed = parseFragment(window.location.hash);

  if (parsed.kind === "preset" && presetById(parsed.id)) {
    loadPreset(parsed.id);
    return;
  }

  if (parsed.kind === "outline") {
    const box = boundingBox(parsed.shape.outline);
    const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
    if (span > 0) {
      state.sourceId = null;
      state.travelled = 0;
      solve(parsed.shape.outline, parsed.shape.hub ?? undefined);
      // A hub from a link may fall outside a zone computed here, so retry without it
      // rather than showing a refusal for a shape that is actually fine.
      if (!state.solved) solve(parsed.shape.outline);
      render();
      return;
    }
  }

  loadPreset("square");
}

function boot(): void {
  buildFormButtons();
  speedValue.textContent = state.speed.toFixed(2);
  state.wheelbasePeriods = Number(wheelbaseInput.value);
  applyFragment();

  // A hash-only change is a same-document navigation, so the module never re-runs.
  // Without this, pasting a shared link into an open tab does nothing, and so do the
  // back and forward buttons.
  window.addEventListener("hashchange", () => {
    if (state.drawingMode) setDrawingMode(false);
    applyFragment();
  });

  render();
  requestAnimationFrame(frame);
}

boot();
