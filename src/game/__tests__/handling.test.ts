import { describe, expect, it } from 'vitest';
import { createVehicleState, updateVehicle } from '../Vehicle';
import { createIntent, type InputIntent } from '../Input';
import {
  BASE_HANDLING,
  carStats,
  handlingFor,
  TIMESTEP,
  type CarHandling,
} from '../../utils/constants';

/** Drive a fresh car for `steps` under fixed input; return its final state. */
function drive(
  handling: CarHandling,
  opts: { steer?: number; handbrake?: boolean; distance?: number; steps: number },
) {
  const v = createVehicleState();
  const intent: InputIntent = createIntent();
  intent.steer = opts.steer ?? 0;
  intent.handbrake = opts.handbrake ?? false;
  // roadCenter 0 → corridor is [-halfWidth, +halfWidth]; keep slides under it.
  for (let i = 0; i < opts.steps; i++) {
    updateVehicle(v, intent, opts.distance ?? 0, 0, handling, TIMESTEP);
  }
  return v;
}

describe('Vehicle — per-car handling tradeoffs (behavioral)', () => {
  it('top-speed car (COMET) reaches a higher max speed than the high-grip car (VIPER)', () => {
    // Big distance so the speed cap is near its ceiling for both.
    const comet = drive(handlingFor('comet'), { distance: 1e6, steps: 3000 });
    const viper = drive(handlingFor('viper'), { distance: 1e6, steps: 3000 });
    expect(comet.speed).toBeGreaterThan(viper.speed);
  });

  it('high-grip car (VIPER) changes lateral position faster than the low-grip car (COMET)', () => {
    const viper = drive(handlingFor('viper'), { steer: 1, steps: 20 });
    const comet = drive(handlingFor('comet'), { steer: 1, steps: 20 });
    expect(viper.lateral).toBeGreaterThan(comet.lateral);
  });

  it('high-grip car settles a sideways slide quicker than the low-grip car', () => {
    const settle = (h: CarHandling) => {
      const v = createVehicleState();
      v.lateralVel = 10;
      const intent = createIntent(); // steer 0, no handbrake — normal grip
      for (let i = 0; i < 30; i++) updateVehicle(v, intent, 0, 0, h, TIMESTEP);
      return Math.abs(v.lateralVel); // lower = settled faster
    };
    expect(settle(handlingFor('viper'))).toBeLessThan(settle(handlingFor('comet')));
  });

  it('drift car (SLITHER) slides further under handbrake than the grippy car (VIPER)', () => {
    const coast = (h: CarHandling) => {
      const v = createVehicleState();
      v.lateralVel = 5; // same initial sideways slide for both
      const intent = createIntent();
      intent.handbrake = true; // drift multiplier governs the retained slide
      for (let i = 0; i < 50; i++) updateVehicle(v, intent, 0, 0, h, TIMESTEP);
      return v.lateral; // started at 0
    };
    expect(coast(handlingFor('drift'))).toBeGreaterThan(coast(handlingFor('viper')));
  });

  it('unknown / missing id falls back to base behaviour (1.0x), identical to BASE_HANDLING', () => {
    const unknown = drive(handlingFor('does-not-exist'), { steer: 1, distance: 5000, steps: 200 });
    const base = drive(BASE_HANDLING, { steer: 1, distance: 5000, steps: 200 });
    expect(handlingFor('does-not-exist')).toEqual(BASE_HANDLING);
    expect(unknown.speed).toBeCloseTo(base.speed);
    expect(unknown.lateral).toBeCloseTo(base.lateral);
  });

  it('no car handling produces NaN / Infinity (even with extreme drift + handbrake)', () => {
    const ids = ['ghost', 'viper', 'comet', 'drift', 'unknown'];
    for (const id of ids) {
      const h = handlingFor(id);
      const v = drive(h, { steer: 1, handbrake: true, distance: 1e6, steps: 2000 });
      expect(Number.isFinite(v.speed)).toBe(true);
      expect(Number.isFinite(v.lateral)).toBe(true);
      expect(Number.isFinite(v.lateralVel)).toBe(true);
    }
  });
});

describe('Car picker stats — single source of truth', () => {
  it('bars are derived from the handling multipliers (a number change moves the bar)', () => {
    const base = carStats(BASE_HANDLING);
    expect(carStats({ ...BASE_HANDLING, speedCap: 1.25 }).speed).toBeGreaterThan(base.speed);
    expect(carStats({ ...BASE_HANDLING, drift: 1.5 }).drift).toBeGreaterThan(base.drift);
    expect(carStats({ ...BASE_HANDLING, lateralAccel: 1.4 }).grip).toBeGreaterThan(base.grip);
    // Lower friction = grippier = higher grip bar.
    expect(carStats({ ...BASE_HANDLING, lateralFriction: 0.6 }).grip).toBeGreaterThan(base.grip);
  });

  it('all stat bars are within 0..1', () => {
    for (const id of ['ghost', 'viper', 'comet', 'drift']) {
      const s = carStats(handlingFor(id));
      for (const v of [s.speed, s.grip, s.drift]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the roster reads as the intended triangle', () => {
    const s = (id: string) => carStats(handlingFor(id));
    expect(s('comet').speed).toBeGreaterThan(s('viper').speed); // COMET fastest
    expect(s('viper').grip).toBeGreaterThan(s('comet').grip); // VIPER grippiest
    expect(s('drift').drift).toBeGreaterThan(s('viper').drift); // SLITHER driftiest
  });
});
