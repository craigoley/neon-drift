/**
 * Zen free-roam movement model — the keystone MATH (the FEEL is a playtest, but the
 * integration is unit-testable): throttle accelerates along the facing, steering turns
 * the heading and curves the path, friction glides to rest, speed clamps to the cap,
 * and turning has no authority at a standstill.
 */
import { describe, expect, it } from 'vitest';
import { createZenVehicle, updateZen } from '../ZenVehicle';
import { ZEN } from '../../utils/constants';

const TICK = 1 / 60;
/** Drive `frames` ticks at fixed steer/throttle from a fresh vehicle. */
function drive(steer: number, throttle: number, frames: number) {
  const v = createZenVehicle();
  for (let i = 0; i < frames; i++) updateZen(v, steer, throttle, TICK);
  return v;
}

describe('Zen movement — throttle drives along the heading', () => {
  it('full throttle from rest (heading 0) moves FORWARD (-z), not sideways', () => {
    const v = drive(0, 1, 60); // ~1s
    expect(v.speed).toBeGreaterThan(0);
    expect(v.z).toBeLessThan(0); // forward = -z
    expect(Math.abs(v.x)).toBeLessThan(1e-9); // no lateral drift with zero steer
  });

  it('speed never exceeds the calm cap', () => {
    const v = drive(0, 1, 6000); // hold full throttle a long time
    expect(v.speed).toBeLessThanOrEqual(ZEN.maxSpeed + 1e-9);
  });

  it('coasting (no throttle) glides to rest via friction', () => {
    const v = createZenVehicle();
    for (let i = 0; i < 60; i++) updateZen(v, 0, 1, TICK); // get moving
    const moving = v.speed;
    for (let i = 0; i < 600; i++) updateZen(v, 0, 0, TICK); // coast ~10s
    expect(v.speed).toBeLessThan(moving);
    expect(v.speed).toBeLessThan(1); // essentially stopped
  });

  it('braking decelerates faster than coasting', () => {
    const ramp = () => {
      const v = createZenVehicle();
      for (let i = 0; i < 90; i++) updateZen(v, 0, 1, TICK);
      return v;
    };
    const coasted = ramp();
    for (let i = 0; i < 30; i++) updateZen(coasted, 0, 0, TICK);
    const braked = ramp();
    for (let i = 0; i < 30; i++) updateZen(braked, 0, -1, TICK);
    expect(braked.speed).toBeLessThan(coasted.speed);
  });
});

describe('Zen movement — steering turns the heading + curves the path', () => {
  it('steering right while moving increases heading and curves toward +x', () => {
    // A SHORT gentle curve (~0.5s) so the heading stays under a quarter-turn — the car
    // is still moving forward-right (a longer hard turn would loop past 90° and z flips).
    const v = drive(1, 1, 30);
    expect(v.heading).toBeGreaterThan(0); // turned right
    expect(v.x).toBeGreaterThan(0); // curved toward +x (right)
    expect(v.z).toBeLessThan(0); // still net forward (-z) within a sub-90° turn
  });

  it('steering is mirror-symmetric (left curves toward -x)', () => {
    const r = drive(1, 1, 120);
    const l = drive(-1, 1, 120);
    expect(l.heading).toBeCloseTo(-r.heading, 6);
    expect(l.x).toBeCloseTo(-r.x, 6);
    expect(l.z).toBeCloseTo(r.z, 6);
  });

  it('turn authority is ZERO at a standstill (no pivot-in-place)', () => {
    const v = createZenVehicle(); // speed 0
    for (let i = 0; i < 120; i++) updateZen(v, 1, 0, TICK); // full steer, no throttle
    expect(v.heading).toBe(0); // never turned — it never moved
    expect(v.speed).toBe(0);
  });
});

describe('Zen movement — calm tuning sanity', () => {
  it('reaches a modest cruise speed in a second or two (not instant, not racing)', () => {
    const oneSec = drive(0, 1, 60).speed;
    expect(oneSec).toBeGreaterThan(ZEN.maxSpeed * 0.4); // responsive
    expect(oneSec).toBeLessThan(ZEN.maxSpeed + 1e-9); // but bounded
  });
});
