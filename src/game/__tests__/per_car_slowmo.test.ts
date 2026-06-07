/**
 * PER-CAR SLOW-MO identity (drift→slow-mo PR2). Slow-mo varies per car on two
 * axes — bank CAP and STRENGTH (timeScale) — as a tradeoff OPPOSED to agility
 * (handling.lateralFriction). These tests pin: the per-car cap gates banking, the
 * per-car strength applies on deploy, Pulse is the untouched baseline, the stats
 * flow from the selected car into the run, and the no-dominance invariant holds
 * (no car is high on BOTH agility and slow-mo). Pure — no three, no DOM.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, GameMode, startRun, update } from '../GameState';
import { createIntent } from '../Input';
import {
  createPowerupEffects,
  createPowerupState,
  deploySlowMo,
  grantPowerup,
  powerupTimeScale,
} from '../Powerups';
import {
  BASE_SLOWMO,
  CARS,
  handlingFor,
  POWERUPS,
  POWERUP_DEFS,
  PowerupKind,
  slowMoFor,
  TIMESTEP,
} from '../../utils/constants';

describe('per-car slow-mo — Pulse is the neutral baseline', () => {
  it('Pulse resolves to the exact uniform PR1 baseline (cap 3, half-speed)', () => {
    expect(slowMoFor('pulse')).toEqual(BASE_SLOWMO);
    expect(slowMoFor('pulse').cap).toBe(POWERUPS.slowMoMaxCharges);
    expect(slowMoFor('pulse').timeScale).toBe(POWERUP_DEFS.slowmo.timeScale);
  });

  it('an unknown car id falls back to the baseline (never crashes)', () => {
    expect(slowMoFor('no-such-car')).toEqual(BASE_SLOWMO);
  });

  it('every car defines a finite, sane slow-mo profile', () => {
    for (const car of CARS) {
      const sm = slowMoFor(car.id);
      expect(Number.isInteger(sm.cap)).toBe(true);
      expect(sm.cap).toBeGreaterThanOrEqual(1);
      expect(sm.timeScale).toBeGreaterThan(0);
      expect(sm.timeScale).toBeLessThan(1); // a slow-mo always slows time
      expect(car.slowMoTagline && car.slowMoTagline.length).toBeGreaterThan(0); // legible in the picker
    }
  });
});

describe('per-car slow-mo — the bank CAP gates banking', () => {
  // Bank by granting N slow-mos to a fresh per-car effects state, return the count.
  function bankedAfter(carId: string, grants: number): number {
    const state = createPowerupState(1, slowMoFor(carId));
    for (let i = 0; i < grants; i++) grantPowerup(state.effects, PowerupKind.SlowMo);
    return state.effects.slowMoCharges;
  }

  it('a cap-1 car (Slipstream) can never bank a 2nd charge', () => {
    expect(slowMoFor('slipstream').cap).toBe(1);
    expect(bankedAfter('slipstream', 5)).toBe(1);
  });

  it('a cap-2 car (Ghost) banks 2 but not a 3rd', () => {
    expect(slowMoFor('ghost').cap).toBe(2);
    expect(bankedAfter('ghost', 1)).toBe(1);
    expect(bankedAfter('ghost', 3)).toBe(2); // the 3rd grant is refused
  });

  it('a cap-4 car (Onyx) banks deep — 4, but not a 5th', () => {
    expect(slowMoFor('onyx').cap).toBe(4);
    expect(bankedAfter('onyx', 10)).toBe(4);
  });

  it('the cap flows from the SELECTED car through startRun into the run effects', () => {
    // Ghost (cap 2) selected: a run can only ever bank 2, even after many grants.
    const game = startRun(createGameState(7), handlingFor('ghost'), undefined, 7, undefined, GameMode.Classic, slowMoFor('ghost'));
    expect(game.powerups.effects.slowMoCap).toBe(2);
    for (let i = 0; i < 4; i++) grantPowerup(game.powerups.effects, PowerupKind.SlowMo);
    expect(game.powerups.effects.slowMoCharges).toBe(2);
  });
});

describe('per-car slow-mo — the STRENGTH applies on deploy', () => {
  it('deploy uses the per-car timeScale (lower = stronger slow)', () => {
    const onyx = createPowerupEffects();
    onyx.slowMoCap = slowMoFor('onyx').cap;
    onyx.slowMoTimeScale = slowMoFor('onyx').timeScale;
    onyx.slowMoCharges = 1;
    expect(deploySlowMo(onyx)).toBe(true);
    expect(powerupTimeScale(onyx)).toBe(slowMoFor('onyx').timeScale); // 0.35 — strongest
    expect(powerupTimeScale(onyx)).toBeLessThan(POWERUP_DEFS.slowmo.timeScale); // stronger than baseline

    const slip = createPowerupEffects();
    slip.slowMoTimeScale = slowMoFor('slipstream').timeScale;
    slip.slowMoCharges = 1;
    expect(deploySlowMo(slip)).toBe(true);
    expect(powerupTimeScale(slip)).toBe(slowMoFor('slipstream').timeScale); // 0.70 — mildest
    expect(powerupTimeScale(slip)).toBeGreaterThan(POWERUP_DEFS.slowmo.timeScale); // milder than baseline
  });

  it('the strength flows into the run and slows the sim on deploy (integrated)', () => {
    const game = startRun(createGameState(9), handlingFor('onyx'), undefined, 9, undefined, GameMode.Classic, slowMoFor('onyx'));
    game.powerups.effects.slowMoCharges = 1;
    const intent = createIntent();
    intent.deploySlowMo = true;
    update(game, intent, TIMESTEP);
    expect(game.powerups.effects.slowMoTimer).toBeGreaterThan(0); // a charge deployed
    expect(powerupTimeScale(game.powerups.effects)).toBe(slowMoFor('onyx').timeScale); // per-car strength live
  });
});

describe('per-car slow-mo — no-dominance invariant (vs agility)', () => {
  it('sorted by agility ascending, cap is non-increasing and timeScale non-decreasing', () => {
    // Agility = handling.lateralFriction. The invariant: more agility ALWAYS costs
    // slow-mo (a smaller/equal cap AND a milder/equal — i.e. higher/equal —
    // timeScale), so no car is strong on both axes.
    const rows = CARS.map((c) => ({
      id: c.id,
      agility: handlingFor(c.id).lateralFriction,
      cap: slowMoFor(c.id).cap,
      timeScale: slowMoFor(c.id).timeScale,
    })).sort((a, b) => a.agility - b.agility);

    for (let i = 1; i < rows.length; i++) {
      // cap never INCREASES as agility increases (more agile ⇒ no deeper bank).
      expect(rows[i].cap).toBeLessThanOrEqual(rows[i - 1].cap);
      // timeScale never DECREASES as agility increases (more agile ⇒ no stronger slow).
      expect(rows[i].timeScale).toBeGreaterThanOrEqual(rows[i - 1].timeScale);
    }
  });

  it('the two extremes are genuinely opposed (Slipstream agile/weak-slow vs Onyx planted/strong-slow)', () => {
    const slip = { agility: handlingFor('slipstream').lateralFriction, sm: slowMoFor('slipstream') };
    const onyx = { agility: handlingFor('onyx').lateralFriction, sm: slowMoFor('onyx') };
    // Slipstream: most agile, weakest slow-mo (smallest cap, mildest slow).
    expect(slip.agility).toBeGreaterThan(onyx.agility);
    expect(slip.sm.cap).toBeLessThan(onyx.sm.cap);
    expect(slip.sm.timeScale).toBeGreaterThan(onyx.sm.timeScale);
  });
});
