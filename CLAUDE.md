# Neon Drift
Synthwave endless racing game. TypeScript + Three.js + Vite.
Deployed to Vercel as a static site. Part of OleyArcade.

## Architecture
- src/game/ — pure TypeScript, ZERO three.js imports, Node-testable
- src/rendering/ — three.js layer, reads game state, never mutates it
- src/audio/ — Web Audio API, synthesized only, no audio files
Loop: input -> game.update() -> render -> repeat.

## Hard rules
- NEVER import 'three' anywhere under src/game/
- ALL tuning constants in utils/constants.ts — no magic numbers
- No external art assets — geometry is procedural
- No external audio files — sound is synthesized
- Mobile required: touch controls at parity with keyboard
- Palette: #ff00ff magenta, #00ffff cyan, #1a0033 deep purple,
  #ff6600 accent
- `npm run build` must pass before any PR
- Node pinned to 24.x (engines + .nvmrc)

## Testing
Vitest on the pure src/game/ layer. Tests in src/game/__tests__/.
No WebGL tests needed — game logic is pure.

## Deployment
Vercel auto-deploys on merge to main. Framework preset: Vite.
No server routes, no API endpoints — this is a static client app.

## PR workflow
Branch from latest main, PR, never commit to main directly.
Copilot + Claude Code review on PRs. PR pipeline auto-merges
iterative PRs after review passes.

## Lessons from 2026-07-02
- `npm install` rewrites `package-lock.json` on this toolchain (strips `libc`
  fields from optional deps). Run `git checkout -- package-lock.json` before
  committing unless you actually changed dependencies — keep the diff focused.
  *(from #192/#195/#196 — the churn showed up in nearly every PR's diff)*
- Visual baselines (`e2e/visual.spec.ts`) are per-OS: only `-linux` is committed
  (regenerated on CI), `-darwin` is gitignored, so you can't author the real
  baseline locally. Tolerance is `maxDiffPixelRatio: 0.1`, so small localized
  restyles usually pass without a regen — run `visual.spec` to see which (if any)
  actually shifted rather than assuming a regen is needed.
  *(from #194/#195/#196/#200 — restyles stayed under the 0.1 tolerance every time)*
- The Zen layer (`src/zen/`) is rendering-coupled, not pure like `src/game/`. Warp/
  teleport orchestration (`ZenSession` over a `WebGLRenderer`) is NOT headless-
  testable. Test the pure sub-modules (`ZenTunnelPayoff`, `ZenCavernLayout`,
  `ZenHeight`, …) + structural guarantees (`readonly` fields, removed methods);
  the L3 soak covers the wiring. Don't try to unit-test `ZenSession` in jsdom.
  *(from #197 — the tunnel-warp fix was verified via pure tests + a readonly seed)*
- The L3 validation soak (`e2e/validation.spec.ts`, `npm run e2e:validation`,
  weekly/`workflow_dispatch` only, `--workers=1`) drives a real-time closed-loop
  autopilot on wall-clock budgets. A soak failure can be environment/timing-
  dependent (it fails at different phases on different machines). Reproduce and
  characterize whether it's deterministic-red or flaky BEFORE concluding a real
  regression — intermittent-red usually means autopilot/budget, not the game.
  *(from #198/#199 — the "tunnel canary" red was pre-existing + partly non-deterministic)*
- The validation Playwright config's `testMatch` only picks up `validation.spec.ts`.
  Throwaway/diagnostic e2e specs must run under the DEFAULT config
  (`npx playwright test <file>`), not `--config playwright.validation.config.ts`
  (which reports "No tests found" for anything else).
  *(from #198/#199 — a diagnostic spec silently matched nothing under the validation config)*
- To exercise the touch UI in e2e (SLOW-MO / GAS-BRAKE / touch hint copy), use a
  `{ hasTouch: true, isMobile: true }` Playwright context — the game computes
  `isTouch` ONCE at page load via `matchMedia('(pointer:coarse)') || 'ontouchstart'
  in window` — and assert the touch controls actually RENDER; don't assume the
  flag flipped from the context alone.
  *(from #193 — the touch-capture variant had to prove the controls appeared)*
- The Zen tunnel payoff warp (`inTunnelSpace`) only fires when the car descends
  ALONG the bent tunnel centreline so `along` crosses 0 on consecutive in-corridor
  frames (`ZenTunnelPayoff.passedDeepPoint`). A straight-line drive leaves the ~32u
  corridor and never warps. Any autopilot/test driving a tunnel must bend-follow the
  computed centreline (`tunnelCentreline` from `tunnelBendShape`).
  *(from #199 — two straight-line strategies descended but never warped; bend-following did)*
