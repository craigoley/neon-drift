/**
 * RIVAL GHOST — input-replay core. PURE: no three, no DOM, no storage.
 *
 * A run is reproducible from {seed, car, mode, per-frame intents} because the sim
 * is deterministic (#73: seeded RNG, fixed timestep, pure per-instance state). So
 * a "ghost" is recorded as the INPUT STREAM (tiny) rather than frame snapshots
 * (huge), and replayed by re-running a SECOND game state in lockstep — one
 * `update()` per live `update()`, same dt, same seed → the exact same trajectory.
 *
 * This is also the seam for future live multiplayer: the same replay engine, with
 * intents STREAMED over the wire instead of loaded from storage. Keep this module
 * the single source of truth for "intents → run".
 *
 * Compact encoding: `steers[i]` is the steer for frame i (full precision — JSON
 * round-trips a float losslessly, so replay stays bit-exact); `deployFrames` is the
 * SPARSE list of frame indices where the slow-mo deploy edge fired (deploys are
 * rare, so a sparse index list is far smaller than a per-frame boolean array).
 * `restart` is never recorded — it's a menu/crash control, always false in-run.
 */

import { GHOST, SIM_MATH_VERSION } from '../utils/constants';
import { createGameState, type GameState, GameMode, startRun, update } from './GameState';
import type { CarHandling, CarScoring, CarSlowMo } from '../utils/constants';
import { createIntent, type InputIntent } from './Input';
import { TIMESTEP } from '../utils/constants';

/** A persisted ghost: the seed + car identity + the input stream + the outcome. */
export interface GhostRecording {
  /** Schema version (bump if the encoding changes, so old blobs are rejected). */
  v: number;
  /** SIM-MATH version the run was produced with (SIM_MATH_VERSION). A ghost is
   *  replayed in lockstep with the live sim, so a mismatched-math ghost would diverge
   *  from its own recorded path — it's refused for replay (see GhostStore.valid). */
  mathVersion: number;
  seed: number;
  mode: GameMode;
  /** The car the run used — its handling/scoring/slowMo must be re-resolved for an
   *  exact replay (different handling → different trajectory from the same inputs). */
  carId: string;
  /** Per-frame steer, one entry per fixed sub-step. Length === frame count. */
  steers: number[];
  /** Sorted sub-step indices where the slow-mo deploy edge fired (sparse). */
  deployFrames: number[];
  /** Outcome (the "win" metric is score) + when it was set. */
  score: number;
  distance: number;
  date: number;
}

/** A growing recording buffer for the live run (assembled into a GhostRecording at
 *  run-end). Kept allocation-light: two arrays appended per sub-step. */
export interface RecordingBuffer {
  steers: number[];
  deployFrames: number[];
}

export function createRecordingBuffer(): RecordingBuffer {
  return { steers: [], deployFrames: [] };
}

/**
 * Record ONE sub-step's intent into the buffer. Call with the intent EXACTLY as it
 * is handed to `update()` for this sub-step, BEFORE update() runs (update consumes/
 * clears the deploy latch). Caps at GHOST.maxFrames so a runaway run can't grow
 * unbounded — once capped, further frames are dropped (the ghost simply ends early).
 */
export function recordFrame(buf: RecordingBuffer, intent: InputIntent): void {
  if (buf.steers.length >= GHOST.maxFrames) return;
  const frame = buf.steers.length;
  buf.steers.push(intent.steer);
  if (intent.deploySlowMo) buf.deployFrames.push(frame);
}

/** Total recorded sub-steps. */
export function recordedFrameCount(rec: Pick<GhostRecording, 'steers'>): number {
  return rec.steers.length;
}

/**
 * Reconstruct the intent for a given frame index from a recording. Returns a FRESH
 * intent object each call (update() mutates it, so it must not be shared). Out-of-
 * range frames return a neutral intent (the ghost has ended — caller should stop).
 */
export function intentAtFrame(rec: GhostRecording, frame: number, deploySet: Set<number>): InputIntent {
  const intent = createIntent();
  if (frame < 0 || frame >= rec.steers.length) return intent;
  intent.steer = rec.steers[frame];
  intent.deploySlowMo = deploySet.has(frame);
  return intent;
}

/** Build a fast lookup for the sparse deploy frames (so replay is O(1) per frame). */
export function deploySetOf(rec: GhostRecording): Set<number> {
  return new Set(rec.deployFrames);
}

/** Resolvers the caller supplies so this pure module never imports the car table
 *  directly (keeps it dependency-light + lets tests inject simple profiles). */
export interface CarProfiles {
  handling: CarHandling;
  scoring: CarScoring;
  slowMo: CarSlowMo;
}

/**
 * Spin up a fresh ghost game state seeded + configured to reproduce `rec`. Call
 * `update()` on the returned state once per live sub-step, feeding
 * `intentAtFrame(rec, frame, deploySet)`, to replay the run in lockstep.
 */
export function createGhostState(rec: GhostRecording, profiles: CarProfiles): GameState {
  const state = createGameState(rec.seed);
  return startRun(state, profiles.handling, 0, rec.seed, profiles.scoring, rec.mode, profiles.slowMo);
}

/**
 * Replay an ENTIRE recording in a fresh state and return the final state. This IS
 * the ghost's core contract (and the unit-testable one): feeding a recording's
 * inputs back through the pure sim reproduces the run. Used by tests; the live game
 * steps the ghost incrementally (one frame per live frame) instead.
 */
export function replayToEnd(rec: GhostRecording, profiles: CarProfiles): GameState {
  const state = createGhostState(rec, profiles);
  const deploySet = deploySetOf(rec);
  for (let f = 0; f < rec.steers.length; f++) {
    update(state, intentAtFrame(rec, f, deploySet), TIMESTEP);
  }
  return state;
}

/** Assemble a finished recording from the live buffer + run metadata. */
export function buildRecording(
  buf: RecordingBuffer,
  meta: { seed: number; mode: GameMode; carId: string; score: number; distance: number; date: number },
): GhostRecording {
  return {
    v: 1,
    mathVersion: SIM_MATH_VERSION,
    seed: meta.seed,
    mode: meta.mode,
    carId: meta.carId,
    steers: buf.steers,
    deployFrames: buf.deployFrames,
    score: meta.score,
    distance: meta.distance,
    date: meta.date,
  };
}
