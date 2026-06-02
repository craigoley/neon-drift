/**
 * Banked slow-mo (PR: drift → banked slow-mo). The slow-mo powerup no longer
 * fires on pickup: collecting one BANKS a charge (capped), and the deploy control
 * spends one on demand to start a slow-mo window. The deploy is EDGE-triggered —
 * a single press can only ever spend one charge, even though the fixed-timestep
 * loop runs update() several times per rendered frame (the recon's biggest risk).
 */
import { describe, expect, it } from 'vitest';
import { createGameState, startRun, update } from '../GameState';
import { createIntent } from '../Input';
import {
  createPowerupEffects,
  deploySlowMo,
  grantPowerup,
  powerupTimeScale,
} from '../Powerups';
import { POWERUP_DEFS, POWERUPS, PowerupKind, TIMESTEP } from '../../utils/constants';

describe('Slow-mo bank — collecting banks charges (capped)', () => {
  it('each collected/granted slow-mo adds one charge, capped at the max', () => {
    const fx = createPowerupEffects();
    expect(fx.slowMoCharges).toBe(0);

    grantPowerup(fx, PowerupKind.SlowMo);
    expect(fx.slowMoCharges).toBe(1);
    grantPowerup(fx, PowerupKind.SlowMo);
    expect(fx.slowMoCharges).toBe(2);

    // Collecting beyond the cap never overflows the bank.
    for (let i = 0; i < 10; i++) grantPowerup(fx, PowerupKind.SlowMo);
    expect(fx.slowMoCharges).toBe(POWERUPS.slowMoMaxCharges);
  });

  it('banking does NOT auto-start a slow-mo (no timer until deployed)', () => {
    const fx = createPowerupEffects();
    grantPowerup(fx, PowerupKind.SlowMo);
    expect(fx.slowMoTimer).toBe(0);
    expect(powerupTimeScale(fx)).toBe(1); // normal time — not slowed yet
  });
});

describe('Slow-mo bank — deploy spends a charge and slows time', () => {
  it('deploy consumes one charge and starts the slow-mo window', () => {
    const fx = createPowerupEffects();
    fx.slowMoCharges = 2;

    expect(deploySlowMo(fx)).toBe(true);
    expect(fx.slowMoCharges).toBe(1);
    expect(fx.slowMoTimer).toBe(POWERUP_DEFS.slowmo.duration);
    // The existing time-scale seam does the actual slowing.
    expect(powerupTimeScale(fx)).toBe(POWERUP_DEFS.slowmo.timeScale);
    expect(powerupTimeScale(fx)).toBeLessThan(1);
  });

  it('deploy is a no-op with an empty bank', () => {
    const fx = createPowerupEffects();
    expect(deploySlowMo(fx)).toBe(false);
    expect(fx.slowMoCharges).toBe(0);
    expect(fx.slowMoTimer).toBe(0);
  });

  it('deploy is a no-op while a slow-mo is already running (no stacking/waste)', () => {
    const fx = createPowerupEffects();
    fx.slowMoCharges = 2;
    expect(deploySlowMo(fx)).toBe(true); // first one runs
    expect(deploySlowMo(fx)).toBe(false); // second press during the window is ignored
    expect(fx.slowMoCharges).toBe(1); // the spare charge is NOT spent
  });
});

describe('Slow-mo bank — deploy is EDGE-triggered across the sub-step loop', () => {
  it('a held deploy spends EXACTLY ONE charge over many sub-steps in one frame', () => {
    const game = startRun(createGameState());
    game.powerups.effects.slowMoCharges = 3;

    // One press, latched true. The fixed loop runs update() several times per
    // rendered frame — emulate that with repeated sub-steps under the SAME intent.
    const intent = createIntent();
    intent.deploySlowMo = true;
    for (let i = 0; i < 8; i++) update(game, intent, TIMESTEP);

    expect(game.powerups.effects.slowMoCharges).toBe(2); // one press → one charge
    expect(game.powerups.effects.slowMoTimer).toBeGreaterThan(0); // slow-mo running
    expect(intent.deploySlowMo).toBe(false); // consumed by the sim
    expect(game.runStats.slowMosDeployed).toBe(1); // counted once for missions
  });

  it('re-arming the intent during the active window does not drain the bank', () => {
    const game = startRun(createGameState());
    game.powerups.effects.slowMoCharges = 3;

    const intent = createIntent();
    // Press, then keep re-arming on later frames while the first slow-mo is live.
    for (let frame = 0; frame < 5; frame++) {
      intent.deploySlowMo = true; // a fresh rising edge each frame
      update(game, intent, TIMESTEP);
    }
    // Only the first deploy took (the rest hit the active-window guard).
    expect(game.powerups.effects.slowMoCharges).toBe(2);
    expect(game.runStats.slowMosDeployed).toBe(1);
  });
});
