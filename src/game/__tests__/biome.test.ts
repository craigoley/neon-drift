import { describe, expect, it } from 'vitest';
import { biomeCount, createBiomeState, updateBiome } from '../Biome';
import { createGameState, Phase, startRun, update } from '../GameState';
import { activeObstacleCount } from '../Traffic';
import { activePickupCount } from '../Powerups';
import { createIntent } from '../Input';
import { mixHex } from '../../utils/math';
import { BIOMES, BIOME_CYCLE, POWERUPS, TIMESTEP, TRAFFIC } from '../../utils/constants';

const SPAN = BIOME_CYCLE.span;
const N = BIOMES.length;
const T_START = 1 - BIOME_CYCLE.transitionFraction;

describe('Biome — selection by distance is deterministic', () => {
  it('holds the first biome through the leading part of its span (no blend)', () => {
    for (const d of [0, 1, SPAN * 0.25, SPAN * (T_START - 0.01)]) {
      const s = updateBiome(createBiomeState(), d);
      expect(s.from).toBe(0);
      expect(s.to).toBe(0);
      expect(s.blend).toBe(0);
    }
  });

  it('blends into the next biome through the trailing transition zone', () => {
    const mid = updateBiome(createBiomeState(), SPAN * (T_START + BIOME_CYCLE.transitionFraction * 0.5));
    expect(mid.from).toBe(0);
    expect(mid.to).toBe(1);
    expect(mid.blend).toBeCloseTo(0.5, 5);

    // Just inside the zone → blend ~0; just before the boundary → blend ~1.
    expect(updateBiome(createBiomeState(), SPAN * (T_START + 1e-4)).blend).toBeLessThan(0.05);
    expect(updateBiome(createBiomeState(), SPAN * 0.999).blend).toBeGreaterThan(0.95);
  });

  it('lands exactly on the next biome at the span boundary', () => {
    const s = updateBiome(createBiomeState(), SPAN);
    expect(s.from).toBe(1);
    expect(s.to).toBe(1);
    expect(s.blend).toBe(0);
  });

  it('cycles back to the first biome after the full set', () => {
    const s = updateBiome(createBiomeState(), SPAN * N);
    expect(s.from).toBe(0);
    expect(s.to).toBe(0);
    // …and the transition pattern repeats one cycle on (from 0 → 1 again).
    const s2 = updateBiome(createBiomeState(), SPAN * (N + T_START + BIOME_CYCLE.transitionFraction * 0.5));
    expect(s2.from).toBe(0);
    expect(s2.to).toBe(1);
    expect(s2.blend).toBeCloseTo(0.5, 5);
  });

  it('is a pure in-place mutation (same reference, repeatable)', () => {
    const s = createBiomeState();
    const ret = updateBiome(s, SPAN * 2.4);
    expect(ret).toBe(s); // no allocation — mutates and returns the same object
    const a = updateBiome(createBiomeState(), 4321);
    const b = updateBiome(createBiomeState(), 4321);
    expect(a).toEqual(b); // deterministic for a given distance
  });

  it('over a long distance sweep, state is always valid (in-range, finite)', () => {
    const s = createBiomeState();
    for (let d = 0; d <= SPAN * N * 3; d += 137) {
      updateBiome(s, d);
      expect(s.from).toBeGreaterThanOrEqual(0);
      expect(s.from).toBeLessThan(N);
      expect(s.to).toBeGreaterThanOrEqual(0);
      expect(s.to).toBeLessThan(N);
      expect(s.blend).toBeGreaterThanOrEqual(0);
      expect(s.blend).toBeLessThanOrEqual(1);
      expect(Number.isFinite(s.blend)).toBe(true);
    }
  });

  it('biomeCount matches the configured set', () => {
    expect(biomeCount()).toBe(N);
    expect(N).toBeGreaterThanOrEqual(3);
  });
});

describe('Biome — transition lerp produces no invalid colours', () => {
  function assertValidHex(c: number): void {
    expect(Number.isInteger(c)).toBe(true);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(0xffffff);
    for (const ch of [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]) {
      expect(ch).toBeGreaterThanOrEqual(0);
      expect(ch).toBeLessThanOrEqual(255);
    }
  }

  it('mixHex endpoints are exact and t is clamped', () => {
    expect(mixHex(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mixHex(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(mixHex(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixHex(0x123456, 0xabcdef, -5)).toBe(0x123456); // clamp low → a
    expect(mixHex(0x123456, 0xabcdef, 5)).toBe(0xabcdef); // clamp high → b
  });

  it('every adjacent biome pair lerps to valid colours across the whole blend', () => {
    for (let from = 0; from < N; from++) {
      const to = (from + 1) % N;
      const a = BIOMES[from];
      const b = BIOMES[to];
      for (let t = 0; t <= 1.00001; t += 0.05) {
        assertValidHex(mixHex(a.gridCenter, b.gridCenter, t));
        assertValidHex(mixHex(a.gridLine, b.gridLine, t));
        assertValidHex(mixHex(a.fog, b.fog, t));
        assertValidHex(mixHex(a.mountain, b.mountain, t));
        // Gradient stops: same count + `at` positions across biomes.
        expect(a.gradient.length).toBe(b.gradient.length);
        for (let i = 0; i < a.gradient.length; i++) {
          expect(a.gradient[i].at).toBeCloseTo(b.gradient[i].at);
          assertValidHex(
            mixHex(parseInt(a.gradient[i].color.slice(1), 16), parseInt(b.gradient[i].color.slice(1), 16), t),
          );
        }
      }
    }
  });
});

describe('Biome — integrates with the run without breaking pools (bounded) or NaN', () => {
  it('a long run advances biomes while traffic + pickup pools stay bounded', () => {
    const game = startRun(createGameState(1234));
    const intent = createIntent();
    const biomesSeen = new Set<number>();
    for (let i = 0; i < 60 * 90; i++) {
      // Keep i-frames topped up so the run can't end — this test is about pools +
      // biome progression across a LONG distance, not dodging skill.
      game.powerups.effects.invulnTimer = 1;
      update(game, intent, TIMESTEP);
      biomesSeen.add(game.biome.from);
      // Pools never grow; active counts bounded by their pool sizes.
      expect(game.traffic.pool.length).toBe(TRAFFIC.poolSize);
      expect(activeObstacleCount(game.traffic)).toBeLessThanOrEqual(TRAFFIC.poolSize);
      expect(game.powerups.pool.length).toBe(POWERUPS.poolSize);
      expect(activePickupCount(game.powerups)).toBeLessThanOrEqual(POWERUPS.poolSize);
      // Biome state stays finite + valid.
      expect(Number.isFinite(game.biome.blend)).toBe(true);
      expect(game.biome.from).toBeLessThan(N);
      if (game.phase !== Phase.Playing) break;
    }
    // The run should have travelled far enough to reach at least the 2nd biome.
    expect(game.distance).toBeGreaterThan(SPAN);
    expect(biomesSeen.size).toBeGreaterThanOrEqual(2);
  });
});
