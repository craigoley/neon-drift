/**
 * DETERMINISM META-TEST — the keystone of the L1 sim-test layer.
 *
 * The entire headless-validation strategy rests on ONE property: the pure sim is
 * deterministic — the same seed + the same input script ⇒ the same resulting
 * state, every time. If that ever breaks, every other L1 assertion becomes
 * untrustworthy (a "passing" test could pass or fail by luck). So this is the
 * cheapest high-value guard: it runs on every PR in the existing Vitest job and
 * fails loudly the moment a change introduces non-determinism — an unseeded
 * Math.random, unstable pool iteration order, Date/clock leakage, etc.
 *
 * The RNG state is the ANCHOR. rng.getState() is a uint32 produced by integer bit
 * ops, so it is EXACT and stable even across machines (Mac dev vs CI Linux). Float
 * fields (position/speed/score) come from non-associative float math and can
 * differ in their last digits across engines, so those are compared with
 * toBeCloseTo; integer/exact fields (lives, spawn counts, gates threaded,
 * integer-stepped multiplier) are compared with ===.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type GameState, GameMode, startRun, update } from '../GameState';
import { createIntent, type InputIntent } from '../Input';
import { grantPowerup } from '../Powerups';
import { PowerupKind, TIMESTEP } from '../../utils/constants';

const SEED = 123;
const FRAMES = 600; // ~10 s at 60 Hz — long enough that traffic/gates spawn and the RNG stream advances

/**
 * A PURE input script: the per-frame intent is a deterministic function of the
 * frame index ONLY (no RNG, no clock). A sine wander keeps the car moving across
 * the road so it grazes/threads obstacles; two slow-mo deploy edges exercise the
 * simDt-scaling path (slow-mo scales the whole sim timestep). A fresh intent is
 * built each frame because update() consumes (clears) the deploy latch in place.
 */
function scriptedIntent(frame: number): InputIntent {
  const intent = createIntent();
  intent.steer = Math.sin(frame * 0.13) * 0.7; // deterministic steer in [-0.7, 0.7]
  intent.deploySlowMo = frame === 45 || frame === 220; // two rising edges
  return intent;
}

/**
 * Run a fresh seeded run for FRAMES fixed steps under the pure script. The slow-mo
 * bank is filled up front (identically on every run) so the deploy edges in the
 * script actually fire, exercising the slow-mo time-scale path inside the compared
 * window. update() no-ops after a crash, so running a fixed FRAMES count is safe
 * regardless of when (or whether) the run ends — both runs freeze identically.
 */
function runScripted(seed: number, mode: GameMode): GameState {
  const game = startRun(createGameState(seed), undefined, undefined, seed, undefined, mode);
  for (let i = 0; i < 3; i++) grantPowerup(game.powerups.effects, PowerupKind.SlowMo); // fill the bank
  for (let f = 0; f < FRAMES; f++) update(game, scriptedIntent(f), TIMESTEP);
  return game;
}

/** Assert two runs produced byte-identical state (exact anchors) and matching
 *  float-derived state (within a cross-engine tolerance). */
function expectIdentical(a: GameState, b: GameState): void {
  // EXACT anchors — integer / bit-exact state. The RNG states are THE keystone:
  // if any draw diverged, these differ.
  expect(a.rng.getState()).toBe(b.rng.getState()); // main traffic/gate stream
  expect(a.powerups.rng.getState()).toBe(b.powerups.rng.getState()); // separate pickup stream
  expect(a.phase).toBe(b.phase);
  expect(a.lives).toBe(b.lives);
  expect(a.traffic.spawned).toBe(b.traffic.spawned);
  expect(a.traffic.culled).toBe(b.traffic.culled);
  expect(a.powerups.spawned).toBe(b.powerups.spawned);
  expect(a.powerups.collected).toBe(b.powerups.collected);
  expect(a.slalomScore.gatesThreaded).toBe(b.slalomScore.gatesThreaded);
  expect(a.slalomScore.cleanMultiplier).toBe(b.slalomScore.cleanMultiplier); // integer-stepped
  expect(a.runStats.slowMosDeployed).toBe(b.runStats.slowMosDeployed);

  // FLOAT-derived — same engine is bit-identical, but assert with a tolerance so
  // the guard stays robust to cross-engine last-digit drift (the intent is "same",
  // not "same to 17 digits on this exact CPU").
  expect(a.distance).toBeCloseTo(b.distance, 9);
  expect(a.time).toBeCloseTo(b.time, 9);
  expect(a.vehicle.lateral).toBeCloseTo(b.vehicle.lateral, 9);
  expect(a.vehicle.speed).toBeCloseTo(b.vehicle.speed, 9);
  expect(a.score.score).toBeCloseTo(b.score.score, 6);
  expect(a.score.combo).toBeCloseTo(b.score.combo, 9);
  expect(a.slalomScore.score).toBeCloseTo(b.slalomScore.score, 6);
}

describe('Determinism meta-test — same seed + same script ⇒ identical state', () => {
  it('CLASSIC: two runs of seed 123 over 600 steps are identical', () => {
    const a = runScripted(SEED, GameMode.Classic);
    const b = runScripted(SEED, GameMode.Classic);
    expectIdentical(a, b);
    // The RNG anchor is only meaningful if the stream actually advanced — i.e. at
    // least one traffic obstacle was spawned through the seeded rng (the opening
    // seed sets fields directly without drawing, so a draw means a cadence spawn).
    expect(a.rng.getState()).not.toBe(SEED >>> 0);
    expect(a.distance).toBeGreaterThan(0);
  });

  it('SLALOM: two runs of seed 123 over 600 steps are identical', () => {
    const a = runScripted(SEED, GameMode.DailySlalom);
    const b = runScripted(SEED, GameMode.DailySlalom);
    expectIdentical(a, b);
    // Slalom spawns gates via the seeded rng (opening width + position), so the
    // stream must have advanced past the bare seed here too.
    expect(a.rng.getState()).not.toBe(SEED >>> 0);
    expect(a.distance).toBeGreaterThan(0);
  });

  it('a DIFFERENT seed diverges (the test can actually detect non-determinism)', () => {
    // Sanity: the comparison above is not vacuous. A different seed must change the
    // RNG-driven course, so the anchor differs. (Guards against e.g. a script that
    // accidentally never advances the sim.)
    const a = runScripted(SEED, GameMode.Classic);
    const c = runScripted(SEED + 1, GameMode.Classic);
    expect(a.rng.getState()).not.toBe(c.rng.getState());
  });
});
