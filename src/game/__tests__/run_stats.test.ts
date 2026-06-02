import { describe, expect, it } from 'vitest';
import { createGameState, startRun, update } from '../GameState';
import { roadCenterAt } from '../Road';
import { createIntent } from '../Input';
import { BIOME_CYCLE, PowerupKind, TIMESTEP } from '../../utils/constants';

describe('Run stats — slow-mo deploys + shields accumulate during a run', () => {
  it('deploying a banked slow-mo increments the run count once per press, and resets each run', () => {
    const game = startRun(createGameState(5));
    game.powerups.effects.slowMoCharges = 2;
    const intent = createIntent();
    intent.deploySlowMo = true; // one press, held across several sub-steps
    for (let i = 0; i < 60; i++) update(game, intent, TIMESTEP);
    expect(game.runStats.slowMosDeployed).toBe(1); // edge-triggered: exactly one

    // A fresh run zeroes the accumulators.
    startRun(game);
    expect(game.runStats.slowMosDeployed).toBe(0);
    expect(game.runStats.shields).toBe(0);
  });

  it('collecting a shield pickup increments the run shield count', () => {
    const game = startRun(createGameState(5));
    // Plant a shield pickup right on the player so the next step collects it.
    const p = game.powerups.pool[0];
    p.active = true;
    p.kind = PowerupKind.Shield;
    p.distance = game.distance;
    p.laneOffset = -roadCenterAt(game.seed, game.distance);
    p.lateral = 0;
    update(game, createIntent(), TIMESTEP);
    expect(game.runStats.shields).toBe(1);
  });
});

describe('Start biome is cosmetic — it shifts visuals, never difficulty', () => {
  it('two runs with different start biomes cover identical distance/speed', () => {
    const intent = createIntent();
    const a = startRun(createGameState(11), undefined, 0); // start Sunset
    const b = startRun(createGameState(11), undefined, 2); // start Toxic (offset)
    for (let i = 0; i < 120; i++) {
      update(a, intent, TIMESTEP);
      update(b, intent, TIMESTEP);
    }
    // Distance + speed are driven by RAW distance, unaffected by the offset…
    expect(b.distance).toBeCloseTo(a.distance, 6);
    expect(b.vehicle.speed).toBeCloseTo(a.vehicle.speed, 6);
    // …but the displayed biome differs (b is shifted forward by 2 spans).
    expect(b.biome.from).not.toBe(a.biome.from);
  });

  it('the start-biome offset only moves the biome by the configured span count', () => {
    const game = startRun(createGameState(1), undefined, 1); // start in biome 1
    update(game, createIntent(), TIMESTEP);
    // At ~0 raw distance + 1-span offset, the active biome is index 1.
    expect(game.biome.from).toBe(1);
    expect(BIOME_CYCLE.span).toBeGreaterThan(0);
  });
});
