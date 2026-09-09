/**
 * The four functional ink roles, plus neutral sheet furniture.
 *
 * This is not a palette in the decorative sense. Colour states authorship, which is
 * how the honesty boundary is carried without a disclaimer:
 *
 *   INK    the road, meaning everything the solver computed
 *   OXIDE  the outline, meaning everything the visitor drew
 *   SLATE  the datum, and nothing else, ever
 *   GRAPHITE  neutral drawing-sheet furniture: rules, ticks, labels, hatching
 *
 * Nothing decorative may borrow INK, OXIDE, or SLATE. A visitor who learns that
 * blue means "the line that never moves" must never see blue used for a button.
 *
 * Kept in sync with styles/sheet.css by hand. There are four values; a build step
 * to share them would cost more than it saves.
 */

export const INK = {
  /** Computed road. */
  road: "#1A1F23",
  /** The visitor's own outline. */
  outline: "#A8342A",
  /** The datum line. Reserved. */
  datum: "#2E5C8A",
  /**
   * Rules, ticks, lettering, hatching.
   *
   * 4.71:1 on the vellum ground and 5.18:1 on the band, both clearing AA. The
   * earlier #6E7168 measured 3.5:1 and failed.
   */
  graphite: "#5A5D55",
  /** Sheet ground. A cool drafting vellum, deliberately not a warm cream. */
  vellum: "#D8D9CE",
  /** Band ground, one step lighter than the sheet. */
  band: "#E2E3D9",
} as const;

/** Line weights in CSS pixels, before device pixel ratio scaling. */
export const WEIGHT = {
  hair: 0.5,
  thin: 1,
  medium: 1.5,
  heavy: 2.25,
} as const;

export const FONT_STACK =
  '"Bahnschrift", "Bahnschrift SemiCondensed", "DIN Alternate", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif';

/** Canvas font shorthand at a given pixel size. */
export const sheetFont = (px: number, weight = 500): string =>
  `${weight} ${px}px ${FONT_STACK}`;

/**
 * Interference thresholds, set from measurement.
 *
 * `interference` is the worst distance the wheel drives into its own road, as a
 * fraction of the axle height. Measured across the built-in forms:
 *
 *   circle            0.00000
 *   square            0.00000
 *   rounded rectangle 0.00014
 *   pentagon          0.00184
 *   equilateral tri   0.04665   cannot be built
 *   star              0.21545   cannot be built
 *
 * The two shapes that genuinely bind are separated from the four that do not by
 * more than an order of magnitude, so these thresholds are calibrated against
 * geometry rather than against an anecdote.
 *
 * This replaced a rut-depth proxy, which lied in both directions: a rounded
 * rectangle has rut depth 0.414 and rolls perfectly, while an equilateral triangle
 * at 0.500 binds. What jams a wheel is corner sharpness, not rut depth.
 */
export const BIND = {
  /** Below this the wheel rides clear and a cut pair will roll. */
  clear: 0.005,
  /** At or above this the wheel collides with its own road. */
  binds: 0.02,
} as const;

export type BindVerdict = "clear" | "marginal" | "binds";

export function bindVerdict(interference: number): BindVerdict {
  if (interference < BIND.clear) return "clear";
  if (interference < BIND.binds) return "marginal";
  return "binds";
}
