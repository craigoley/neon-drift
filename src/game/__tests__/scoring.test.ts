import { describe, expect, it } from 'vitest';
import {
  createScoreState,
  integrateScore,
  isCollision,
  registerNearMiss,
  resolveTraffic,
} from '../Scoring';
import { createTrafficState, type Obstacle } from '../Traffic';
import { SCORING, VEHICLE, TRAFFIC } from '../../utils/constants';

function obstacleAt(lateral: number, distance: number): Obstacle {
  return { active: true, id: 1, lateral, distance, speed: 0, passed: false };
}

describe('Scoring — collision detection', () => {
  it('detects a collision when boxes overlap (same lane, same distance)', () => {
    expect(isCollision(0, 100, obstacleAt(0, 100))).toBe(true);
  });

  it('no collision when laterally clear', () => {
    const farLateral = VEHICLE.halfWidth + TRAFFIC.halfWidth + 1;
    expect(isCollision(0, 100, obstacleAt(farLateral, 100))).toBe(false);
  });

  it('no collision when far apart in distance', () => {
    const farDistance = 100 + VEHICLE.halfLength + TRAFFIC.halfLength + 1;
    expect(isCollision(0, 100, obstacleAt(0, farDistance))).toBe(false);
  });
});

describe('Scoring — near-miss combo increment', () => {
  it('registerNearMiss bumps the combo by comboStep and refreshes the timer', () => {
    const s = createScoreState();
    const before = s.combo;
    registerNearMiss(s);
    expect(s.combo).toBeCloseTo(before + SCORING.comboStep);
    expect(s.comboTimer).toBeCloseTo(SCORING.comboTimeout);
    expect(s.nearMisses).toBe(1);
  });

  it('caps the combo at maxCombo', () => {
    const s = createScoreState();
    for (let i = 0; i < 1000; i++) registerNearMiss(s);
    expect(s.combo).toBe(SCORING.maxCombo);
  });

  it('a clean pass within the near-miss gap increments the combo, not a crash', () => {
    const s = createScoreState();
    const traffic = createTrafficState();
    // Place an obstacle just behind the player, laterally inside the near-miss
    // gap but outside the collision box.
    const gap = (VEHICLE.halfWidth + TRAFFIC.halfWidth + SCORING.nearMissLateral) / 2;
    const slot = traffic.pool[0];
    slot.active = true;
    slot.lateral = gap;
    slot.distance = 99; // just behind player at 100
    slot.passed = false;
    const events = resolveTraffic(s, 0, 100, traffic);
    expect(events.crashed).toBe(false);
    expect(events.nearMisses).toBe(1);
    expect(s.combo).toBeGreaterThan(SCORING.baseCombo);
    expect(slot.passed).toBe(true);
  });
});

describe('Scoring — score monotonic while moving', () => {
  it('score strictly increases each step at positive speed', () => {
    const s = createScoreState();
    let prev = s.score;
    for (let i = 0; i < 100; i++) {
      integrateScore(s, 120, 1 / 60);
      expect(s.score).toBeGreaterThan(prev);
      prev = s.score;
    }
  });

  it('score does not increase when stationary', () => {
    const s = createScoreState();
    integrateScore(s, 0, 1 / 60);
    expect(s.score).toBe(0);
  });
});
