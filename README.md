# Roadwright

**Draw a shape. See the road it rolls on.**

[![CI](https://github.com/BaselAshraf81/roadwright/actions/workflows/ci.yml/badge.svg)](https://github.com/BaselAshraf81/roadwright/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Runtime dependencies: 0](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen.svg)](package.json)
[![Bundle: 18 kB gzipped](https://img.shields.io/badge/bundle-18%20kB%20gzipped-brightgreen.svg)](#running-it)

**[Try it](https://baselashraf.com/roadwright/)**

A square wheel rolls perfectly smoothly, if you build the right road for it. That
road is a row of upside-down hanging chains, and Stan Wagon built a bicycle on one in
1997. Roadwright does the same thing for any shape you draw.

You draw. It solves the road. The axle stays dead level while something ridiculous
tumbles underneath it.

## Why the road, and not the wheel

Every version of this that already exists is frozen. A square wheel and its one
catenary road, in a museum case, in a 1992 issue of *Mathematics Magazine*, or in a
demo with eight canned examples. Nobody lets you draw your own and get the road back.

The road under your particular squiggle has never existed. You cannot photograph it
or download it, because it is a consequence of a shape only you drew.

## How it works

Describe the wheel by its reach: `r(θ)`, the distance from the axle out to the edge,
at every angle.

For the axle to ride level, the ground has to sit exactly as far below the axle as
the edge is from the centre at the point of contact. So the road height is
`y = −r`. Rolling without sliding means the road advances by the same arc the wheel
turns through, which gives `dx = r dθ`. Together:

```
x(θ) = ∫ r dθ          y(θ) = −r(θ)
```

And backwards, road to wheel:

```
θ(x) = ∫ dx / (−y)     r(θ) = −y(x(θ))
```

Two integrals. No solver, nothing to converge, no tolerance to defend. That is why
the road can be rebuilt while you are still dragging the axle.

## What is checked, not claimed

Every item runs as a test on every commit.

| Claim | How it is checked |
| --- | --- |
| A square gives inverted catenaries | Against `y = −a·cosh(x/a)`, to better than 1 part in 10⁶ |
| A circle gives a flat road | Flat to 5×10⁻⁶ at 2048 segments |
| Rolling means rolling | Road arc length equals wheel perimeter |
| Both directions agree | Wheel → road → wheel round-trips |
| The wheel never slips | Contact angle read from the same integral as position |
| Shapes that cannot be built are caught | Measured interference, calibrated on the triangle |
| A whole-number wheelbase syncs the wheels | Follows from the closure condition |

One result worth stating because it caught me out: **the road's horizontal period is
not the wheel's perimeter.** For a square of half-side `a` the road runs
`8a·ln(1+√2) ≈ 7.0509a`, while the perimeter is `8a`. The road's *arc length* is what
matches the perimeter. Only a circle makes the two agree.

## What it will not pretend

**Most drawings cannot roll as drawn.** A wheel only works if a ray from the axle
meets the outline exactly once in every direction. Any crevice between two limbs
breaks that, which rules out most doodles. Rather than refusing them, Roadwright
bridges the pockets the axle cannot see into and shows you the original as a dashed
line, so the change is visible instead of silent.

**A shape can be valid on paper and impossible in wood.** Sharp corners drive into
the road as the wheel turns. Roadwright measures how far, as a percentage of the axle
height, and says so:

| Shape | Drives into its own road by |
| --- | --- |
| Circle, square | 0% |
| Rounded rectangle | 0.01% |
| Pentagon | 0.18% |
| Equilateral triangle | 4.7%, jams |
| Five-pointed star | 21.5%, jams |

The triangle is the known case: a rolling equilateral triangle cannot be built
because its corners bind in the ruts. Notice that rut depth alone cannot predict
this. A rounded rectangle has deeper dips than a triangle and rolls perfectly. What
jams a wheel is corner sharpness, so interference is measured directly rather than
inferred from depth.

**Tilting the road is exact.** The derivation never mentions gravity. It only asks
that the axle travel along a straight line, and nothing requires that line to be
horizontal, so grade costs no accuracy at all.

## What you can do with it

- Draw a shape, or pick one of seven.
- Drag the axle inside the shaded area to change the road. Deep dips or shallow ones
  are yours to choose.
- Tilt the road by dragging either end of the axle line. Grade reads out as a
  percentage, the way a road drawing states it.
- Set the wheelbase in road lengths. Land on a whole number and both wheels turn
  alike; anything else and they run out of step, which the index ticks show.
- Turn on the spin whistle. Pitch follows the measured angular velocity, so a wheel
  whipping round a tight corner genuinely sounds sharper. A circle never whistles.
- Save the loop as a video, the sheet as a PNG, or the wheel and road as an SVG cut
  file in millimetres with the interference warning written into the file.
- Share a link. The shape travels in the URL fragment, which browsers never send to a
  server, so what you drew stays between you and whoever you send it to.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173/roadwright/
npm test           # 79 tests
npm run typecheck
npm run build      # about 18 kB gzipped
```

No backend, no accounts, no database, and nothing to install for a visitor. The
shipped bundle has zero runtime dependencies.

## Layout

```
index.html        One page. Shell, controls, and the notes below the drawing.
styles/           The drafting sheet.
src/core/         Pure geometry. No DOM, which is what makes the claims testable.
  quadrature.ts     Cumulative integration, used by both directions.
  wheel.ts          Outline plus axle to r(θ).
  road.ts           r(θ) to road, road to r(θ), interference, roll tracking.
  kernel.ts         Where the axle is allowed to sit.
  rollable.ts       Bridging a drawing that cannot roll as drawn.
  validate.ts       The single home for validity, with reasons a person can read.
src/render/       Canvas drawing. Reads geometry, never computes it.
src/ui/           Drawing, axle dragging, road tilting.
src/audio/        The spin whistle.
src/export/       SVG cut file, PNG, video.
tests/            The proofs above.
```

`src/core/` never touches the DOM. That is deliberate: it runs under a plain test
runner, which is the only reason the accuracy claims in this README can be checked
rather than asserted.

## Sources

- Leon Hall and Stan Wagon, *Roads and Wheels*, **Mathematics Magazine 65** (1992).
  [JSTOR](https://www.jstor.org/stable/2690665)
- G. B. Robison derived the general road-and-wheel equations in 1960.
- Stan Wagon and Loren Kellen built a
  [square-wheeled bicycle](https://www.macalester.edu/mscs/multimedia/squarewheeledbike/squarewheelbike/)
  at Macalester College in 1997.
- The [National Museum of Mathematics](https://momath.org/sqwt/) and the
  Exploratorium both exhibit a square-wheeled tricycle.
- [Roulette (curve)](https://en.wikipedia.org/wiki/Roulette_(curve)) on Wikipedia,
  for the wider family these curves belong to.

## Also by me

- [Eigendrum](https://eigendrum.com), draw a shape and hear the sound it would
  actually make, solved with finite elements in the browser.
- [More work](https://baselashraf.com)

## Licence

MIT. See [LICENSE](LICENSE).
