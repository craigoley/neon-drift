import { describe, expect, it } from 'vitest';
import {
  activeObstacleCount,
  createTrafficState,
  spawnInterval,
  updateTraffic,
} from '../Traffic';
import { Rng } from '../../utils/rng';
import { ROAD, TIMESTEP, TRAFFIC } from '../../utils/constants';

describe('Traffic — recycled pool stays bounded', () => {
  it('pool length is fixed and active count never exceeds poolSize', () => {
    const traffic = createTrafficState();
    const seed = 123;
    const rng = new Rng(seed);
    let distance = 0;
    const speed = 120;
    for (let step = 0; step < 20000; step++) {
      distance += speed * TIMESTEP;
      updateTraffic(traffic, rng, seed, distance, TIMESTEP);
      expect(traffic.pool.length).toBe(TRAFFIC.poolSize);
      expect(activeObstacleCount(traffic)).toBeLessThanOrEqual(TRAFFIC.poolSize);
    }
    // Plenty spawned and culled, but the pool array never grew.
    expect(traffic.spawned).toBeGreaterThan(50);
    expect(traffic.culled).toBeGreaterThan(50);
  });

  it('spawn interval shrinks with distance toward the floor', () => {
    expect(spawnInterval(0)).toBeCloseTo(TRAFFIC.baseSpawnInterval);
    expect(spawnInterval(1e9)).toBeCloseTo(TRAFFIC.minSpawnInterval);
    expect(spawnInterval(5000)).toBeLessThan(spawnInterval(0));
  });

  it('difficulty ramp is flat through the grace period, then escalates', () => {
    // First ~15s (rampStartDistance) holds the base interval so the player can learn.
    expect(spawnInterval(TRAFFIC.rampStartDistance - 1)).toBeCloseTo(TRAFFIC.baseSpawnInterval);
    expect(spawnInterval(TRAFFIC.rampStartDistance)).toBeCloseTo(TRAFFIC.baseSpawnInterval);
    // Past the grace it strictly tightens.
    expect(spawnInterval(TRAFFIC.rampStartDistance + 2000)).toBeLessThan(TRAFFIC.baseSpawnInterval);
  });
});

describe('Traffic — lane-changing movers', () => {
  it('spawns a mix of static and swaying obstacles, all on the road, movers within amplitude', () => {
    const traffic = createTrafficState();
    const seed = 777;
    const rng = new Rng(seed);
    let distance = 0;
    const speed = 120;
    let movers = 0;
    let statics = 0;
    for (let step = 0; step < 8000; step++) {
      distance += speed * TIMESTEP;
      updateTraffic(traffic, rng, seed, distance, TIMESTEP);
      for (const o of traffic.pool) {
        if (!o.active) continue;
        // Curve-relative spawn keeps every obstacle on the drivable road.
        expect(Math.abs(o.baseLateral)).toBeLessThanOrEqual(ROAD.halfWidth + 1e-9);
        // A mover never strays further than its amplitude from its lane centre.
        expect(Math.abs(o.lateral - o.baseLateral)).toBeLessThanOrEqual(o.sway + 1e-9);
        if (o.sway > 0) movers++;
        else statics++;
      }
    }
    // Both behaviours occur over a long run (not all-static, not all-movers).
    expect(movers).toBeGreaterThan(0);
    expect(statics).toBeGreaterThan(0);
  });
});
