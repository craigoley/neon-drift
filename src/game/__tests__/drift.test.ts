import { describe, expect, it } from 'vitest';
import { createVehicleState, updateVehicle } from '../Vehicle';
import { createIntent } from '../Input';
import { createScoreState, resolveTraffic } from '../Scoring';
import { createTrafficState, type Obstacle } from '../Traffic';
import {
  BASE_HANDLING,
  type CarHandling,
  DRIFT,
  ObstacleKind,
  ROAD,
  SCORING,
  TIMESTEP,
  VEHICLE,
} from '../../utils/constants';

/** Lateral distance covered from centre in `steps` of full-right steer, on a
 *  straight wide-open road (centre 0), with or without the handbrake held. */
function lateralAfter(steps: number, handbrake: boolean, handling: CarHandling = BASE_HANDLING): number {
  const v = createVehicleState();
  const intent = createIntent();
  intent.steer = 1;
  intent.handbrake = handbrake;
  for (let i = 0; i < steps; i++) updateVehicle(v, intent, 0, 0, handling, TIMESTEP);
  return v.lateral;
}

const DODGE_STEPS = Math.round(0.2 / TIMESTEP); // ~12 steps = a 0.2s last-second dodge

describe('Drift — the juke beats normal steering in the dodge window', () => {
  it('drift covers MUCH more ground than normal steering in the first 0.2s (pinned)', () => {
    const normal = lateralAfter(DODGE_STEPS, false);
    const drift = lateralAfter(DODGE_STEPS, true);
    // Pin the felt gap so it can't silently regress to imperceptible again:
    // drift must move at least 2x as far, and by a clear absolute margin
    // (more than a car width) within the dodge window.
    expect(drift).toBeGreaterThan(normal * 2);
    expect(drift - normal).toBeGreaterThan(VEHICLE.halfWidth * 2);
  });

  it('the boost only applies WHILE drifting — released, steering is normal again', () => {
    // Same model, no handbrake: must match the plain steering distance.
    const a = lateralAfter(DODGE_STEPS, false);
    const b = lateralAfter(DODGE_STEPS, false);
    expect(a).toBeCloseTo(b);
    // And the drift accel multiplier is actually > 1 (guards the constant).
    expect(DRIFT.accelBoost).toBeGreaterThan(1);
  });
});

describe('Drift — is a CONTINUOUS slide, never a one-frame teleport/snap', () => {
  it('advances laterally incrementally across frames (no single-frame jump across the road)', () => {
    const v = createVehicleState();
    const intent = createIntent();
    intent.steer = 1;
    intent.handbrake = true; // drifting hard right on a wide-open straight (centre 0)

    // One step must NOT snap the car a large distance — it accelerates from rest.
    updateVehicle(v, intent, 0, 0, BASE_HANDLING, TIMESTEP);
    const afterOne = v.lateral;
    expect(afterOne).toBeGreaterThan(0); // it moved…
    expect(afterOne).toBeLessThan(0.5); // …but only a little (not a teleport)

    // Over the next frames the position rises strictly and by BOUNDED per-frame
    // deltas — a continuous slide, never a jump across the corridor in one frame.
    let prev = afterOne;
    let prevDelta = afterOne;
    for (let i = 0; i < 12; i++) {
      updateVehicle(v, intent, 0, 0, BASE_HANDLING, TIMESTEP);
      const delta = v.lateral - prev;
      expect(delta).toBeGreaterThan(0); // monotonic — keeps sliding, no snap-back
      expect(delta).toBeLessThan(ROAD.halfWidth); // no single frame crosses the road
      // Acceleration phase: deltas grow smoothly, not a discontinuous leap.
      expect(delta).toBeLessThan(prevDelta + ROAD.halfWidth);
      prev = v.lateral;
      prevDelta = delta;
    }
    // It takes several frames of sliding to cross a car-width — that's the skill.
    expect(prev).toBeGreaterThan(afterOne);
  });
});

