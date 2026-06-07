# Automated bug hunt — report

Branch `chore/automated-bug-hunt`, run against `main`.

> **This is the second pass.** The first hunt (#75) is already merged into `main`,
> and **no product code has landed since** (#75 added only the L1 fuzz harness, the
> L2 menu spec, and this report; the last gameplay change was #74, already covered).
> So rather than replay the same checks, this pass goes **deeper**: a new L1 bug
> class (monotonicity / latching), and the L2 screens the first pass flagged as
> unreachable (crash/WIPEOUT + populated leaderboard).

## TL;DR

- **New bugs found: 0.** The pure core held every invariant in the deeper pass, and
  the previously-unreached DOM screens (WIPEOUT, populated leaderboard) are legible,
  labelled, and free of the invisible-text bug class.
- **Standing finding: 1** — `BUG-01` (THREE.Clock deprecation **warning**), unchanged
  from #75, still **REPORTED** (a Clock→Timer migration is behavior-adjacent and
  canvas-invisible to verify).
- **Safe fixes applied: 0** → **no fix commit** (nothing met the trivial +
  behavior-preserving + test-provable bar; inventing a fix would break the rules).
- New test scaffolding is committed separately. Purity intact; #73 determinism
  meta-test passes; full suite (337) green.

---

## What each layer ACTUALLY exercised (and the canvas wall)

**No in-scene gameplay, visuals, or feel was tested.** A Three.js `<canvas>` is one
opaque rectangle to the DOM — Playwright cannot see or steer inside it. Even the new
crash test only *starts* a run and waits for the car to drive itself into a seeded
obstacle; it never observes the scene, only the resulting DOM. In-scene correctness
comes only from the L1 state assertions.

| Layer | Exercised | Could NOT exercise |
|---|---|---|
| **L1 sim-fuzz** | real `update()` state — scoring, combo, slalom, lives, slow-mo, pools, RNG, phase machine, milestones, biome, objectives — across many seeds/modes/scripts; now also step-over-step monotonicity & latching | rendering, audio, anything visual/felt |
| **L2 DOM/menu/crash** | shell overlay: every screen incl. WIPEOUT + a populated leaderboard; button presence/visibility/labels; invisible-text scan; nav; toggles; pause; PLAY AGAIN | anything drawn in the canvas, "feel" |
| **L2 smoke/console** | boot, canvas non-blank, zero console errors, keyboard-to-canvas | whether the rendered scene is *correct* |

**Remaining coverage gaps (honest):** the daily run-result screen and the crash
screen's *placement/unlock/mission* lines (which only appear with specific run
outcomes) are still untested; reaching them reliably would want a render-layer
`?screen=` hook. **Final gameplay sign-off is still Craig's playtest.**

---

## L1 — sim-fuzzing

### Round 1 (existing, `fuzz_invariants.test.ts`, 15 tests) — clean
Numeric integrity (no NaN/Inf/negative), bounds (combo/lives/charges/cleanMult/
speed), bounded pools, road-clamped lateral, mode-leak (classic↔slalom), and
determinism — all held across 30 seeds × 2 modes × 4 scripts + stress.

### Round 2 (NEW, `fuzz_monotonic.test.ts`, 5 tests) — clean
A different bug class — properties that must hold **step-over-step** across long
runs (2500–5000 steps × 8 seeds × 2 modes × 2 scripts):

- **Monotonic non-decreasing:** `distance`, `time`, `score`, `peakCombo`,
  `nearMisses`, `slalomScore`, `gatesThreaded`, `milestones.nextIndex`, and the
  spawn/cull/collect telemetry counters — none ever moved backwards.
- **Monotonic non-increasing:** `lives` only ever drops; and in **classic** `lives`
  is fully **inert** (always == start — the slalom-only mechanic never touches it).
- **Instantaneous:** `peakCombo >= combo` always, and `peakCombo` exactly tracks the
  running max of `combo`.
