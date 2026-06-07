# Rival Ghost — input-replay design

Race a translucent ghost of your best run alongside a live run on the SAME course,
by **recording the input stream** (`{seed, car, mode, per-frame intents}`) and
**re-running a second pure sim in lockstep** — not frame snapshots.

## Why input-replay (and the #73 dependency)

The sim is deterministic: seeded RNG, fixed timestep, and — confirmed in recon —
**zero module-level mutable state** and no `Math.random`/`Date.now`/`performance`
under `src/game/`. So `same seed + same intents ⇒ identical state` (the #73
determinism meta-test enforces exactly this). That makes a run reproducible from
its inputs alone:

- **Tiny files.** A recording is just the steer array + sparse deploy-frame indices.
  Measured: **~1.2 KB/sec** of run (classic seed-21 3.0s run = **3.6 KB**; a 12.5s
  slalom run = **15 KB**). A 60s run ≈ ~70 KB; bounded by `GHOST.maxFrames` (10 min)
  at ~700 KB worst case. Frame-snapshots would be **megabytes** (the full pool state
  every frame).
- **Guaranteed-accurate replay.** The ghost re-runs the real sim, so it reproduces
  the recorded run exactly — no drift, no interpolation.

## Decision gate — two sims in lockstep: CONFIRMED clean

The key feasibility question was whether a second `createGameState()` can run
alongside the live one without clobbering shared state. **It can** — `src/game/` has
no singletons/module mutable state; every `GameState` owns its own RNG, pools, and
scoring. Two states are fully independent. (This is also why this is the right
foundation for live multiplayer — see below.) Confirmed by a test: stepping the
ghost never alters the live state.

## Record / replay boundary (`src/game/Replay.ts`, pure)

The replay engine is one pure module — the single source of truth for "intents → a
run", deliberately decoupled from WHERE the intents come from:

- `recordFrame(buf, intent)` — append one sub-step's intent (called BEFORE
  `update()`, which consumes the deploy latch). Capped at `GHOST.maxFrames`.
- `GhostRecording = { v, seed, mode, carId, steers[], deployFrames[], score, distance, date }`
  — steers full-precision (JSON round-trips a float losslessly → bit-exact replay);
  deploys stored SPARSE (rare edges → index list, not a per-frame boolean array).
- `createGhostState(rec, profiles)` + `update()` per live sub-step = lockstep replay.
- `replayToEnd(rec, profiles)` — replays a whole recording (the unit-testable core).

**This is the multiplayer seam:** swap "intents loaded from a recording" for
"intents streamed over the wire" and the same engine drives a remote player. No
networking is built here.

## Two sims in lockstep (the live loop)

In the fixed-timestep accumulator, per real sub-step: record the live intent →
`update(live)` → `update(ghost, nextRecordedIntent)`. One ghost step per live step,
both at `TIMESTEP`. The ghost reproduces its recorded run exactly; the DISTANCE
difference between the two runs is the race, rendered as a z-offset (ahead = -z,
same mapping as traffic). The ghost is **non-interacting**: a separate state the
live sim never reads — no player↔ghost collision (a phantom). Cost: a second pure
sim step per frame — negligible (the sim is microseconds).

## Seed context (classic vs daily)

A ghost only makes sense on the same course, so **racing a ghost runs on the
ghost's seed**:

- **Classic** (random seed/run): when racing, the live run **adopts the ghost's
  recorded seed** — you race your best run on its exact course. Beating it (higher
  score) replaces it. With racing OFF, classic stays a fresh random course.
- **Daily** (fixed per-date seed): the live seed is already today's daily seed, so
  we race the daily ghost only if it was **recorded on today's seed** (a stale ghost
  from another day's course is skipped). "Beat your earlier run on today's daily."

A ghost is never replayed on a mismatched seed (it would desync meaninglessly).

## Storage (`src/state/GhostStore.ts`)

Mirrors LeaderboardStore/DailyStore: resilient localStorage with an in-memory
fallback, defensive parse that rejects malformed/old-schema blobs. **One ghost per
mode** (classic + daily are independent slots). The **win metric is SCORE** — a run
replaces the stored ghost only if it out-scores it.

## UX

- **Settings → "Rival Ghost"** toggle (OFF by default, so seed/course behaviour is
  unchanged until opted in). On → race your best run for the mode.
- **The translucent ghost car**: the recorded car's silhouette, restyled a cool
  translucent blue (`GHOST` colours/opacity) so it clearly reads as a phantom, not
  the player. Fades further once its recording ends and it recedes behind you.
- **Beat-the-ghost moment**: a `GHOST BEATEN!` HUD toast the instant your live score
  passes the ghost's final score, and a `RIVAL GHOST BEATEN!` / `NEW RIVAL GHOST
  SET` line on the WIPEOUT screen.

## Tests

- **Core contract** (`game/__tests__/replay.test.ts`): a recorded run replayed in a
  fresh sim reproduces the EXACT final state (rng anchor exact; floats `toBeCloseTo`)
  — both modes × 4 seeds. Plus: the ghost never mutates the live state; deploy edges
  encode/reconstruct correctly.
- **Storage** (`state/__tests__/ghoststore.test.ts`): per-mode slots, score-gated
  replace, resilient load (malformed/old-schema/non-finite rejected), in-memory
  fallback.
- The **#73 determinism meta-test still passes** (the ghost relies on it).

## Purity

No `three`/DOM added under `src/game/` — `Replay.ts` is pure; the renderer/store/UI
changes are all in the rendering/state/ui layers.

## Final sign-off = a playtest (canvas-walled)

No automated test can verify the *feel*. Please play with **Rival Ghost ON**: set a
run, then race it — does the translucent car read as "another racer," does ahead/
behind track the real gap, and is **beating it satisfying**? Tune `GHOST` opacities/
colour and the beat cue from there.

## Foundation for live multiplayer (not built now)

The record/replay boundary in `Replay.ts` is intentionally the same one live family
multiplayer would use: today the second sim is fed intents from storage; later it
would be fed intents streamed from a peer. Same deterministic lockstep engine,
different intent source. No networking, lobby, or transport is in this PR.
