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

Dependabot PRs auto-merge too, but on a different path (#226): they are
excluded from `claude-review.yml`'s `pull_request` trigger and instead run
the Playwright smoke, which on success fires a `workflow_run` that reviews
and merges the bump. So a dependency bump is gated on the browser smoke,
not on a human. Held-back deps live in `.github/dependabot.yml` —
currently `typescript` majors (see the lessons below).

## Lessons from 2026-07-02
- `npm install` rewrites `package-lock.json` on this toolchain (strips `libc`
  fields from optional deps). Run `git checkout -- package-lock.json` before
  committing unless you actually changed dependencies — keep the diff focused.
  **Correction (2026-08-05):** this is not a property of npm, it is a Node version
  mismatch. The repo pins Node 24 (`.nvmrc`, `engines`) but the dev machine's only
  Node is Homebrew `node@22`, and there is no nvm/fnm/volta installed. Under Node 22
  `npm install` does more than strip `libc` — it **drops whole optional-dep subtrees**
  (observed: `@emnapi/*`, `@napi-rs/wasm-runtime`, `@rolldown/binding-wasm32-wasi`,
  `@tybys/wasm-util`, `tslib` removed together), which the old "re-insert `libc` by
  hand" workaround does not catch. When you must regenerate the lockfile, fetch the
  pinned Node first and prepend it to `PATH`:
  ```
  curl -sL https://nodejs.org/dist/v24.19.0/node-v24.19.0-darwin-arm64.tar.gz | tar -xz
  export PATH="$PWD/node-v24.19.0-darwin-arm64/bin:$PATH"
  ```
  The diff then comes out version-only. Verify with
  `git diff package-lock.json | grep -c '^-\s*"libc"'` == 0, and cross-check the
  shape against Dependabot's own lockfile on the branch — Dependabot runs Node 24,
  so matching it confirms a removal is a real upstream change rather than churn.
  *(from #192/#195/#196; corrected in #224)*
- Visual baselines (`e2e/visual.spec.ts`) are per-OS: `-linux` is the source of truth,
  `-darwin` is gitignored, so you can't author the real baseline locally. Tolerance is
  `maxDiffPixelRatio: 0.1`, so small localized restyles usually pass without a regen —
  run `visual.spec` to see which (if any) actually shifted rather than assuming a regen
  is needed. **Correction (2026-07-30):** this lesson used to claim the `-linux`
  baselines were committed and regenerated on CI. They were NOT — zero `-linux` files
  were ever tracked (the only tracked snapshot was a stray `boot-chromium-darwin.png`),
  because the e2e failure artifact uploaded only `playwright-report/` and never the
  written PNGs, so the "commit those" step was impossible. Every screenshot spec had
  therefore been failing on CI with "A snapshot doesn't exist" — the 0.1-tolerance
  reasoning never applied on CI at all, since no comparison ever happened. Regenerate
  via the `Visual baselines (regenerate)` workflow.
  *(from #194/#195/#196/#200; corrected in #215)*
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
- Bot identities are spelled DIFFERENTLY depending on where you read them, and
  every mismatch fails silently. The webhook payload
  (`github.event.pull_request.user.login`) says `dependabot[bot]`; `gh pr view
  --json author` says `app/dependabot`. `e2e.yml` matches the first,
  `claude-review.yml` the second — on purpose. A wrong string fails CLOSED and
  blocks every bump with no error anywhere. Verify against a real PR before
  trusting a spelling. Two related traps in the same wiring: a `workflow_run`
  whose only job was SKIPPED still reports `conclusion == 'success'` (so gate on
  the named JOB's conclusion, not the run's), and the review loop-brake must NOT
  match the bare `claude` login — local Claude Code commits are authored
  `Claude <noreply@anthropic.com>`, which resolves to the ordinary `claude` user,
  a different account from `claude[bot]`. Most hand-written work here carries that
  authorship, so matching it would disable review on nearly every human PR.
  *(from #226 — the first two were caught pre-merge by checking real PRs)*
- Dependabot may SUPERSEDE an open PR mid-session: merging other PRs triggers a
  rebase, and it closes the stale one and opens a replacement with a new branch
  hash (#220 → #224 in one session). Re-list open PRs after each merge rather than
  holding onto numbers, and force-pushing a fix to a branch that has already been
  superseded fails with "couldn't find remote ref".
  *(from #220/#224)*
