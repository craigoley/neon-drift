# Automated bug hunt — report

Branch `chore/automated-bug-hunt`. Three layers run against `main` (post #74):
1. **L1 headless sim-fuzzing** — the pure core (`src/game/`), `fuzz_invariants.test.ts`.
2. **L2 Playwright DOM/menu** — the shell UI outside the canvas, `e2e/menu.spec.ts`.
3. **L2 Playwright smoke/console** — boot health, `e2e/smoke.spec.ts` (pre-existing, #73).

## TL;DR

- **Bugs found: 1**, all severity **low**, all **REPORTED** (none met the safe-to-fix bar).
- **Safe fixes applied: 0.** The pure core held every invariant I threw at it, and
  no DOM screen showed an invisible-text / unlabelled-button / dead-control defect.
  There is therefore **no fix commit** — inventing one would violate the "a wrong
  fix is worse than a reported bug" rule.
- New test scaffolding is committed separately (the harness, not fixes).
- Purity preserved (no `three`/DOM under `src/game/`); the #73 determinism
  meta-test and the full suite (332 tests) pass.

---

## What each layer ACTUALLY exercised (and the canvas wall)

**Be precise: no in-scene gameplay, visuals, or "feel" was tested.** A Three.js
`<canvas>` is one opaque rectangle to the DOM — Playwright cannot see or drive
what happens inside it. In-scene correctness comes only from the L1 state
assertions below, never from the browser.

| Layer | Exercised | Could NOT exercise |
|---|---|---|
| **L1 sim-fuzz** | The real `update()` loop's state: scoring, combo, slalom, lives, slow-mo bank/strength, pools, RNG, phase machine — 30 seeds × 2 modes × 4 input scripts + stress | Rendering, audio, anything visual/felt |
| **L2 DOM/menu** | Shell overlay: every menu screen, button presence/visibility/labels, text legibility (cyan-on-cyan scan), nav transitions, settings toggles, car-picker data, pause/resume, HUD `body.playing` state | Anything drawn in the canvas (the car, road, gates, particles, HUD readouts that live in WebGL, "feel") |
| **L2 smoke/console** | Boot to first frame, canvas non-blank (PNG-size heuristic), zero console errors, keyboard-to-canvas doesn't throw | Whether the non-blank canvas shows the *correct* scene |

**Coverage gaps (honest):**
- The **crash/WIPEOUT screen**, **daily run-result**, and a **populated leaderboard**
  are only reachable *after an in-scene run ends*, which requires steering the car —
  impossible through the canvas wall. Their static DOM is built the same way as the
  tested screens, but their *dynamic* content (score lines, placement badges) is
  **untested by L2**. (The shell's jsdom unit test `shell.test.ts` covers some of
  this at L1.)
- **Final gameplay sign-off is still Craig's playtest.** Nothing here tells you the
  game *feels* good or looks right.

---

## L1 — sim-fuzzing (Phase 1)

`src/game/__tests__/fuzz_invariants.test.ts` — 15 tests, ~1s. Drives the real loop
headlessly and asserts invariants every 200 steps and at run-end.

**Invariants checked (all HELD):**
- **Numeric integrity:** `score`, `distance`, `time`, `combo`, `peakCombo`,
  `slalomScore`, `cleanMultiplier`, `slowMoCharges/Timer/TimeScale`, `lives`,
  vehicle `lateral/lateralVel/speed/boostTimer` — never NaN/Infinity; `score`,
  `distance`, `time`, `slalomScore` never negative.
- **Bounds:** combo ∈ [1,10], cleanMultiplier ∈ [1,8], lives ∈ [0,3], charges ∈
  [0, per-car cap], speed ∈ [0, maxSpeedCap+boostBonus].
- **State integrity:** phase always one of the 4 legal values; traffic/powerup pools
  never grow past their fixed sizes (24/8); `vehicle.lateral` stays within the road
  clamp (`roadCenter ± halfWidth`).
- **Mode integrity:** classic **never** mutates `slalomScore` (stays at fresh
  zero); slalom **never** builds the classic combo (gates fire no near-miss) — both
  held across every seed.
- **Determinism (extends #73):** 30 seeds × 2 modes, each run twice → identical
  `rng.getState()` (exact) + matching float fields. No non-determinism found.
- **Edge/stress (all clean):** 12k-step run; deploy-spam (every frame) across all 7
  cars with periodic re-banking — charges never go negative or exceed cap;
  steer-slam (±1 every frame) — lateral stays road-clamped & finite; three fast
  gate-wall misses end a slalom run at exactly `lives === 0`; a Crashed run is
  frozen (further `update()` calls don't advance state).

**Findings: none.** The pure core is robust on every property tested.

---

## L2 — DOM / menu (Phase 2)

`e2e/menu.spec.ts` — 5 tests. Boots with `?seed=123`, tours every reachable screen.

**Checked (all PASS):**
- **Start menu:** PLAY, CARS, DAILY, MISSIONS, SCORES, SETTINGS, SHARE all present,
  visible, labelled; title reads "NEON DRIFT"; best-run line non-empty.
- **Every screen reachable + returns to start:** car picker, daily, missions,
  scores, settings — each visible, correct heading, all buttons labelled.
- **Invisible-text (cyan-on-cyan) scan:** for every visible screen, no element has
  non-empty text whose computed color equals its own opaque background — the exact
  bug class from earlier in the project. **Clean on every screen tested.**
- **Car picker:** cycles all 7 cars; each populates name + 3 taglines (handling /
  scoring / slow-mo) + 3 stat bars (width set) + exactly one active page dot; all 7
  names distinct.
- **Settings:** sound and Retro FX toggles each flip their ON/OFF readout.
- **PLAY → run:** start overlay hides, `body.playing` set, pause button appears;
  pause → PAUSED screen (labelled, legible) → resume hides it.

**Findings: no product bugs.** One *test-authoring* gotcha (not a product defect),
see Observations.

---

## L2 — smoke / console / crash (Phase 3)

`e2e/smoke.spec.ts` (#73) + console tracking across all menu tests.

- **Zero uncaught exceptions, zero console *errors*** across boot + the full menu
  tour + play/pause + keyboard-to-canvas.
- Canvas boots non-blank; keyboard input to the focused canvas does not throw.

### 🐛 BUG-01 — `THREE.Clock` deprecation warning on every boot — **REPORTED** (low)

- **What:** the console logs `THREE.Clock: This module has been deprecated. Please
  use THREE.Timer instead.` on every page load (a **warning**, not an error — the
  smoke's zero-errors assertion stays green).
- **Where:** `src/rendering/CarPreview.ts:23` (`new THREE.Clock()`) and `:56`
  (`this.clock.getDelta()`), used to spin the car-picker 3D preview frame-rate-
  independently.
- **Why REPORTED, not fixed:** `Clock` → `Timer` is **not** a drop-in. `Timer`
  requires calling `timer.update()` once per frame before `getDelta()`; a naive swap
  would make `getDelta()` return 0 and the preview would stop spinning. It's a
  render-loop/timing change whose effect lives **inside the canvas**, which
  Playwright cannot verify — so it fails the behavior-preserving + provable-by-test
  bar. Needs a human eye on the preview after migrating.
- **Severity:** low (cosmetic console noise; no functional impact).
- **Repro:** load any page, watch the console. Deterministic.

---

## Concrete observations (grounded — things I hit, NOT design suggestions)

1. **`.shell-title` is shared by two screens.** Both the start title ("NEON DRIFT")
   and the crash title ("WIPEOUT", `.shell-title.shell-wipeout`) carry the bare
   `.shell-title` class and coexist in the DOM (crash hidden). Not a bug, but any
   selector/tooling targeting `.shell-title` matches **2** elements — my first test
   pass tripped on it (now scoped to `.shell-start .shell-title`). Flagged so future
   automation scopes it too.
2. **Crash/daily/leaderboard dynamic content is L2-unreachable.** As above — these
   screens only appear after an in-scene run, so their populated state never got
   browser coverage. If you want it, the cheapest path is a render-layer test hook
   (e.g. a `?screen=crash` debug param that calls `showCrash` with sample data),
   mirroring the existing `?seed=`/`__READY__` hooks.
3. **Vite dev cold-start makes the heavy menu test slow** (car-picker tour ~28s
   under parallel workers). I bumped the Playwright per-test timeout to 60s so the
   gated e2e job doesn't flake on first-request lazy compile. (Pre-building +
   `vite preview` would be faster but couples the e2e job to a build step.)

---

## Confirmations

- **Purity:** no `three`/DOM imports under `src/game/` (incl. the new fuzz test).
- **Determinism meta-test (#73):** passes.
- **Full suite:** 332 tests pass; `npm run build` ✅; `npm run lint` ✅; `npm run e2e`
  → 7 passed.
