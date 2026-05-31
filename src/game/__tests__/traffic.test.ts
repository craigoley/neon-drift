import { describe, expect, it } from 'vitest';
import {
  activeObstacleCount,
  createTrafficState,
  spawnInterval,
  updateTraffic,
} from '../Traffic';
import { Rng } from '../../utils/rng';
import { TIMESTEP, TRAFFIC } from '../../utils/constants';

describe('Traffic — recycled pool stays bounded', () => {
  it('pool length is fixed and active count never exceeds poolSize', () => {
    const traffic = createTrafficState();
    const rng = new Rng(123);
    let distance = 0;
    const speed = 120;
    for (let step = 0; step < 20000; step++) {
      distance += speed * TIMESTEP;
      updateTraffic(traffic, rng, distance, TIMESTEP);
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
});
