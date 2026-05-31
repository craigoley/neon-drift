import { describe, expect, it } from 'vitest';
import {
  createScoreState,
  integrateScore,
  isCollision,
  registerNearMiss,
  resetCombo,
  resolveTraffic,
} from '../Scoring';
import { createTrafficState, type Obstacle } from '../Traffic';
import { CAR_VIS, SCORING, VEHICLE, TRAFFIC } from '../../utils/constants';

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

describe('Scoring — hitbox matches the rendered car (Phase 3)', () => {
  it('the collision box equals the rendered car footprint — what you see is what hits', () => {
    expect(CAR_VIS.width).toBeCloseTo(VEHICLE.halfWidth * 2);
    expect(CAR_VIS.length).toBeCloseTo(VEHICLE.halfLength * 2);
  });

  it('contact at the rendered car edge collides; a sliver beyond does not', () => {
    // Edge-to-edge lateral contact occurs at gap = car halfWidth + obstacle
    // halfWidth; the rendered car edge sits at exactly VEHICLE.halfWidth.
    const touch = VEHICLE.halfWidth + TRAFFIC.halfWidth;
    expect(isCollision(0, 100, obstacleAt(touch - 0.05, 100))).toBe(true);
    expect(isCollision(0, 100, obstacleAt(touch + 0.05, 100))).toBe(false);
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

  it('a normal-berth close pass (5.5 units) bumps the combo', () => {
    // Pins Phase-1 (pass 2): a pass at a normal dodging distance must register,
    // so the multiplier engages in ordinary play. This fails if nearMissLateral
    // regresses below 5.5 (e.g. back to the old 4.8 that only rewarded experts).
    const s = createScoreState();
    const traffic = createTrafficState();
    const slot = traffic.pool[0];
    slot.active = true;
    slot.lateral = 5.5; // clear of the 2.2 collision box; a real near-miss
    slot.laneOffset = 5.5;
    slot.distance = 99; // just behind the player at 100
    slot.passed = false;
    const events = { crashed: false, nearMisses: 0 };
    const before = s.combo;
    resolveTraffic(events, s, 0, 100, traffic);
    expect(events.crashed).toBe(false);
    expect(events.nearMisses).toBe(1);
    expect(s.combo).toBeGreaterThan(before);
  });
});

describe('Scoring — peak combo (WIPEOUT display)', () => {
  it('tracks the highest combo reached and survives the crash reset', () => {
    const s = createScoreState();
    expect(s.peakCombo).toBe(SCORING.baseCombo);
    registerNearMiss(s);
    registerNearMiss(s);
    registerNearMiss(s);
    const peak = s.combo;
    expect(s.peakCombo).toBeCloseTo(peak);
    expect(peak).toBeGreaterThan(1);

    // Crash resets the live combo but the peak is retained for the wipeout screen.
    resetCombo(s);
    expect(s.combo).toBe(SCORING.baseCombo);
    expect(s.peakCombo).toBeCloseTo(peak);
  });

  it('peak never drops as the live combo decays', () => {
    const s = createScoreState();
    registerNearMiss(s); // combo 1.5, peak 1.5
    const peak = s.peakCombo;
    for (let i = 0; i < 1000; i++) integrateScore(s, 100, 1 / 60); // combo decays to 1
    expect(s.combo).toBe(SCORING.baseCombo);
    expect(s.peakCombo).toBeCloseTo(peak);
  });
});

describe('Scoring — full near-miss funnel (regression: combo must climb)', () => {
  it('an obstacle passing within threshold increments near-miss count AND raises the combo', () => {
    const s = createScoreState();
    const traffic = createTrafficState();
    const o = traffic.pool[0];
    o.active = true;
    o.passed = false;
    o.lateral = SCORING.nearMissLateral - 0.5; // inside the near-miss window
    o.laneOffset = o.lateral;
    o.distance = 99; // just behind the player at 100 — a fresh overtake
    const events = { crashed: false, nearMisses: 0 };
    const comboBefore = s.combo;

    resolveTraffic(events, s, 0, 100, traffic);

    // Detection (step 4) AND increment (step 5) — the two that the symptom
    // claimed were broken. If either regresses, this fails.
    expect(events.nearMisses).toBe(1);
    expect(s.nearMisses).toBe(1);
    expect(s.combo).toBeGreaterThan(comboBefore);
    // Diagnostics surfaced in the ?debug=1 funnel panel.
    expect((events as { evaluated?: number }).evaluated).toBe(1);
    expect((events as { closestLateral?: number }).closestLateral).toBeCloseTo(o.lateral);
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
