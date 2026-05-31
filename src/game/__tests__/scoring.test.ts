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
  return { active: true, id: 1, lateral, laneOffset: lateral, sway: 0, swayPhase: 0, distance, speed: 0, passed: false };
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
    const events = { crashed: false, nearMisses: 0 };
    resolveTraffic(events, s, 0, 100, traffic);
    expect(events.crashed).toBe(false);
    expect(events.nearMisses).toBe(1);
    expect(s.combo).toBeGreaterThan(SCORING.baseCombo);
    expect(slot.passed).toBe(true);
  });
});

describe('Scoring — combo multiplier actually changes the score', () => {
  // Regression guard for the Phase-1 bug: score tracked raw distance exactly
  // (combo never multiplied in / never fired), so daring play scored the same
  // as cruising. These tests fail if the multiplier stops affecting score.

  it('a run with no near-misses scores exactly distance * baseCombo', () => {
    const s = createScoreState();
    const speed = 120;
    const dt = 1 / 60;
    let distance = 0;
    for (let i = 0; i < 600; i++) {
      integrateScore(s, speed, dt);
      distance += speed * dt;
    }
    expect(s.score).toBeCloseTo(distance * SCORING.distanceFactor * SCORING.baseCombo);
  });

  it('the same run with near-misses scores strictly higher than distance alone', () => {
    const speed = 120;
    const dt = 1 / 60;

    const cruise = createScoreState();
    const daring = createScoreState();
    let distance = 0;
    for (let i = 0; i < 600; i++) {
      // A near-miss every ~0.5s keeps the combo alive on the daring run only.
      if (i % 30 === 0) registerNearMiss(daring);
      integrateScore(cruise, speed, dt);
      integrateScore(daring, speed, dt);
      distance += speed * dt;
    }
    expect(cruise.score).toBeCloseTo(distance * SCORING.distanceFactor * SCORING.baseCombo);
    // If the combo weren't multiplied into the score these would be equal.
    expect(daring.score).toBeGreaterThan(cruise.score * 1.5);
    expect(daring.combo).toBeGreaterThan(SCORING.baseCombo);
  });
});

describe('Scoring — near-miss window is generous enough to fire', () => {
  const collideGap = VEHICLE.halfWidth + TRAFFIC.halfWidth;

  it('the near-miss window is meaningfully wider than the collision box', () => {
    // The original 3.2 window was barely 1 unit past the 2.2 collision gap, so
    // passes almost never landed in it. Guard against regressing that tight.
    expect(SCORING.nearMissLateral - collideGap).toBeGreaterThanOrEqual(2);
  });

  it('a realistic close dodge (1.5 units of clear lateral space) counts as a near-miss', () => {
    const s = createScoreState();
    const traffic = createTrafficState();
    const slot = traffic.pool[0];
    slot.active = true;
    slot.lateral = collideGap + 1.5; // 3.7 — a near-miss under 4.8, NOT under the old 3.2
    slot.distance = 99;
    slot.passed = false;
    const events = { crashed: false, nearMisses: 0 };
    resolveTraffic(events, s, 0, 100, traffic);
    expect(events.crashed).toBe(false);
    expect(events.nearMisses).toBe(1);
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
