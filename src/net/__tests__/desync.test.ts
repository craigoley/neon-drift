/**
 * Enhanced desync detector (diagnostics). Confirms: matching worlds agree; the hash
 * now covers the powerup rng + spawn counters + speed (the fields the old detector
 * missed); a mismatch reports EVERY diverging field with its magnitude and names the
 * EARLIEST one in the causal chain (speed → since → spawned → rng → dist…). The actual
 * cross-engine sync is canvas-walled; this locks the detection logic.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, startRun, update } from '../../game/GameState';
import { createIntent } from '../../game/Input';
import { TIMESTEP } from '../../utils/constants';
import { compareWorld, stateSum, worldSum, type WorldSum } from '../Desync';

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

/** Deep-clone a WorldSum so a test can inject a single-field divergence. */
const clone = (w: WorldSum): WorldSum => ({ f: w.f, host: { ...w.host }, join: { ...w.join } });

describe('Desync — the hash covers the new fields', () => {
  it('stateSum captures both rng streams, both spawn counters, speed + accumulators', () => {
    const g = startRun(createGameState(7), undefined, undefined, 7);
    for (let f = 0; f < 600; f++) update(g, createIntent(), TIMESTEP);
    const s = stateSum(g);
    for (const k of ['trafficRng', 'powerupRng', 'trafficSpawned', 'powerupSpawned', 'speed', 'trafficSince', 'powerupSince', 'dist', 'lat', 'score'] as const) {
      expect(s, `has ${k}`).toHaveProperty(k);
      expect(typeof s[k]).toBe('number');
    }
    expect(s.trafficSpawned, 'traffic actually spawned over 600 frames').toBeGreaterThan(0);
    expect(s.trafficRng).not.toBe(s.powerupRng); // two distinct streams
  });
});

describe('Desync — matching worlds agree (exact, no tolerance)', () => {
  it('two peers simulating both cars identically produce a matching world hash', () => {
    for (const seed of [1, 7, 2024]) {
      const { a, b } = twinWorlds(seed, 400);
      expect(compareWorld(a, b).ok, `seed=${seed}`).toBe(true);
    }
  });
});

describe('Desync — catches what the OLD detector missed', () => {
  it('a powerup-rng-only offset is caught (old detector never hashed powerups.rng)', () => {
    const { a, b } = twinWorlds(7, 300);
    const drifted = clone(b);
    drifted.host.powerupRng = b.host.powerupRng + 5; // a 5-draw offset in the powerup stream only
    const v = compareWorld(a, drifted);
    expect(v.ok).toBe(false);
    expect(v.first?.field).toBe('powerupRng');
    expect(v.first?.exact).toBe(true);
    expect(v.detail).toContain('host.powerupRng OFFSET');
  });

  it('a spawn-count offset is caught (traffic.spawned was never hashed)', () => {
    const { a, b } = twinWorlds(7, 300);
    const drifted = clone(b);
    drifted.join.trafficSpawned = b.join.trafficSpawned + 1;
    const v = compareWorld(a, drifted);
    expect(v.ok).toBe(false);
    expect(v.first?.field).toBe('trafficSpawned');
    expect(v.detail).toContain('join.trafficSpawned OFFSET');
  });
});

describe('Desync — reports magnitude + the earliest causal field', () => {
  it('a float divergence reports its exact delta magnitude', () => {
    const { a, b } = twinWorlds(7, 200);
    const drifted = clone(b);
    drifted.host.speed = b.host.speed + 3.4e-12; // a tiny FP-scale drift
    const v = compareWorld(a, drifted);
    expect(v.ok).toBe(false);
    expect(v.first?.field).toBe('speed');
    expect(v.first?.delta).toBeGreaterThan(1e-12); // ~3.4e-12 magnitude (FP-scale)
    expect(v.first?.delta).toBeLessThan(1e-11);
    expect(v.summary).toContain('speed');
    expect(v.summary).toMatch(/e-12/); // magnitude readable on-screen
  });

  it('when MULTIPLE fields diverge, the EARLIEST causal one (speed before rng) is "first"', () => {
    const { a, b } = twinWorlds(7, 200);
    const drifted = clone(b);
    drifted.host.speed = b.host.speed + 1e-9; // root
    drifted.host.trafficRng = b.host.trafficRng + 3; // downstream symptom
    drifted.host.dist = b.host.dist + 1e-6;
    const v = compareWorld(a, drifted);
    expect(v.first?.field).toBe('speed'); // causal order: speed precedes trafficRng/dist
    // but the full detail still lists every diverging field for the record
    expect(v.detail).toContain('speed');
    expect(v.detail).toContain('trafficRng OFFSET');
    expect(v.detail).toContain('dist');
  });

  it('a frame-number mismatch is rejected', () => {
    const { a, b } = twinWorlds(7, 200);
    expect(compareWorld(a, { ...b, f: b.f + 1 }).ok).toBe(false);
  });
});
