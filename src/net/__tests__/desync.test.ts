/**
 * Desync detector (MP-1 PR2) — the world-checksum compare. PURE; the actual
 * cross-engine sync is canvas-walled. Also confirms that two sims fed the SAME seed
 * + SAME inputs produce a MATCHING world hash (the property lockstep relies on),
 * and that drift is flagged exactly.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, startRun, update } from '../../game/GameState';
import { createIntent } from '../../game/Input';
import { TIMESTEP } from '../../utils/constants';
import { compareWorld, worldSum } from '../Desync';

/** Two independent sims on the same seed, driven by the same scripted input. */
function twinWorlds(seed: number, frames: number) {
  const hostA = startRun(createGameState(seed), undefined, undefined, seed);
  const joinA = startRun(createGameState(seed + 1), undefined, undefined, seed + 1);
  const hostB = startRun(createGameState(seed), undefined, undefined, seed);
  const joinB = startRun(createGameState(seed + 1), undefined, undefined, seed + 1);
  for (let f = 0; f < frames; f++) {
    const hi = createIntent(); hi.steer = Math.sin(f * 0.1) * 0.6;
    const ji = createIntent(); ji.steer = Math.cos(f * 0.07) * 0.6;
    update(hostA, hi, TIMESTEP); update(joinA, ji, TIMESTEP);
    update(hostB, hi, TIMESTEP); update(joinB, ji, TIMESTEP);
  }
  return { a: worldSum(frames, hostA, joinA), b: worldSum(frames, hostB, joinB) };
}

describe('Desync — matching worlds (same seed + inputs) agree', () => {
  it('two peers simulating both cars identically produce a matching world hash', () => {
    for (const seed of [1, 7, 2024]) {
      const { a, b } = twinWorlds(seed, 400);
      expect(compareWorld(a, b).ok, `seed=${seed}`).toBe(true);
    }
  });
});

describe('Desync — drift is flagged', () => {
  it('an RNG-state divergence in the host car is caught exactly', () => {
    const { a, b } = twinWorlds(7, 200);
    const drifted = { ...b, host: { ...b.host, rng: b.host.rng + 1 } };
    const v = compareWorld(a, drifted);
    expect(v.ok).toBe(false);
    expect(v.detail).toContain('host RNG desync');
  });

  it('a float divergence in the join car beyond epsilon is caught', () => {
    const { a, b } = twinWorlds(7, 200);
    const drifted = { ...b, join: { ...b.join, dist: b.join.dist + 1 } };
    const v = compareWorld(a, drifted);
    expect(v.ok).toBe(false);
    expect(v.detail).toContain('join.dist');
  });

  it('a frame-number mismatch is rejected', () => {
    const { a, b } = twinWorlds(7, 200);
    expect(compareWorld(a, { ...b, f: b.f + 1 }).ok).toBe(false);
  });
});
