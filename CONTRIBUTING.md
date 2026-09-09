# Working on Roadwright

## Commands

```bash
npm install
npm run dev        # dev server on the /roadwright/ base path
npm test           # unit tests
npm run typecheck  # tsc --noEmit, strict
npm run build      # production bundle
```

## The one rule that matters

**`src/core/` stays pure.** No DOM, no canvas, no `window`. It runs under a plain
test runner, and that is the only reason the accuracy claims in the README can be
verified instead of asserted. Geometry lives in `core/`; `render/` draws what `core/`
returns and never computes a road itself.

Validity has exactly one home, `core/validate.ts`. Every entry path goes through it.
A second validity check somewhere else is how a product ends up giving contradictory
answers for the same shape.

## Traps that have already bitten

These are all real, all found the hard way, and all now covered by tests.

- **Arc length is not the same as angle.** The road's horizontal period is
  `∫ r dθ`, which for a square of half-side `a` is `8a·ln(1+√2)`, not the perimeter
  `8a`. The road's *arc length* is what equals the perimeter. Only a circle makes the
  two agree.
- **Rays hit vertices constantly.** The suggested axle sits collinear with the
  outline's own vertices, so exact vertex hits happen on ordinary shapes. A half-open
  edge parameter does not survive floating point: both adjoining edges can drop the
  same crossing and the axle then appears to see nothing. `wheel.ts` lets both report
  and merges hits by distance.
- **Check for a crossing outline before checking area.** A bowtie encloses zero
  signed area, so an area-first order refuses it as "no area", which is true and
  useless.
- **Never fit a camera to live input.** Refitting the detail view to a stroke while it
  is being drawn remaps every later point through a different coordinate system, which
  silently corrupts the capture and then fails with the wrong error.
- **Rut depth does not predict jamming.** A rounded rectangle has deeper dips than an
  equilateral triangle and rolls perfectly. Corner sharpness is what binds, so
  interference is measured by sweeping the wheel through a full period.
- **Derive construction geometry, never guess it.** The crescent preset broke twice
  from hand-picked arc endpoints and a sweep taken the wrong way round.
- **Animate `transform`, not `width`.** Animating layout properties thrashes layout
  every frame.

## Before opening a pull request

Run all three:

```bash
npm run typecheck && npm test && npm run build
```

If you change anything in `src/core/`, the accuracy tests are the acceptance
criteria. **Do not relax a tolerance to make a change pass.** If a square stops
producing `y = −a·cosh(x/a)`, the change is wrong, whatever the animation looks like.

## House style

- No em dashes anywhere, including in commit messages. Use a comma, a colon, or a
  spaced hyphen.
- Numbers rather than adjectives. If a claim has a figure, use the figure.
- Visitor-facing copy says "axle", not "hub", and avoids naming the mathematics.
  Nobody agreed to learn the jargon to use a toy.
- Label every claim as measured or assumed. Never imply exactness that is not there.
