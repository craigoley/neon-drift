/**
 * Course VARIETY — regression pins for the OPP rebalance: the pacing wave
 * (gauntlet/breather texture), seeded determinism, and that DIFFERENT seeds
 * produce genuinely different courses (the fixed-seed bug made every run
 * identical). Pool-bounded + no-NaN safety. The curve SHAPE itself is pinned in
 * difficulty.test.ts. Pure-layer only.
 */
import { describe, expect, it } from 'vitest';
import {
  createTrafficState,
  pacedSpawnInterval,
  pacingFactor,
  updateTraffic,
  activeObstacleCount,
} from '../Traffic';
import { Rng } from '../../utils/rng';
import { TRAFFIC, TIMESTEP } from '../../utils/constants';

/** Simulate a surviving run and capture the spawn sequence signature + safety. */
function runCourse(seed: number, steps = 6000, speed = 160) {
  const traffic = createTrafficState();
  const rng = new Rng(seed);
  let distance = 0;
  let prevSpawned = traffic.spawned;
  const sig: string[] = [];
  let maxActive = 0;
  let allFinite = true;
  for (let i = 0; i < steps; i++) {
    distance += speed * TIMESTEP;
    updateTraffic(traffic, rng, seed, distance, TIMESTEP);
    if (traffic.spawned > prevSpawned) {
      prevSpawned = traffic.spawned;
      const o = traffic.pool.find((p) => p.active && p.id === traffic.nextId - 1);
      if (o) sig.push(`${o.kind}:${Math.round(o.laneOffset * 4)}`);
    }
    maxActive = Math.max(maxActive, activeObstacleCount(traffic));
    for (const p of traffic.pool) {
      if (p.active && !(Number.isFinite(p.lateral) && Number.isFinite(p.distance))) allFinite = false;
    }
    expect(traffic.pool.length).toBe(TRAFFIC.poolSize); // array never grows
  }
  return { sig, maxActive, allFinite, spawned: traffic.spawned };
}

describe('Variety — pacing wave (gauntlet / breather texture)', () => {
  it('pacing factor is bounded to [1 - amplitude, 1 + amplitude]', () => {
    for (let d = 0; d < 20000; d += 137) {
      const f = pacingFactor(1234, d);
      expect(f).toBeGreaterThanOrEqual(1 - TRAFFIC.pacingAmplitude - 1e-9);
      expect(f).toBeLessThanOrEqual(1 + TRAFFIC.pacingAmplitude + 1e-9);
    }
  });

  it('pacing is seed-dependent — different seeds phase the waves differently', () => {
    // At a fixed distance, two seeds should generally give different factors.
    const d = 2500;
    expect(pacingFactor(1, d)).not.toBeCloseTo(pacingFactor(2, d), 3);
  });

  it('paced spawn interval never beats the density floor or exceeds the base', () => {
    for (let d = 0; d < 20000; d += 211) {
      const iv = pacedSpawnInterval(42, d);
      expect(iv).toBeGreaterThanOrEqual(TRAFFIC.minSpawnInterval - 1e-9);
      expect(iv).toBeLessThanOrEqual(TRAFFIC.baseSpawnInterval + 1e-9);
      expect(Number.isFinite(iv)).toBe(true);
    }
  });
});

describe('Variety — seeded course determinism and difference', () => {
  it('a given seed reproduces the exact same course', () => {
    const a = runCourse(20240601);
    const b = runCourse(20240601);
    expect(a.sig).toEqual(b.sig);
    expect(a.sig.length).toBeGreaterThan(20); // a meaningful course was generated
  });

  it('different seeds produce MEANINGFULLY different courses (not just RNG was called)', () => {
    const a = runCourse(1);
    const b = runCourse(2);
    expect(a.sig.join('|')).not.toBe(b.sig.join('|'));
    // Quantify: a large fraction of aligned spawns differ in kind and/or lane.
    const n = Math.min(a.sig.length, b.sig.length);
    let diff = 0;
    for (let i = 0; i < n; i++) if (a.sig[i] !== b.sig[i]) diff++;
    expect(diff / n).toBeGreaterThan(0.5);
  });
});

describe('Variety/safety — pools bounded, no NaN over a long run', () => {
  it('active count never exceeds the pool and all positions stay finite', () => {
    const r = runCourse(7, 12000, 200);
    expect(r.maxActive).toBeLessThanOrEqual(TRAFFIC.poolSize);
    expect(r.allFinite).toBe(true);
    expect(r.spawned).toBeGreaterThan(100); // plenty recycled through the fixed pool
  });
});
