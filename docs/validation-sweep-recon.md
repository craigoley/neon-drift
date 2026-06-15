# Neon Drift — Live-Validation / Bug-Hunt Sweep: RECON

> **Status: recon only.** This document is the evidence base for a Playwright **live-validation
> sweep** built around Neon Drift's *actual* flows, hooks, and *demonstrated* failure modes. The
> sweep itself (`e2e/validation.spec.ts`, the npm script, the workflow, and any minimal debug hook)
> is a **separate second PR** to be opened only after the flows + hooks below are confirmed.
>
> **PR only. Don't merge or build.**

---

## Why this sweep, for this game

Neon Drift is a Three.js/WebGL `<canvas>` game. Snapshot/baseline testing is only ~44.6% accurate
on `<canvas>` games because the canvas is an opaque pixel buffer DOM tools can't introspect
(arxiv 2208.02335). That is exactly why this game's recent bugs slipped the unit tests: **the unit
tests assert STATE (correctly), while the bug lived in the RENDERED RESULT, the ENCOUNTER, the
DISTRIBUTION, or a TRANSITION.** Every bug below passed unit tests and was only caught by human
playtest:

| Bug | What passed | What was actually wrong | Class |
|---|---|---|---|
| Landmark reward "fired, never rendered" (#125–128) | reward state/envelope | 1px unlit lines + effect mesh offscreen → state-correct, visually absent | render-coverage |
| Zen "void" (#122) | terrain/props generated | no floor/backdrop rendered | render-coverage |
| Secret-area warp "bounce" (#129/#130) | warp math | arrived facing the return portal + grid floor not re-coloured → looked normal | transition-state + render-coverage |
| Tunnels "never found" (#131–134) | generated at correct rate | a spatial-encounter property no existence test checked | encounter/spatial |
| Jump "inconsistency" (#138) | per-frame state flags | an outlier-tail variance only visible in the live distribution | distribution |

**The lesson the sweep embodies:** assert what actually **renders**, what **happens** over a live
run, and what stays **bounded/finite** — not just that state flags flipped. The recurring root
cause is *"state asserts pass, the screen / encounter / distribution / transition is wrong."*

---

## §0 — Headline finding: this is an EXTENSION, not a greenfield harness

**The repo already has a Playwright suite.** The sweep complements it; it must not reinvent it.

- `playwright.config.ts` — `testDir: ./e2e`, `baseURL: http://localhost:4173`, `webServer:
  npm run dev -- --port 4173 --strictPort`, per-test timeout 90 s, `workers: 1` in CI.
- `playwright.cross-engine.config.ts` — `testDir: ./e2e-cross-engine`, the V8-vs-JSC determinism
  meta-test (180 s, 1 worker) against `/probe.html` + `window.__determinismProbe`.
- `e2e/_helpers.ts` — **reusable**: `boot(page, seed?)` (goto `/?seed=…`, waits `__READY__`),
  `trackErrors(page)` (collects `console.error` + `pageerror`), `invisibleTextIn`,
  `assertButtonsLabelled`.
- Existing specs: `menu`, `screens`, `flows`, `crash`, `smoke`, `responsive`, **`visual`** (the
  baseline gate), `mp`, `gfx`.
- `@playwright/test@^1.61.0` is already a dev dep; Node `24.x` (engines + `.nvmrc`).

→ The validation sweep is **`e2e/validation.spec.ts`** reusing `_helpers.ts`, plus a dedicated
**`e2e:validation` script** and an **on-demand workflow** — the **live/soak layer** the existing
specs don't cover (console-clean over real interactions + a sustained unfrozen Zen soak with
finite/bounded/still-rendering canaries).

---

## §1 — Neon Drift's actual flows & selectors (the per-game adaptation)

All selectors are real (`src/ui/Shell.ts`, `src/zen/ZenSession.ts`, `src/rendering/HUD.ts`). The
menu is data-driven (`modeItems()`/`garageItems()`) but the `.shell-*` class on each tile is
stable. Routing is `Shell.go(screen)` toggling `display` on each screen div; **`body.playing`** is
the in-run flag (`Shell.ts:461`).

### Start menu (`.shell-start`)
| Control | Selector | Text | Handler |
|---|---|---|---|
| Play (primary) | `.shell-play` | `PLAY` | `onPlay()` → `startRun(Classic)` |
| Settings | `.shell-settings-open` | `⚙` | `go('settings')` |
| Share | `.shell-share` | `↗` | `doShare()` |
| **MODES** Daily | `.shell-daily-open` | `DAILY` | `go('daily')` |
| **MODES** VS Computer | `.shell-vscpu-open` | `VS COMPUTER` | `onVsComputer()` |
| **MODES** 2P Race | `.shell-mp-open` | `2P RACE` | `onMultiplayer()` |
| **MODES** Zen | `.shell-zen-open` | `ZEN` | `hideForExternal()` → `onZen()` |
| **GARAGE** Cars | `.shell-cars` | `CARS` | `go('carpicker')` |
| **GARAGE** Store | `.shell-store-open` | `STORE` | `go('store')` |
| **GARAGE** Missions | `.shell-missions-open` | `MISSIONS` | `go('missions')` |
| **GARAGE** Scores | `.shell-leaderboard-open` | `SCORES` | `go('leaderboard')` |

### Secondary screens (each a `.shell-*` container; close via `.shell-close*` = `DONE`/`CLOSE`)
- **Car picker** `.shell-carpicker`: `.shell-prev`/`.shell-next` (aria `previous/next car`),
  **`.shell-car-canvas`** (the 3D `CarPreview` mount), `[data-stat="speed|grip|agility"]`,
  `.shell-dot--on`.
- **Store** `.shell-store`: **`.shell-store-preview`** (live `CarPreview` mount),
  delegated buttons `.shell-store-buy[data-action="buy-car"|"buy-cosmetic"]` /
  `.shell-store-equip[data-action="equip"]` with `data-id`/`data-slot`; cosmetic rows
  `.shell-store-row[data-cos-slot][data-cos-id]` (hover/focus → preview).
- **Settings** `.shell-settings`: `.shell-toggle-sound|-fx|-cine|-ghost` (role=switch, value child
  shows `ON`/`OFF`, active class `.shell-toggle--on`).
- **Missions** `.shell-missions`, **Leaderboard** `.shell-leaderboard`, **Daily** `.shell-daily`
  (`.shell-play-daily`).
- **Crash/WIPEOUT** `.shell-crash`: `.shell-play-again`, `.shell-menu`, `.shell-share`.
- **Pause** `.shell-pause`: `.shell-resume`, `.shell-quit`; in-run button `.shell-pause-btn`.

### In-game HUD (`.hud`, gated by `body.playing`)
`.hud-stats` (`.hud-stat`, `.hud-combo`, `.hud-best`), `.hud-powerups` (`.hud-pup`), `.hud-objectives`,
`.hud-lives`/`.hud-life.lost` (slalom only — a mode discriminator), `.touch-slowmo` (`SLOW-MO`).

### Zen free-roam overlay (`.zen-overlay`) — the biggest surface, the bug epicentre
| Control | Selector / how created | Notes |
|---|---|---|
| Exit | `.zen-exit` (`EXIT`) | `onExit()` → disposes session (`main.ts:431`) |
| Gas (touch) | `makeHoldButton('GAS', …)` bottom-right | hold = throttle fwd; keyboard ↑/W |
| Brake (touch) | `makeHoldButton('BRAKE', …)` bottom-left | hold = throttle back; keyboard ↓/S |
| Minimap | `.zen-minimap` (ZenMinimap canvas) | top-right radar |
| Warp fade | `.zen-fader` | full-screen, opacity animated during warp |

### Transitions (the desync-prone seams)
`menu ⇄ race` (`onPlay`/`onMenu`, `go(null)`/`go('start')`, `body.playing` toggles); `menu → zen`
(`hideForExternal()`, `externalMode=true`, lazy-loads `ZenSession`, RAF calls `zen.tick()` instead
of the forward sim — `main.ts:644`); inside Zen: `cruise ⇄ secret-area warp ⇄ cruise` and
`cruise ⇄ tunnel`. Dev fixture hook **`/?screen={wipeout-rank|wipeout-best|…}`** (DEV only,
`main.ts:582`) jumps straight to post-run cards.

---

## §2 — Readiness & state hooks: what EXISTS vs the MINIMAL hook to ADD

### Already exposed (use these as-is)
- **`window.__READY__`** — `true` after the first real frame draws (`main.ts:91–99, 991`). The
  readiness gate; `_helpers.boot()` already awaits it.
- **`window.__determinismProbe(cfg)`** — pure-sim cross-engine checksums (`src/dev/determinismProbe.ts:64`).
  For the racing sim, not Zen.
- **`?seed=<u32>`** — pins the deterministic boot seed (`main.ts:106–129`). Zen world seed is fixed
  (`ZEN.worldSeed = 0x5a2e17`, `constants.ts`).
- **`?debug=1`** — toggles `DebugOverlay` (`src/rendering/DebugOverlay.ts`): FPS, frame time, pool
  counts, biome, effects — **rendered to DOM text only**, scrape-able but not queryable.
- **`/?screen=…`** — DEV-only post-run fixtures.

### NOT reachable from `page.evaluate` (all private/closure-scoped) — the gap
- Racing `GameState` (phase/mode/seed/distance/vehicle/effects) — closure in `main.ts:118`.
- **Zen live state** — `ZenSession` privates: `v` (ZenVehicle x/z/y/vy/airborne/heading/speed),
  `inSecret`, `warpPhase`, `guardActive`, `saved`; `ZenRenderer.secretActive`; biome held at
  render time.
- **Scene-graph / entity counts** — `ZenScenery.activePropCount`/`drawCallCount`,
  `ZenTerrain.vertexCount`, `ZenLandmarks.active.size` exist as getters but are private; raw
  Three.js mesh/material counts are opaque.
- **No frame counter** anywhere global (a `ghostFrame` local exists but isn't exposed).

### Proposed minimal hook (the one new thing the sweep needs) — for the **second PR**
A single **read-only, dev/test-gated** global, populated once per frame in the composition root
(`main.ts` `frame()`), only when `?debug=1` (or `import.meta.env.DEV`) — **not a new public API**:

```ts
// READ-ONLY snapshot for live validation. Populated only under ?debug=1. Mirrors existing state;
// adds no behaviour. Lives in the render/composition layer, never in pure src/game/.
window.__neonDebug = {
  mode: 'menu' | 'playing' | 'paused' | 'crashed' | 'zen',
  frame: number,                         // ticking counter → liveness canary
  // racing (when mode==='playing'):
  seed, distance, vehicle:{ lateral, speed },
  // zen (when mode==='zen'):
  zen?: {
    pos:{ x,y,z }, heading, speed, airborne,
    warpPhase, inSecret,
    biome:{ from, to, blend },
    counts:{ props, terrainVerts, landmarks, sceneChildren },  // bounded-growth canary
  },
};
```

Why each field is justified by a *demonstrated* bug: `frame` (stall canary), `zen.pos`/camera
finiteness (warp/tunnel far-coord NaN), `inSecret`+`warpPhase` (the #130 bounce/stuck desync),
`biome` (region-distinctness), `counts` (unbounded-growth/cull regressions). Keep it to mirroring —
no setters, no commands.

---

## §3 — The Zen-prioritised SOAK (designed around the demonstrated failure modes)

**Run:** boot with a fixed seed → enter Zen → drive a scripted route for a sustained stretch
(target ~60–120 s of wall-clock, advancing the real RAF loop): cruise across **multiple biomes**,
cross a **GATEWAY into the secret area and back**, descend **through a tunnel**, **catch air** off
crests. The soak asserts **objective** failures only (see §5), sampling `__neonDebug` every ~0.5 s
plus a continuous `console.error`/`pageerror` collector.

| "Broken" (from history) | Canary | Source | Assertion |
|---|---|---|---|
| **NaN / non-finite** position or camera (warp teleports to `regionX 640000, regionZ −480000`; tunnel surface-override + crest physics far from origin) | `isFinite(zen.pos.x/y/z)` every sample | `ZenSecret.ts` coords; `ZenVehicle.ts:79`; `ZenRenderer.ts:215` | all finite, always |
| **Unbounded growth** (chunks/props/landmarks/effect meshes not culled) | `zen.counts.{props,terrainVerts,landmarks,sceneChildren}` | `ZenScenery` (`≤ (2·4+1)²·4 = 324`), `ZenTerrain.vertexCount` (fixed), `ZenLandmarks.active` (tiny) | bounded over the whole soak — not monotonically climbing |
| **Heap leak** | CDP `Runtime.getHeapUsage` / `performance.memory` sampled across the soak | Playwright CDP session | trend bounded, not strictly rising |
| **Error storm / exception** in the loop | `trackErrors(page)` minus the §4 allowlist | `_helpers.ts` | empty |
| **Loop STALLS** (frame counter / canvas stops) | `__neonDebug.frame` strictly increases between samples; **fallback** `canvas.toDataURL()` differs over an interval (NOT `getImageData` — WebGL canvas is opaque) | `main.ts` RAF | advancing while speed>0 |
| **Warp desync** (`warpPhase` stuck, fade never completes) | `warpPhase` returns to `'none'` within a bound after a crossing | `ZenSession.advanceWarp` | no stuck `'out'`/`'in'` > ~2 s |
| **Secret-area desync** (#130) — `inSecret` stuck true after return; impossible `inSecret && saved===null` | `inSecret` toggles true→false across the round-trip; combo invariants hold | `ZenSession.doTeleport:233/236` | resets after return |
| **Secret looks normal** (#130) — grid floor not re-coloured | sample biome/secret palette flag while `inSecret` (state proxy for the render-coverage bug; a screenshot diff is the coarse fallback) | `ZenTerrain.setSecret`; `ZEN_SECRET_BIOME.gridLine` | distinct while in secret |
| **Transition wrong mode** | `__neonDebug.mode` matches the expected phase after each transition | composition root | consistent |

**Region-distinctness** (the "a distinct state actually looks distinct" prize): assert `biome.from`
changes across the drive (crossing seams) and, where the hook can't prove pixels, fall back to a
`toDataURL` diff between two biome positions. This is the highest-value *novel* assertion class and
is why the `__neonDebug` counts + biome fields matter.

---

## §4 — Expected-warning ALLOWLIST (so the sweep stays trustworthy)

A clean console = **no _unexpected_ errors/warnings.** `smoke.spec.ts` already asserts
`consoleErrors === []`, so benign sources must be explicitly allowlisted with a reason:

| Source | Pattern | Reason | Where |
|---|---|---|---|
| Multiplayer diagnostics | `[MP] connect failed @ …`, `[MP] DESYNC …` | expected during MP connect/NAT/desync; not a single-player-soak concern (allowlist if MP is exercised) | `src/net/connectionStatus.ts:67`, `MpRace.ts:297` |
| Vite chunk-size (build log, not runtime) | `Some chunks are larger than 500 kB` | advisory; main bundle = three.js + game. Build-time only | `npm run build` output |
| WebGL render-to-texture (cosmetic preview) | any three.js `readPixels`/feedback-loop/`WebGLRenderTarget` warning from the **`CarPreview`** RTT thumbnail (store/car-picker) | a known cosmetic-thumbnail render path; not gameplay. Allowlist by source if it surfaces | `src/rendering/CarPreview.ts`, `PostProcessing.ts` |

Everything else = a **finding**. Note: a clean *single-player* Zen boot is expected to log **zero**
console errors today (verify during the build PR; if any benign line appears, add it here with a
reason rather than widening the matcher).

---

## §5 — What this complements, and the hard boundary

**Complements (does NOT duplicate):** lint (`ci.yml` eslint), type-check + build (`ci.yml` tsc +
vite), unit/integration (`ci.yml` vitest, 619 tests), the existing Playwright **smoke/visual** specs
(`e2e.yml`), the **cross-engine determinism** meta-test, CodeQL/OSV security scans. Architectural
purity (`src/game/` imports no `three`; `src/zen/` imports no `src/game/`) and the
`SIM_MATH_VERSION` guard (`constants.ts:46`) are enforced by **code review + tsc + app-level
version stamping**, *not* a dedicated CI grep job — the sweep doesn't touch them.

**The hard boundary (state this so the sweep is never over-trusted):** this sweep asserts
**OBJECTIVE** failures only — crash, console error/exception, freeze/stall, NaN/non-finite,
non-render/encounter-miss, unbounded growth, transition desync. It **cannot** assert *feel* — camera
whip on a tunnel curve, jump "bounciness," landing softness, lurch. **Those remain human phone
playtest** (e.g. the #127 underground-camera-on-curves item is still feel-validation only). The
sweep catches the class unit tests structurally miss on a WebGL canvas; it does not replace the
phone for feel.

---

## §6 — Wiring (script + workflow) and the auto-merge gotcha

**Script:** add `"e2e:validation": "playwright test --config playwright.validation.config.ts"` (or
reuse `playwright.config.ts` with a `--grep @validation` tag) — `testDir`/file `e2e/validation.spec.ts`,
reusing the existing `webServer` (Vite dev server on **4173**) and `_helpers.ts`. The soak needs a
longer per-test timeout (the existing config is 90 s; the cross-engine one already uses 180 s — use
a dedicated config so the soak's budget doesn't relax the smoke timeout).

**Workflow:** new **`validation.yml`**, `on: workflow_dispatch` (+ optionally nightly `schedule` and
a `validation` PR-label gate, mirroring `e2e.yml`). One job, chromium-only, uploads the report +
findings artifact on failure. **Run against the Vite dev server on 4173** (what `webServer` already
spins up) — same as the existing e2e. *Fidelity note:* for prod-parity you could instead
`vite build` + `vite preview` of `dist/`; the existing harness chose the dev server, so default to
matching it and flag the preview option in the build PR.

**⚠️ Auto-merge / reseed gotcha (verified in `claude-review.yml`):** `review-and-merge` runs on
`pull_request [opened, synchronize, ready_for_review]` and merges via `gh pr merge --squash
--delete-branch` **only when the PR is non-draft, same-repo, not dependabot/`github-actions[bot]`,
and the branch isn't `*claude-fix*`**; it also **skips if the last commit author is
`github-actions[bot]`** (loop guard), and concurrency is grouped by event type so bot comments
(vercel) don't cancel it.

Implications for this sweep:
1. **`workflow_dispatch` does NOT emit `pull_request` events → it cannot trip or loop the
   auto-merge.** Safe by construction. A nightly `schedule` is likewise inert to it.
2. **Open both PRs (recon + build) as DRAFT** → draft is explicitly excluded from auto-merge, so
   nothing merges until a human marks it ready. (This satisfies "PR only, don't merge.")
3. A sweep that pushes a bot-authored commit to a PR is caught by the last-commit-author guard — no
   pipeline loop.
4. Keep `validation.yml` **off** the `pull_request` default path (dispatch/nightly/label-gated) so
   it never becomes a merge-blocking check or feeds the auto-merge trigger.

---

## Deliverable of the BUILD PR (second PR — do NOT build now)

1. `e2e/validation.spec.ts` — console-clean-over-interactions + the Zen soak (§3 canaries), reusing
   `_helpers.ts`, with the §4 allowlist and per-failure GAME-vs-TEST triage logging
   (`[VALIDATION] entering state=X` so a hang names the iteration before any timeout is ever raised).
2. `playwright.validation.config.ts` + the `e2e:validation` script.
3. `validation.yml` (`workflow_dispatch`, chromium, artifact upload).
4. The **minimal read-only `window.__neonDebug`** hook (dev-gated) in the composition root — the
   only production-code change, and only if §2 confirms no existing hook suffices.

Findings the sweep surfaces go to a **separate triage/bugfix PR** — the sweep **finds, it does not
fix.**

---

### Six universal principles baked in (verbatim intent)
1. **Harness-vs-game triage is rule #1** — every failure must answer "game broken or test broken?";
   build robust (wait for `__READY__`/real states, never force past visibility).
2. **Find, don't fix** — findings → a separate PR.
3. **Expected-warning allowlist** — §4, documented reasons.
4. **Diagnose timeouts, don't bump them** — `[VALIDATION] entering state=X` logging; only raise a
   limit after confirming it's cumulative budget, not a real hang.
5. **The live layer is the point** — console errors, live interactions, sustained unfrozen soak.
6. **Determinism / readiness hook** — `__READY__` + `?seed=` exist; the soak adds `__neonDebug`.