- **Latching:** a completed objective never un-completes; objective progress never
  decreases; `nextIndex` never exceeds the milestone table length (no re-fire).
- **Range:** biome `from`/`to`/`blend` stay in range; slalom pins `speed` to the
  constant on every playing step.

**Findings: none.** Every monotonic/latching property held.

---

## L2 — DOM / menu / crash

### Round 1 (existing, `menu.spec.ts`, 5 tests) — clean
Start menu, car picker (all 7), daily, missions, scores, settings, pause — all
reachable, headed, labelled; **invisible-text (cyan-on-cyan) scan clean on every
screen**; toggles flip; picker data populates. (Refactored to share helpers with
the new crash spec via `e2e/_helpers.ts`.)

### Round 2 (NEW, `crash.spec.ts`, 2 tests) — clean — closes the prior gap
The first pass couldn't reach the crash screen (canvas wall). This pass uses
**seed 21**, whose straight no-input run crashes at ~177 sim steps (~3s, verified
headlessly), so the car drives itself into the seeded obstacle and the WIPEOUT
overlay appears — no product hook needed.

- WIPEOUT screen: title reads "WIPEOUT", score + best lines non-empty, PLAY AGAIN /
  MENU / SHARE present + labelled, **no invisible text**.
- **Populated leaderboard:** after the run, SCORES shows a real row with a non-empty
  score, **no invisible text** (the first pass only saw the empty "NO RUNS YET").
- **PLAY AGAIN** restarts a run (overlay hides, `body.playing` set, pause button up).

**Findings: no product defects.**

---

## L2 — smoke / console (Phase 3)

Zero uncaught exceptions and **zero console errors** across boot + the full menu
tour + a real crash → menu → scores + PLAY AGAIN + keyboard-to-canvas.

### 🐛 BUG-01 — `THREE.Clock` deprecation warning on every boot — **REPORTED** (low, unchanged from #75)
- **What:** console logs `THREE.Clock: This module has been deprecated. Please use
  THREE.Timer instead.` on every load (a **warning**, not an error — smoke stays green).
- **Where:** `src/rendering/CarPreview.ts:23` (`new THREE.Clock()`) and `:56`
  (`this.clock.getDelta()`) — the car-picker preview spin.
- **Why still REPORTED, not fixed:** `Clock`→`Timer` is not a drop-in (`Timer` needs
  a per-frame `update()` before `getDelta()`; a naive swap stops the spin). It's a
  render-loop/timing change whose effect lives inside the canvas, unverifiable by
  Playwright — fails the behavior-preserving + provable-by-test bar.
- **Severity:** low (cosmetic console noise; no functional impact).

---

## Concrete observations (grounded — things hit while exploring)

1. **A straight run is highly survivable-then-fatal at a fixed point per seed.** For
   several seeds (21, 33, 777, 2024) a no-input run crashes at *exactly* 177 steps —
   the seeded opening obstacle sits dead in the lane. Not a bug (and not a feel
   judgement — I can't see the scene), just a determinism fact that made the crash
   test possible. Other seeds survive 10–18s straight before traffic gets them.
2. **`.shell-title` is shared by the start ("NEON DRIFT") and crash ("WIPEOUT")
   screens** — 2 matches in the DOM at once; automation must scope it (both specs do).
3. **Vite dev cold-start dominates L2 wall-time** (the car-picker tour approaches
   ~60s under parallel workers). Bumped the Playwright per-test timeout to 90s so
   the gated/nightly e2e job won't flake; a prebuilt `vite preview` would be faster
   but couples the e2e job to a build step.

---

## Confirmations

- **Purity:** no `three`/DOM imports under `src/game/` (incl. both fuzz tests).
- **Determinism meta-test (#73):** passes.
- **Full suite:** 337 tests pass; `npm run build` ✅; `npm run lint` ✅; `npm run e2e`
  → 9 passed.
