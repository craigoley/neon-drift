/**
 * RIVAL GHOST — input-replay core contract. The ghost's whole premise: a recorded
 * input stream + seed, fed back through the pure sim, reproduces the run EXACTLY.
 * This is the unit-testable heart of the feature (and of future live multiplayer).
 * Leans on the same determinism guarantee as #73. Pure — no three, no DOM.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type GameState, GameMode, Phase, startRun, update } from '../GameState';
import { createIntent } from '../Input';
import {
  buildRecording,
  createGhostState,
  createRecordingBuffer,
  deploySetOf,
  intentAtFrame,
  recordFrame,
  replayToEnd,
  type CarProfiles,
} from '../Replay';
import { BASE_HANDLING, BASE_SCORING, BASE_SLOWMO, TIMESTEP } from '../../utils/constants';

const PROFILES: CarProfiles = { handling: BASE_HANDLING, scoring: BASE_SCORING, slowMo: BASE_SLOWMO };

/** A pure, frame-indexed input script (steer wander + periodic deploy edges). */
function scriptIntent(f: number) {
  const i = createIntent();
  i.steer = Math.sin(f * 0.12) * 0.8;
  i.deploySlowMo = f % 90 === 0; // edges — fire when a charge happens to be banked
  return i;
}

const scoreOf = (g: GameState, mode: GameMode) =>
  mode === GameMode.DailySlalom ? g.slalomScore.score : g.score.score;

/** Drive a live run under the script, recording each sub-step, until crash or cap. */
function recordLiveRun(seed: number, mode: GameMode, maxFrames = 1500) {
  const live = startRun(createGameState(seed), PROFILES.handling, 0, seed, PROFILES.scoring, mode, PROFILES.slowMo);
  const buf = createRecordingBuffer();
  let f = 0;
  while (f < maxFrames && live.phase === Phase.Playing) {
    const intent = scriptIntent(f);
    recordFrame(buf, intent); // BEFORE update() (which consumes the deploy latch)
    update(live, intent, TIMESTEP);
    f++;
  }
  const rec = buildRecording(buf, {
    seed, mode, carId: 'pulse', score: scoreOf(live, mode), distance: live.distance, date: 0,
  });
  return { live, rec };
}

describe('Replay — a recorded run replays to an identical final state', () => {
  for (const mode of [GameMode.Classic, GameMode.DailySlalom]) {
    it(`${mode}: replayToEnd reproduces the live run exactly`, () => {
      for (const seed of [1, 7, 123, 4242]) {
        const { live, rec } = recordLiveRun(seed, mode);
        const replay = replayToEnd(rec, PROFILES);

        // EXACT anchor: the RNG state must match (proves the whole stream replayed).
        expect(replay.rng.getState(), `${mode} seed=${seed} rng`).toBe(live.rng.getState());
        expect(replay.powerups.rng.getState()).toBe(live.powerups.rng.getState());
        expect(replay.phase, `${mode} seed=${seed} phase`).toBe(live.phase);
        // Float-derived: tolerance (same engine = bit-identical; tolerance is defensive).
        expect(replay.distance, `${mode} seed=${seed} distance`).toBeCloseTo(live.distance, 6);
        expect(replay.score.score).toBeCloseTo(live.score.score, 6);
        expect(replay.slalomScore.score).toBeCloseTo(live.slalomScore.score, 6);
        expect(replay.vehicle.lateral).toBeCloseTo(live.vehicle.lateral, 6);
        // The recorded length is meaningful (the run actually advanced).
        expect(rec.steers.length).toBeGreaterThan(0);
      }
    });
  }

  it('the recorded stream advanced the RNG (a real run, not a no-op)', () => {
    const { rec } = recordLiveRun(123, GameMode.Classic);
    const replay = replayToEnd(rec, PROFILES);
    expect(replay.rng.getState()).not.toBe(123 >>> 0);
    expect(replay.distance).toBeGreaterThan(0);
  });
});

describe('Replay — the ghost never mutates the live state', () => {
  it('replaying a recording does not touch the live game object', () => {
    const { live, rec } = recordLiveRun(99, GameMode.Classic);
    const before = { rng: live.rng.getState(), distance: live.distance, score: live.score.score, phase: live.phase };
    // A full replay runs on its OWN fresh state (createGhostState) — the live one
    // must be untouched.
    const ghost = createGhostState(rec, PROFILES);
    expect(ghost).not.toBe(live);
    replayToEnd(rec, PROFILES);
    expect(live.rng.getState()).toBe(before.rng);
    expect(live.distance).toBe(before.distance);
    expect(live.score.score).toBe(before.score);
    expect(live.phase).toBe(before.phase);
  });

  it('stepping the ghost in lockstep does not alter the live sim', () => {
    const seed = 55;
    const live = startRun(createGameState(seed), PROFILES.handling, 0, seed, PROFILES.scoring, GameMode.Classic, PROFILES.slowMo);
    const { rec } = recordLiveRun(seed, GameMode.Classic, 300);
    const ghost = createGhostState(rec, PROFILES);
    const deploySet = deploySetOf(rec);
    // Advance ghost 100 steps; the (independent) live state advanced 0 → unchanged.
    const liveRng = live.rng.getState();
    for (let f = 0; f < 100; f++) update(ghost, intentAtFrame(rec, f, deploySet), TIMESTEP);
    expect(live.rng.getState()).toBe(liveRng);
    expect(live.distance).toBe(0);
  });
});

describe('Replay — deploy edges are encoded + reconstructed', () => {
  it('intentAtFrame restores the deploy latch only on recorded frames', () => {
    const buf = createRecordingBuffer();
    for (let f = 0; f < 10; f++) {
      const i = createIntent();
      i.steer = 0.1 * f;
      i.deploySlowMo = f === 3 || f === 7;
      recordFrame(buf, i);
    }
    const rec = buildRecording(buf, { seed: 1, mode: GameMode.Classic, carId: 'pulse', score: 0, distance: 0, date: 0 });
    const set = deploySetOf(rec);
    expect(rec.deployFrames).toEqual([3, 7]);
    expect(intentAtFrame(rec, 3, set).deploySlowMo).toBe(true);
    expect(intentAtFrame(rec, 7, set).deploySlowMo).toBe(true);
    expect(intentAtFrame(rec, 4, set).deploySlowMo).toBe(false);
    expect(intentAtFrame(rec, 3, set).steer).toBeCloseTo(0.3, 9);
    // Out of range → neutral intent (ghost has ended).
    expect(intentAtFrame(rec, 999, set)).toEqual(createIntent());
  });
});
