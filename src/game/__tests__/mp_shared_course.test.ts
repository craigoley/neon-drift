/**
 * MP SHARED-COURSE spawning (the "different obstacles per screen" fix). In a 2P race
 * both cars must meet the IDENTICAL obstacle/powerup field. The MP path is
 * position-deterministic (pure function of seed + distance band), so two cars on the
 * same seed at DIFFERENT speeds encounter the same field — whereas the (untouched)
 * single-player path is path-dependent and diverges. This test is the proof: GREEN on
 * the mpRace path, and it documents that SP still diverges (i.e. SP is unchanged).
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type GameState, GameMode, startRun, update } from '../GameState';
import { createIntent } from '../Input';
import { handlingFor, slowMoFor, TIMESTEP } from '../../utils/constants';

const q = (n: number) => Math.round(n * 16); // quantize for a stable signature

/** Run a car on `seed` for `frames`; return the set of obstacle + pickup signatures
 *  it ever had active, and the max distance it reached. */
function run(seed: number, carId: string, frames: number, mpRace: boolean) {
  const g: GameState = startRun(
    createGameState(seed),
    handlingFor(carId),
    0,
    seed,
    undefined,
    GameMode.Classic,
    slowMoFor(carId),
    mpRace,
  );
  const obstacles = new Set<string>();
  const pickups = new Set<string>();
  const intent = createIntent(); // drive straight
  for (let f = 0; f < frames; f++) {
    update(g, intent, TIMESTEP);
    for (const o of g.traffic.pool) if (o.active) obstacles.add(`${o.kind}@${q(o.distance)}@${q(o.lateral)}`);
    for (const p of g.powerups.pool) if (p.active) pickups.add(`${p.kind}@${q(p.distance)}@${q(p.lateral)}`);
  }
  return { obstacles, pickups, distance: g.distance };
}

/** Signatures from `set` whose distance band (the middle @-field) is within `range`. */
function within(set: Set<string>, max: number): Set<string> {
  const out = new Set<string>();
  for (const s of set) {
    const d = Number(s.split('@')[1]) / 16;
    if (d <= max) out.add(s);
  }
  return out;
}

describe('MP shared-course: both cars meet the IDENTICAL field (mpRace=true)', () => {
  it('a fast car and a slow car on the same seed see the same obstacles + pickups', () => {
    for (const seed of [12345, 0x5eed1234, 99]) {
      const fast = run(seed, 'ember', 4000, true); // speedCap 1.38
      const slow = run(seed, 'slipstream', 4000, true); // speedCap 0.82
      expect(fast.distance).toBeGreaterThan(slow.distance); // genuinely different speeds
      // Compare over the distance range BOTH traversed.
      const common = slow.distance - 50; // small margin off the leading edge
      const fo = within(fast.obstacles, common);
      const so = within(slow.obstacles, common);
      expect(fo.size, `seed ${seed}: obstacles materialized`).toBeGreaterThan(3);
      expect([...so].sort(), `seed ${seed}: obstacle fields identical`).toEqual([...fo].sort());
      const fp = within(fast.pickups, common);
      const sp = within(slow.pickups, common);
      expect([...sp].sort(), `seed ${seed}: pickup fields identical`).toEqual([...fp].sort());
    }
  });
});

describe('Single-player is UNCHANGED: the path-dependent spawner still diverges (mpRace=false)', () => {
  it('a fast car and a slow car (classic) see DIFFERENT obstacles — the old behavior, intact', () => {
    const fast = run(12345, 'ember', 4000, false);
    const slow = run(12345, 'slipstream', 4000, false);
    const common = slow.distance - 50;
    const fo = within(fast.obstacles, common);
    const so = within(slow.obstacles, common);
    // The SP path is per-car path-dependent → the two fields are NOT equal.
    expect([...so].sort()).not.toEqual([...fo].sort());
  });
});

describe('MP field is a pure function of the seed (deterministic + reproducible)', () => {
  it('the same seed + car replays to an identical field', () => {
    const a = run(777, 'pulse', 2500, true);
    const b = run(777, 'pulse', 2500, true);
    expect([...a.obstacles].sort()).toEqual([...b.obstacles].sort());
    expect([...a.pickups].sort()).toEqual([...b.pickups].sort());
  });
});
