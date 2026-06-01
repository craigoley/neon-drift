import { describe, expect, it } from 'vitest';
import { speedCap } from '../Vehicle';
import { spawnInterval } from '../Traffic';
import { TRAFFIC, VEHICLE } from '../../utils/constants';

/**
 * These PIN the difficulty curve so it can't silently flatten back to the old
 * "runs forever" tuning. They assert both the curve SHAPE (behavioural) and the
 * key constants (guards), so either kind of regression trips a test.
 */
describe('Difficulty — speed ramp escalates (and stays gentle at the very start)', () => {
  it('starts at the base cap and rises monotonically with distance', () => {
    expect(speedCap(0)).toBeCloseTo(VEHICLE.baseSpeedCap);
    const samples = [0, 1000, 3000, 6000, 12000].map(speedCap);
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThan(samples[i - 1]);
  });

  it('reaches genuinely fast, reaction-testing speed by mid-run', () => {
    // By ~one ramp-distance the car is already well into the upper range; by
    // ~6000m it is near top speed. These pin the STEEP ramp.
    expect(speedCap(3200)).toBeGreaterThanOrEqual(185);
    expect(speedCap(6000)).toBeGreaterThanOrEqual(235);
    // Exponential-approach shape: ~86% of the span by 2 ramp-distances.
    const span = VEHICLE.maxSpeedCap - VEHICLE.baseSpeedCap;
    expect(speedCap(2 * VEHICLE.speedCapRampDistance)).toBeGreaterThanOrEqual(VEHICLE.baseSpeedCap + 0.85 * span);
  });

  it('anti-flatten guards: the ramp can never be slowed back to the old curve', () => {
    expect(VEHICLE.speedCapRampDistance).toBeLessThanOrEqual(3500); // was 6000
    expect(VEHICLE.maxSpeedCap).toBeGreaterThanOrEqual(270); // was 240
    expect(VEHICLE.acceleration).toBeGreaterThanOrEqual(22); // was 18
  });
});

describe('Difficulty — spawn density ramps hard after the grace period', () => {
  it('holds the base interval through the grace, then tightens monotonically', () => {
    expect(spawnInterval(0)).toBeCloseTo(TRAFFIC.baseSpawnInterval);
    expect(spawnInterval(TRAFFIC.rampStartDistance)).toBeCloseTo(TRAFFIC.baseSpawnInterval);
    const samples = [TRAFFIC.rampStartDistance, 2000, 3500, 5000].map(spawnInterval);
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThanOrEqual(samples[i - 1]);
  });

  it('reaches its dense floor while a run is still going (≈4500m, not ~11000m)', () => {
    expect(spawnInterval(5000)).toBeCloseTo(TRAFFIC.minSpawnInterval);
    // Meaningfully denser than the start by mid-run.
    expect(spawnInterval(3000)).toBeLessThan(TRAFFIC.baseSpawnInterval * 0.6);
  });

  it('anti-flatten guards: the density ramp + floor can never regress', () => {
    expect(TRAFFIC.spawnRampPerUnit).toBeGreaterThanOrEqual(0.00025); // was 0.0001
    expect(TRAFFIC.minSpawnInterval).toBeLessThanOrEqual(0.32); // was 0.35
  });
});
