/**
 * Per-car handling — BEHAVIORAL tests. "Feel" can't be asserted, and this PR
 * auto-merges, so these pin the actual tradeoffs: each car must measurably win
 * its axis and lose another. If a later tweak makes a car strictly dominant on a
 * tested axis, one of these should fail.
 */
import { describe, expect, it } from 'vitest';
import { createVehicleState, updateVehicle, type VehicleState } from '../Vehicle';
import { createIntent, type InputIntent } from '../Input';
import { BASE_HANDLING, handlingFor, CARS, TIMESTEP, type CarHandling } from '../../utils/constants';

/** Drive a fresh vehicle for `steps` frames under fixed intent/distance/handling. */
function drive(
  handling: CarHandling,
  intent: Partial<InputIntent>,
  steps: number,
  distance = 0,
  init: Partial<VehicleState> = {},
): VehicleState {
  const v = { ...createVehicleState(), ...init };
  const i = { ...createIntent(), ...intent };
  for (let n = 0; n < steps; n++) updateVehicle(v, i, distance, 0, handling, TIMESTEP);
  return v;
}

const ember = handlingFor('ember'); // fast / twitchy
const vapor = handlingFor('vapor'); // grip / precise
const ghost = handlingFor('ghost'); // drift specialist

describe('Handling — speed axis', () => {
  it('the high-top-speed car (Ember) outruns the high-grip car (Vapor) over identical time', () => {
    // The vehicle auto-accelerates toward its cap (no accelerate input). Drive
    // far down the road so the cap has ramped near max, long enough that each
    // plateaus at its own (different) cap.
    const e = drive(ember, {}, 1500, 50000);
    const v = drive(vapor, {}, 1500, 50000);
    expect(e.speed).toBeGreaterThan(v.speed);
  });
});

describe('Handling — grip axis', () => {
  it('the high-grip car (Vapor) changes lateral position faster than the low-grip car (Ember)', () => {
    // Short hold so neither pins against the corridor wall.
    const v = drive(vapor, { steer: 1 }, 12);
    const e = drive(ember, { steer: 1 }, 12);
    expect(Math.abs(v.lateral)).toBeGreaterThan(Math.abs(e.lateral));
    expect(Math.abs(v.lateralVel)).toBeGreaterThan(Math.abs(e.lateralVel));
  });
});

describe('Handling — drift axis', () => {
  it('the drift car (Ghost) slides further under handbrake than a non-drift car (Vapor)', () => {
    // Same initial sideways velocity, then handbrake with no steer — compare slide.
    const g = drive(ghost, { handbrake: true }, 15, 0, { lateralVel: 15 });
    const v = drive(vapor, { handbrake: true }, 15, 0, { lateralVel: 15 });
    expect(g.lateral).toBeGreaterThan(v.lateral); // travelled further sideways
    expect(g.lateralVel).toBeGreaterThan(v.lateralVel); // retained more slide
  });
});

describe('Handling — fallback to base', () => {
  it('an unknown car id resolves to BASE_HANDLING (all 1.0)', () => {
    const h = handlingFor('does-not-exist');
    expect(h).toEqual(BASE_HANDLING);
    expect(h).toEqual({ speedCap: 1, lateralAccel: 1, lateralFriction: 1, drift: 1 });
  });

  it('BASE_HANDLING produces behaviour identical to explicit 1.0× multipliers (pre-stats base)', () => {
    const intent = { steer: 0.6, handbrake: false };
    const fallback = drive(handlingFor('does-not-exist'), intent, 200, 1000);
    const explicitOnes = drive(
      { speedCap: 1, lateralAccel: 1, lateralFriction: 1, drift: 1 },
      intent,
      200,
      1000,
    );
    expect(fallback).toEqual(explicitOnes);
  });
});

describe('Handling — numerical safety (no NaN / Infinity)', () => {
  const profiles: CarHandling[] = [
    ...CARS.map((c) => handlingFor(c.id)),
    // Pathological multipliers must not blow up (retained fraction is clamped).
    { speedCap: 1000, lateralAccel: 1000, lateralFriction: 1000, drift: 1000 },
    { speedCap: 0, lateralAccel: 0, lateralFriction: 0, drift: 0 },
  ];

  it('every profile keeps speed and lateral state finite under varied input', () => {
    for (const h of profiles) {
      const v = createVehicleState();
      const intent = createIntent();
      for (let n = 0; n < 2000; n++) {
        // Deterministic but varied steering + intermittent handbrake.
        intent.steer = Math.sin(n * 0.21);
        intent.handbrake = n % 30 < 8;
        updateVehicle(v, intent, n * 5, 0, h, TIMESTEP);
        expect(Number.isFinite(v.speed)).toBe(true);
        expect(Number.isFinite(v.lateral)).toBe(true);
        expect(Number.isFinite(v.lateralVel)).toBe(true);
      }
    }
  });
});