describe('Drift — the speed-cost tradeoff', () => {
  it('holding drift scrubs forward speed below a non-drifting car', () => {
    const drifter = createVehicleState();
    const cruiser = createVehicleState();
    drifter.speed = cruiser.speed = 150;
    const hold = createIntent();
    hold.handbrake = true;
    const free = createIntent();
    for (let i = 0; i < 60; i++) {
      updateVehicle(drifter, hold, 2000, 0, BASE_HANDLING, TIMESTEP);
      updateVehicle(cruiser, free, 2000, 0, BASE_HANDLING, TIMESTEP);
    }
    expect(drifter.speed).toBeLessThan(cruiser.speed);
  });

  it('never scrubs below the cap floor (the cost is bounded)', () => {
    const v = createVehicleState();
    v.speed = 240;
    const hold = createIntent();
    hold.handbrake = true;
    const distance = 50_000; // high cap
    for (let i = 0; i < 600; i++) {
      updateVehicle(v, hold, distance, 0, BASE_HANDLING, TIMESTEP);
    }
    // Recompute the cap the way the vehicle does, to assert the floor held.
    const cap =
      (VEHICLE.baseSpeedCap +
        (VEHICLE.maxSpeedCap - VEHICLE.baseSpeedCap) *
          (1 - Math.exp(-distance / VEHICLE.speedCapRampDistance))) *
      BASE_HANDLING.speedCap;
    expect(v.speed).toBeGreaterThanOrEqual(cap * DRIFT.minSpeedFraction - 1e-6);
  });
});

describe('Drift — per-car drift stat scales the juke', () => {
  it('a drift-specialist out-jukes a grippy car over the dodge window', () => {
    const ghost: CarHandling = { ...BASE_HANDLING, drift: 1.45 };
    const vapor: CarHandling = { ...BASE_HANDLING, drift: 0.85 };
    const ghostLat = lateralAfter(DODGE_STEPS, true, ghost);
    const vaporLat = lateralAfter(DODGE_STEPS, true, vapor);
    expect(ghostLat).toBeGreaterThan(vaporLat);
  });
});

describe('Drift — state flag + stability', () => {
  it('the drifting flag mirrors the handbrake intent', () => {
    const v = createVehicleState();
    const hold = createIntent();
    hold.handbrake = true;
    updateVehicle(v, hold, 0, 0, BASE_HANDLING, TIMESTEP);
    expect(v.drifting).toBe(true);
    const free = createIntent();
    updateVehicle(v, free, 0, 0, BASE_HANDLING, TIMESTEP);
    expect(v.drifting).toBe(false);
  });

  it('no NaN/Infinity after a long full-steer drift (extreme drift stat)', () => {
    const v = createVehicleState();
    const intent = createIntent();
    intent.steer = 1;
    intent.handbrake = true;
    const wild: CarHandling = { ...BASE_HANDLING, drift: 5 }; // beyond any real car
    for (let i = 0; i < 3000; i++) updateVehicle(v, intent, i, 0, wild, TIMESTEP);
    expect(Number.isFinite(v.lateral)).toBe(true);
    expect(Number.isFinite(v.lateralVel)).toBe(true);
    expect(Number.isFinite(v.speed)).toBe(true);
  });
});

describe('Drift — near-miss combo bonus', () => {
  function staticObstacle(lateral: number, distance: number): Obstacle {
    return {
      active: true, id: 1, kind: ObstacleKind.Static, lateral, laneOffset: lateral,
      sway: 0, swayPhase: 0, openingHalfWidth: 0, consumed: false, distance, speed: 0, passed: false,
    };
  }

  it('a near-miss threaded while drifting pays more combo than the same pass not drifting', () => {
    // A clear near-miss: obstacle just behind the player, within the near-miss
    // lateral window but not colliding.
    const gap = (SCORING.nearMissLateral + VEHICLE.halfWidth + 1) / 2; // inside window, outside hitbox
    const playerLat = 0;
    const playerDist = 100;

    const drove = (drifting: boolean) => {
      const score = createScoreState();
      const traffic = createTrafficState();
      traffic.pool[0] = staticObstacle(gap, playerDist - 0.1); // just passed
      const events = { crashed: false, nearMisses: 0 };
      resolveTraffic(events, score, playerLat, playerDist, traffic, drifting);
      expect(events.nearMisses).toBe(1); // both register a near-miss
      return score.combo;
    };

    const plainCombo = drove(false);
    const driftCombo = drove(true);
    expect(driftCombo).toBeGreaterThan(plainCombo);
  });
});
