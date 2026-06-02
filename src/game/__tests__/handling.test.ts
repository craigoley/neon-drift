/**
 * Per-car handling — BEHAVIORAL tests. "Feel" can't be asserted, and this PR
 * auto-merges, so these pin the actual tradeoffs: each car must measurably win
 * its axis and lose another. If a later tweak makes a car strictly dominant on a
 * tested axis, one of these should fail.
 *
 * The old handbrake-drift mechanic is gone (PR: drift→banked slow-mo); the former
 * per-car `drift` stat was folded into `lateralFriction` (the looseness/AGILITY
 * lever), so the loose cars still slide further. The three picker bars now map
 * 1:1 to the levers: Speed=speedCap, Grip=lateralAccel, Agility=lateralFriction.
 */
import { describe, expect, it } from 'vitest';
import { createVehicleState, updateVehicle, type VehicleState } from '../Vehicle';
import { createIntent, type InputIntent } from '../Input';
import {
  BASE_HANDLING,
  carStats,
  handlingFor,
  CARS,
  TIMESTEP,
  type CarHandling,
} from '../../utils/constants';

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
const ghost = handlingFor('ghost'); // looseness specialist (slidiest tail)

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

describe('Handling — agility (looseness) axis', () => {
  it('the loose car (Ghost) carries a slide further than a planted car (Vapor)', () => {
    // Same initial sideways velocity, then coast with no steer — the looser tail
    // (higher lateralFriction) retains more lateral velocity and travels further.
    const g = drive(ghost, { steer: 0 }, 15, 0, { lateralVel: 15 });
    const v = drive(vapor, { steer: 0 }, 15, 0, { lateralVel: 15 });
    expect(g.lateral).toBeGreaterThan(v.lateral); // travelled further sideways
    expect(g.lateralVel).toBeGreaterThan(v.lateralVel); // retained more slide
  });
});

describe('Handling — fallback to base', () => {
  it('an unknown car id resolves to BASE_HANDLING (all 1.0)', () => {
    const h = handlingFor('does-not-exist');
    expect(h).toEqual(BASE_HANDLING);
    expect(h).toEqual({ speedCap: 1, lateralAccel: 1, lateralFriction: 1 });
  });

  it('BASE_HANDLING produces behaviour identical to explicit 1.0× multipliers (pre-stats base)', () => {
    const intent = { steer: 0.6 };
    const fallback = drive(handlingFor('does-not-exist'), intent, 200, 1000);
    const explicitOnes = drive(
      { speedCap: 1, lateralAccel: 1, lateralFriction: 1 },
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
    { speedCap: 1000, lateralAccel: 1000, lateralFriction: 1000 },
    { speedCap: 0, lateralAccel: 0, lateralFriction: 0 },
  ];

  it('every profile keeps speed and lateral state finite under varied input', () => {
    for (const h of profiles) {
      const v = createVehicleState();
      const intent = createIntent();
      for (let n = 0; n < 2000; n++) {
        // Deterministic but varied steering.
        intent.steer = Math.sin(n * 0.21);
        updateVehicle(v, intent, n * 5, 0, h, TIMESTEP);
        expect(Number.isFinite(v.speed)).toBe(true);
        expect(Number.isFinite(v.lateral)).toBe(true);
        expect(Number.isFinite(v.lateralVel)).toBe(true);
      }
    }
  });
});

describe('Car picker stats — single source of truth (carStats)', () => {
  it('bars are derived from the handling multipliers (a number change moves the bar)', () => {
    const base = carStats(BASE_HANDLING);
    expect(carStats({ ...BASE_HANDLING, speedCap: 1.25 }).speed).toBeGreaterThan(base.speed);
    expect(carStats({ ...BASE_HANDLING, lateralAccel: 1.4 }).grip).toBeGreaterThan(base.grip);
    // Higher retained friction = looser tail = higher agility bar.
    expect(carStats({ ...BASE_HANDLING, lateralFriction: 1.5 }).agility).toBeGreaterThan(base.agility);
  });

  it('every car bar is within 0..1', () => {
    for (const c of CARS) {
      const s = carStats(handlingFor(c.id));
      for (const v of [s.speed, s.grip, s.agility]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the roster bars read as the intended triangle', () => {
    const s = (id: string) => carStats(handlingFor(id));
    expect(s('ember').speed).toBeGreaterThan(s('vapor').speed); // EMBER fastest
    expect(s('vapor').grip).toBeGreaterThan(s('ember').grip); // VAPOR grippiest
    expect(s('ghost').agility).toBeGreaterThan(s('vapor').agility); // GHOST loosest
  });
});

describe('Handling — new roster cars are distinct (roster expansion)', () => {
  const nova = handlingFor('nova'); // glass cannon
  const onyx = handlingFor('onyx'); // surgical grip
  const slip = handlingFor('slipstream'); // rally hybrid

  it('Nova has the highest top speed of the whole roster (glass cannon)', () => {
    const top = (h: CarHandling) => drive(h, {}, 4000, 1e9).speed;
    const novaTop = top(nova);
    for (const c of CARS) {
      if (c.id === 'nova') continue;
      expect(novaTop).toBeGreaterThan(top(handlingFor(c.id)));
    }
  });

  it('Onyx changes lanes the fastest of the whole roster (grip extreme)', () => {
    const reach = (h: CarHandling) => Math.abs(drive(h, { steer: 1 }, 16).lateral);
    const onyxReach = reach(onyx);
    for (const c of CARS) {
      if (c.id === 'onyx') continue;
      expect(onyxReach).toBeGreaterThan(reach(handlingFor(c.id)));
    }
  });

  it('Slipstream is a fast slider: faster than Ghost, slides further than Ember', () => {
    const top = (h: CarHandling) => drive(h, {}, 4000, 1e9).speed;
    expect(top(slip)).toBeGreaterThan(top(handlingFor('ghost')));
    const slide = (h: CarHandling) => drive(h, { steer: 0 }, 15, 0, { lateralVel: 15 }).lateral;
    expect(slide(slip)).toBeGreaterThan(slide(handlingFor('ember')));
  });

  it('the new extremes lead their picker bars (distinct, not pegged); Onyx out-grips Vapor but tops out slower', () => {
    // CAR_STAT_RANGE spans the roster so the extremes don't clamp to a shared
    // rail — bars stay DISTINCT (the legibility goal). Assert leadership + the
    // in-range ordering rather than exact saturation.
    const speeds = CARS.map((c) => carStats(handlingFor(c.id)).speed);
    const grips = CARS.map((c) => carStats(handlingFor(c.id)).grip);
    expect(carStats(nova).speed).toBe(Math.max(...speeds)); // fastest of the roster
    expect(carStats(onyx).grip).toBe(Math.max(...grips)); // grippiest of the roster
    expect(carStats(nova).speed).toBeLessThanOrEqual(1); // in range, not over-pegged
    expect(carStats(onyx).grip).toBeGreaterThan(carStats(vapor).grip);
    expect(drive(onyx, {}, 4000, 1e9).speed).toBeLessThan(drive(vapor, {}, 4000, 1e9).speed);
  });
});
