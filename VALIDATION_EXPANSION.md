# Playwright validation suite — expansion report

Branch `feature/playwright-validation-expansion`. Four new, non-redundant L2 layers
on top of the #73/#76 setup. Prior hunts saturated general bug-finding (0 product
bugs); these close NAMED gaps those passes couldn't reach.

> **CANVAS WALL.** All four layers are DOM / menu / screen / viewport. **None test
> in-scene gameplay, visuals, or feel** — a Three.js `<canvas>` is opaque to the
> DOM. The visual baselines even MASK the canvas so they compare only the overlay.
> In-scene correctness remains L1's job; final gameplay sign-off is Craig's playtest.

## TL;DR

- **Product bugs found: 0.** **Safe fixes applied: 0** (so no fix commit). Every new
  layer is green. The pre-existing `THREE.Clock` deprecation **warning** (#75/#76,
  `CarPreview.ts`) still stands — out of scope here, still REPORTED.
- One **test-only** product change: a DEV-gated `?screen=` hook (main.ts), stripped
  from production (`import.meta.env.DEV`), confirmed absent from `dist/`.
- Each phase is its own commit (separable). **Phase 1 (visual) is the flake-prone /
  bootstrap-needing phase** — split it out if CI friction appears (details below).

---

## Phase 1 — visual regression baselines (`e2e/visual.spec.ts`)

Screenshots every non-canvas screen: start, car picker (×2 cars), missions,
settings, scores, daily, pause, WIPEOUT (reached via the seed-21 deterministic
crash from #76). **The `<canvas>` is MASKED**, so each baseline compares only the
DOM overlay — removing WebGL/GPU/per-frame variance and isolating DOM layout/color
regressions (the floating-DAILY / cyan-on-cyan class). `maxDiffPixelRatio: 0.1`.
The machine-independent checks (screen visible, zero console errors) stay
load-bearing; the pixel baseline is the secondary catch.

- **Found:** nothing — all screens render stable.
- **⚠️ Operational notes (why this is the split candidate):**
  1. **Per-OS baselines.** Generate on the **Linux CI runner**, not locally. The
     first e2e run writes `*-linux.png` and FAILS (expected); commit those, green
     after. Dev (`*-darwin.png`) baselines are **gitignored** (`e2e/**/*-darwin.png`)
     so they never become the source of truth. Author locally with
     `npx playwright test visual.spec.ts --update-snapshots`.
  2. **Flake under parallel cold-start.** See the flake analysis below — screenshot
     specs are the most sensitive. Mitigated by serializing CI (`workers: 1`).

## Phase 2 — `?screen=` hook + post-run screens (`src/main.ts`, `e2e/screens.spec.ts`)

#76 flagged the WIPEOUT placement / chase-target / daily-result / unlock variants
as unreachable (they need specific run outcomes). Added a **DEV-ONLY** render-layer
hook: `?screen=<fixture>` boots straight into a crash-screen state with injected
data via `shell.showCrash` (pure presentation — no store writes).

- **Dev-only & safe:** gated by `import.meta.env.DEV`, so the production
  `vite build` dead-code-eliminates it — **confirmed:** `grep` of `dist/` for the
  fixture names returns nothing. Render-layer only; **no `src/game/` change**.
- **Asserted (all render correct, visible, labelled, no invisible text):**
  `NEW #3!` + `just 1,200 from #2`, `NEW BEST!`, `BEST IN NOVA`, the
  `UNLOCKED: Nova` + 3 mission/rank lines, and the daily-result card
  (`DAILY BEST!` + `today …`).
- **Found:** no defects.

## Phase 3 — interaction flows (`e2e/flows.spec.ts`)

Tests inter-screen WIRING via DOM/localStorage signals (HUD `.hud-lives` is
slalom-only; `.hud-combo` is `x1.0` classic vs `CLEAN x` slalom).

- classic crash → PLAY AGAIN restarts **clean** (live score back near 0, not the
  carried-over crash score; classic mode);
- classic vs daily PLAY launch the **correct mode**;
- daily crash → PLAY AGAIN **stays daily** (not classic) — the real `replay()`
  wiring **[slow ~16s: waits on a real slalom crash]**;
- car selection **persists** to `localStorage` + survives reopening the picker
  (unlocks all cars via `addInitScript`);
- sound toggle **persists** + survives a reload;
- menu round-trips through every panel without sticking; PLAY still works after;
- Esc pause → Esc resume continues the **same** run (distance keeps climbing).
- **Found:** all wiring intact — no defects.

## Phase 4 — responsive / a11y (`e2e/responsive.spec.ts`)

Viewport sweep (360×640, 414×896, 768×1024, 1440×900) for start menu + car picker:
no horizontal overflow, PLAY CTA + title on-screen, canvas fills the viewport,
picker arrows/DONE reachable. A11y: buttons have accessible names, interactive
elements keyboard-focusable, the icon-only pause button exposes a name
(`aria-label="pause"`), invisible-text scan as the obvious-contrast catch. Not a
full WCAG audit.

- **Found:** no layout breakage or a11y gaps at any tested size.

---

## Flake analysis (honest)

Across **3 full parallel runs**: run 1 flaked (the `smoke` + `visual` screenshot
specs), runs 2–3 were fully green (36/36). Each phase passes reliably **serially**
(`--workers=1`). Root cause: the whole suite shares ONE Vite **dev** server; on a
cold start ~5 parallel workers contend on its first-request lazy compile, and the
screenshot specs are the most timing-sensitive. **Mitigation:** `workers: 1` on CI
(this is a gated/nightly job — reliability over wall-time); devs keep parallel
locally and can just re-run a flaky screenshot.

**Split recommendation:** if the screenshot bootstrap (Phase 1) causes CI friction
— the Linux-baseline first-run-fail dance plus screenshot sensitivity — split
`visual.spec.ts` (+ its baselines) into its own PR. Phases 2–4 are plain DOM/state
assertions with no baseline dependency and are the most robust.

---

## Coverage statement (what these do / do NOT cover)

These four cover **DOM / screen / viewport / inter-screen wiring** — menu chrome,
screen states, persistence, responsiveness, basic a11y. They do **NOT** cover
in-scene gameplay, rendering correctness, physics, or feel (the canvas wall).
That remains L1's domain (the fuzz suites) and Craig's manual playtest.

## Confirmations

- **Purity:** no `three`/DOM imports under `src/game/`; the `?screen=` hook is
  render/dev-only and absent from the production bundle.
- **#73 determinism meta-test:** passes.
- **Full suite:** vitest **337** ✅; `npm run build` ✅; `npm run lint` ✅;
  `npm run e2e` **36** ✅ (serial and 2/3 parallel runs; see flake analysis).
