import { describe, expect, it } from 'vitest';
import { speedCap } from '../Vehicle';
import { spawnInterval } from '../Traffic';
import { TRAFFIC, VEHICLE } from '../../utils/constants';

/**
 * These PIN the rebalanced difficulty curve so it can't silently drift to EITHER
 * extreme: the old "runs forever" too-easy plateau, OR the overshoot that made
 * the game impossible by ~30s (density floor 0.3s ≈ 3.3 dodges/sec at ~230 u/s).
 * Both the curve SHAPE (behavioural) and the key constants (band guards) are
 * asserted, so a regression in either direction trips a test.
 */
describe('Difficulty — speed ramp: gentle early, fast eventually (not by 45s)', () => {
  it('starts at the base cap and rises monotonically with distance', () => {
    expect(speedCap(0)).toBeCloseTo(VEHICLE.baseSpeedCap);
    const samples = [0, 1000, 3000, 6000, 12000].map(speedCap);
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThan(samples[i - 1]);
  });

  it('is gentle early, then approaches top speed over minutes', () => {
    const span = VEHICLE.maxSpeedCap - VEHICLE.baseSpeedCap;
    // Gentle through the early learning phase (≈first 2000m): NOT already fast.
    expect(speedCap(2000)).toBeLessThan(VEHICLE.baseSpeedCap + 0.5 * span);
    // Exponential-approach shape: ~85% of the span by 2 ramp-distances...
    expect(speedCap(2 * VEHICLE.speedCapRampDistance)).toBeGreaterThanOrEqual(VEHICLE.baseSpeedCap + 0.85 * span);
    // ...and near the top deep into a long run.
    expect(speedCap(20000)).toBeGreaterThan(VEHICLE.baseSpeedCap + 0.9 * span);
  });

  it('band guards: top speed and ramp stay between the two prior extremes', () => {
    // Not the impossible overshoot (280 / 3200), not the too-easy plateau (240 / 6000).
    expect(VEHICLE.maxSpeedCap).toBeGreaterThanOrEqual(210);
    expect(VEHICLE.maxSpeedCap).toBeLessThanOrEqual(250);
    expect(VEHICLE.speedCapRampDistance).toBeGreaterThanOrEqual(4500); // not re-steepened
    expect(VEHICLE.speedCapRampDistance).toBeLessThanOrEqual(6000); // not flattened
    expect(VEHICLE.acceleration).toBeGreaterThanOrEqual(16);
    expect(VEHICLE.acceleration).toBeLessThanOrEqual(22);
  });
});

describe('Difficulty — spawn density: steady escalation, survivable floor', () => {
  it('holds the base interval through the grace, then tightens monotonically', () => {
    expect(spawnInterval(0)).toBeCloseTo(TRAFFIC.baseSpawnInterval);
    expect(spawnInterval(TRAFFIC.rampStartDistance)).toBeCloseTo(TRAFFIC.baseSpawnInterval);
    const samples = [TRAFFIC.rampStartDistance, 2000, 3500, 5000].map(spawnInterval);
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThanOrEqual(samples[i - 1]);
  });

  it('reaches its floor LATE (over minutes), not in the first ~30s', () => {
    // The diagnosed overshoot floored by ~4500m. Pin that the floor is NOT
    // reached by 5000m...
    expect(spawnInterval(5000)).toBeGreaterThan(TRAFFIC.minSpawnInterval + 0.1);
    // ...but the escalation does continue all the way to the floor eventually.
    expect(spawnInterval(13000)).toBeCloseTo(TRAFFIC.minSpawnInterval);
    // Still gentle mid-early (a fair learning ramp).
    expect(spawnInterval(3000)).toBeGreaterThan(TRAFFIC.baseSpawnInterval * 0.8);
  });

  it('band guards: density ramp + floor stay between the two prior extremes', () => {
    // Not the impossible 0.0003 ramp / 0.3 floor (≈3.3 dodges/sec), not the
    // too-easy 0.0001 ramp.
    expect(TRAFFIC.spawnRampPerUnit).toBeGreaterThanOrEqual(0.00004);
    expect(TRAFFIC.spawnRampPerUnit).toBeLessThanOrEqual(0.00012);
    // Floor stays survivable: never back to the undodgeable 0.3s.
    expect(TRAFFIC.minSpawnInterval).toBeGreaterThanOrEqual(0.55);
    expect(TRAFFIC.minSpawnInterval).toBeLessThanOrEqual(0.8);
  });
});
