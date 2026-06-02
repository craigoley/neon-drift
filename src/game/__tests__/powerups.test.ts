import { describe, expect, it } from 'vitest';
import {
  activePickupCount,
  collectPickups,
  consumeShield,
  createPowerupEffects,
  createPowerupState,
  pickKind,
  powerupScoreMultiplier,
  powerupSpawnInterval,
  powerupTimeScale,
  tickEffects,
  updatePickups,
} from '../Powerups';
import { createGameState, Phase, startRun, update } from '../GameState';
import { createScoreState, integrateScore } from '../Scoring';
import { createVehicleState, updateVehicle } from '../Vehicle';
import { roadCenterAt } from '../Road';
import { createIntent } from '../Input';
import {
  BASE_HANDLING,
  POWERUP_DEFS,
  POWERUP_ORDER,
  POWERUPS,
  PowerupKind,
  SCORING,
  TIMESTEP,
} from '../../utils/constants';

describe('Powerups — recycled pool stays bounded', () => {
  it('pool length is fixed and active count never exceeds poolSize over a long run', () => {
    const state = createPowerupState(123);
    const seed = 123;
    let distance = 0;
    const speed = 120;
    for (let step = 0; step < 20000; step++) {
      distance += speed * TIMESTEP;
      updatePickups(state, seed, distance, 0, TIMESTEP);
      expect(state.pool.length).toBe(POWERUPS.poolSize);
      expect(activePickupCount(state)).toBeLessThanOrEqual(POWERUPS.poolSize);
    }
    // Plenty spawned and culled (passed uncollected), but the array never grew.
    expect(state.spawned).toBeGreaterThan(20);
    expect(state.culled).toBeGreaterThan(20);
  });

  it('active count PLATEAUS over a 120s run (the debug-funnel guarantee)', () => {
    const state = createPowerupState(2024);
    const seed = 2024;
    let distance = 0;
    const speed = 160;
    let maxActive = 0;
    const samples: string[] = [];
    const steps = Math.round(120 / TIMESTEP);
    for (let i = 0; i < steps; i++) {
      distance += speed * TIMESTEP;
      updatePickups(state, seed, distance, 0, TIMESTEP);
      expect(state.pool.length).toBe(POWERUPS.poolSize);
      maxActive = Math.max(maxActive, activePickupCount(state));
      if (i % Math.round(20 / TIMESTEP) === 0) {
        samples.push(
          `t=${(i * TIMESTEP).toFixed(0)}s active=${activePickupCount(state)} ` +
            `spawned=${state.spawned} culled=${state.culled}`,
        );
      }
    }
    console.log('[powerup pool telemetry]\n' + samples.join('\n'));
    // Active never exceeds the pool; cumulative spawn/cull climbed (recycling,
    // not growth).
    expect(maxActive).toBeLessThanOrEqual(POWERUPS.poolSize);
    expect(state.spawned).toBeGreaterThan(10);
    expect(state.culled).toBeGreaterThan(10);
  });

  it('spawn interval is rarer than traffic and tightens with distance toward the floor', () => {
    expect(powerupSpawnInterval(0)).toBeCloseTo(POWERUPS.baseSpawnInterval);
    expect(powerupSpawnInterval(1e9)).toBeCloseTo(POWERUPS.minSpawnInterval);
    expect(powerupSpawnInterval(5000)).toBeLessThan(powerupSpawnInterval(0));
  });
});

describe('Powerups — weighted spawn selection', () => {
  it('pickKind only returns valid kinds and roughly honours the weights (SHIELD rarest)', () => {
    const state = createPowerupState(42);
    const counts: Record<string, number> = {};
    for (const k of POWERUP_ORDER) counts[k] = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) counts[pickKind(state.rng)]++;
    // Every kind is reachable.
    for (const k of POWERUP_ORDER) expect(counts[k]).toBeGreaterThan(0);
    // SHIELD (weight 1) is the rarest; the commonest weighted kinds beat it.
    expect(counts[PowerupKind.Shield]).toBeLessThan(counts[PowerupKind.SlowMo]);
    expect(counts[PowerupKind.Shield]).toBeLessThan(counts[PowerupKind.ScoreBoost]);
    expect(counts[PowerupKind.Shield]).toBeLessThan(counts[PowerupKind.Magnet]);
    // Roughly 1/9 of draws are shields (within a generous band).
    expect(counts[PowerupKind.Shield] / N).toBeGreaterThan(0.06);
    expect(counts[PowerupKind.Shield] / N).toBeLessThan(0.18);
  });
});

describe('Powerups — collection toggles the effect', () => {
  function plantOverlapping(kind: PowerupKind) {
    const state = createPowerupState(1);
    const p = state.pool[0];
    p.active = true;
    p.kind = kind;
    p.distance = 100;
    p.lateral = 0;
    p.laneOffset = 0;
    const events = { crashed: false, nearMisses: 0 } as {
      crashed: boolean;
      nearMisses: number;
      collected?: PowerupKind | null;
    };
    collectPickups(state, 0, 100, events);
    return { state, p, events };
  }

  it('collecting deactivates the pickup, applies the effect, and reports the event', () => {
    const { state, p, events } = plantOverlapping(PowerupKind.ScoreBoost);
    expect(p.active).toBe(false);
    expect(state.collected).toBe(1);
    expect(events.collected).toBe(PowerupKind.ScoreBoost);
    expect(state.effects.scoreBoostTimer).toBeCloseTo(POWERUP_DEFS.scoreBoost.duration);
  });

  it('each kind toggles its own effect on collection', () => {
    expect(plantOverlapping(PowerupKind.Shield).state.effects.shield).toBe(true);
    // SLOW-MO BANKS on collection (it no longer auto-fires): a charge is stored,
    // and no slow-mo window starts until the player deploys it.
    const slow = plantOverlapping(PowerupKind.SlowMo).state.effects;
    expect(slow.slowMoCharges).toBe(1);
    expect(slow.slowMoTimer).toBe(0);
    expect(plantOverlapping(PowerupKind.Magnet).state.effects.magnetTimer).toBeCloseTo(
      POWERUP_DEFS.magnet.duration,
    );
  });

  it('a laterally-distant pickup is NOT collected', () => {
    const state = createPowerupState(1);
    const p = state.pool[0];
    p.active = true;
    p.kind = PowerupKind.Magnet;
    p.distance = 100;
    p.lateral = 8; // well clear of the player at lateral 0
    const events = { crashed: false, nearMisses: 0 };
    collectPickups(state, 0, 100, events);
    expect(p.active).toBe(true);
    expect(state.effects.magnetTimer).toBe(0);
  });
});

describe('Powerups — effects expire on time', () => {
  it('timed effects count down on real dt and clamp to zero', () => {
    const fx = createPowerupEffects();
    fx.slowMoTimer = 2;
    fx.scoreBoostTimer = 1;
    fx.magnetTimer = 3;
    tickEffects(fx, 1);
    expect(fx.slowMoTimer).toBeCloseTo(1);
    expect(fx.scoreBoostTimer).toBeCloseTo(0); // exactly expired, clamped
    expect(fx.magnetTimer).toBeCloseTo(2);
    tickEffects(fx, 5); // overshoot — never goes negative
    expect(fx.slowMoTimer).toBe(0);
    expect(fx.magnetTimer).toBe(0);
  });

  it('powerupTimeScale and powerupScoreMultiplier reflect the active effects', () => {
    const fx = createPowerupEffects();
    expect(powerupTimeScale(fx)).toBe(1);
    expect(powerupScoreMultiplier(fx)).toBe(1);
    fx.slowMoTimer = 1;
    fx.scoreBoostTimer = 1;
    expect(powerupTimeScale(fx)).toBe(POWERUP_DEFS.slowmo.timeScale);
    expect(powerupScoreMultiplier(fx)).toBe(POWERUP_DEFS.scoreBoost.scoreMultiplier);
  });
});

describe('Powerups — SHIELD absorbs exactly one crash then clears', () => {
  function parkObstacleOnPlayer(game: ReturnType<typeof startRun>) {
    const o = game.traffic.pool[0];
    o.active = true;
    o.laneOffset = -roadCenterAt(game.seed, game.distance);
    o.sway = 0;
    o.speed = 0;
    o.distance = game.distance;
    o.passed = false;
  }

  it('consumeShield spends the charge once', () => {
    const fx = createPowerupEffects();
    expect(consumeShield(fx)).toBe(false); // none held
    fx.shield = true;
    expect(consumeShield(fx)).toBe(true);
    expect(fx.shield).toBe(false);
    expect(consumeShield(fx)).toBe(false); // already spent
  });

  it('a held shield swallows the crash, keeps the run going, and preserves the combo', () => {
    const game = startRun(createGameState(5));
    game.powerups.effects.shield = true;
    game.score.combo = 3; // a live combo that a real crash would reset
    parkObstacleOnPlayer(game);

    update(game, createIntent(), TIMESTEP);

    expect(game.phase).toBe(Phase.Playing); // survived
    expect(game.powerups.effects.shield).toBe(false); // charge spent
    expect(game.powerups.effects.invulnTimer).toBeGreaterThan(0); // i-frames granted
    expect(game.lastEvents.shieldBlocked).toBe(true);
    expect(game.score.combo).toBe(3); // combo NOT reset
  });

  it('a SECOND crash (after the charge + i-frames are gone) ends the run', () => {
    const game = startRun(createGameState(5));
    game.powerups.effects.shield = true;
    parkObstacleOnPlayer(game);
    update(game, createIntent(), TIMESTEP);
    expect(game.phase).toBe(Phase.Playing);

    // The i-frame window elapses (no obstacle on the player meanwhile).
    game.powerups.effects.invulnTimer = 0;
    expect(game.powerups.effects.shield).toBe(false);

    // Re-park an obstacle on the player at the current position and step again.
    parkObstacleOnPlayer(game);
    update(game, createIntent(), TIMESTEP);
    expect(game.phase).toBe(Phase.Crashed); // no shield left → game over
  });
});

describe('Powerups — SCORE-BOOST multiplies score gain (stacks with combo)', () => {
  it('a boosted step gains exactly the multiplier more than an unboosted one', () => {
    const plain = createScoreState();
    const boosted = createScoreState();
    const speed = 120;
    integrateScore(plain, speed, TIMESTEP, 1);
    integrateScore(boosted, speed, TIMESTEP, POWERUP_DEFS.scoreBoost.scoreMultiplier);
    expect(boosted.score).toBeCloseTo(plain.score * POWERUP_DEFS.scoreBoost.scoreMultiplier);
  });

  it('stacks MULTIPLICATIVELY on top of the combo', () => {
    const s = createScoreState();
    s.combo = 4;
    integrateScore(s, 100, TIMESTEP, 2);
    // gain = speed * dt * distanceFactor * combo * multiplier
    expect(s.score).toBeCloseTo(100 * TIMESTEP * SCORING.distanceFactor * 4 * 2);
  });
});

describe('Powerups — SLOW-MO scales the timestep without breaking integrity', () => {
  // Drive the same crash-free run at full and half sim-dt; the scaled run covers
  // less ground, but score still tracks distance exactly (combo 1), and nothing
  // produces NaN/Infinity.
  function run(scale: number) {
    const v = createVehicleState();
    const s = createScoreState();
    const intent = createIntent();
    let distance = 0;
    for (let i = 0; i < 600; i++) {
      const simDt = TIMESTEP * scale;
      updateVehicle(v, intent, distance, 0, BASE_HANDLING, simDt);
      distance += v.speed * simDt;
      integrateScore(s, v.speed, simDt, 1);
    }
    return { distance, score: s.score, speed: v.speed };
  }

  it('slowed time covers less ground but keeps score == distance (no near-miss/boost)', () => {
    const full = run(1);
    const slow = run(0.5);
    expect(slow.distance).toBeLessThan(full.distance);
    expect(slow.distance).toBeGreaterThan(0);
    // Integrity: with combo 1 and no boost, score is exactly distance either way.
    expect(full.score).toBeCloseTo(full.distance * SCORING.distanceFactor);
    expect(slow.score).toBeCloseTo(slow.distance * SCORING.distanceFactor);
    for (const n of [full.distance, full.score, slow.distance, slow.score, slow.speed]) {
      expect(Number.isFinite(n)).toBe(true);
    }
  });

  it('GameState.update advances less distance per step while SLOW-MO is active', () => {
    const fast = startRun(createGameState(31));
    const slow = startRun(createGameState(31));
    slow.powerups.effects.slowMoTimer = 999; // pinned active for the whole test
    const intent = createIntent();
    update(fast, intent, TIMESTEP);
    update(slow, intent, TIMESTEP);
    // ~half the ground (not exactly, since speed also accelerates on the scaled
    // dt) — the point is the sim is meaningfully slowed and stays finite.
    const ratio = slow.distance / fast.distance;
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.5);
    expect(Number.isFinite(slow.distance)).toBe(true);
  });
});

describe('Powerups — MAGNET pulls nearby pickups toward the player', () => {
  it('an in-range pickup converges toward the player laterally and longitudinally', () => {
    const state = createPowerupState(7);
    state.effects.magnetTimer = 999;
    const seed = 7;
    const playerDistance = 100;
    const playerLateral = 0;
    const p = state.pool[0];
    p.active = true;
    p.kind = PowerupKind.ScoreBoost;
    p.distance = playerDistance + 40; // ahead, within magnetRange
    p.laneOffset = 6;
    p.lateral = roadCenterAt(seed, p.distance) + 6;

    const startLat = Math.abs(p.lateral - playerLateral);
    const startGap = p.distance - playerDistance;
    for (let i = 0; i < 30; i++) {
      updatePickups(state, seed, playerDistance, playerLateral, TIMESTEP);
    }
    expect(Math.abs(p.lateral - playerLateral)).toBeLessThan(startLat);
    expect(p.distance - playerDistance).toBeLessThan(startGap);
  });

  it('without MAGNET a stationary pickup holds its longitudinal position', () => {
    const state = createPowerupState(7);
    const seed = 7;
    const p = state.pool[0];
    p.active = true;
    p.kind = PowerupKind.ScoreBoost;
    p.distance = 140;
    p.laneOffset = 6;
    for (let i = 0; i < 30; i++) updatePickups(state, seed, 100, 0, TIMESTEP);
    expect(p.distance).toBeCloseTo(140); // never moved toward the player
  });
});

describe('Powerups — no NaN with all effects churning through a real run', () => {
  it('a long update loop with effects toggled stays finite', () => {
    const game = startRun(createGameState(99));
    const intent = createIntent();
    for (let i = 0; i < 60 * 30; i++) {
      // Periodically (re)charge effects so all four code paths exercise.
      if (i % 200 === 0) {
        game.powerups.effects.shield = true;
        game.powerups.effects.slowMoTimer = 1.5;
        game.powerups.effects.scoreBoostTimer = 2.0;
        game.powerups.effects.magnetTimer = 2.0;
      }
      update(game, intent, TIMESTEP);
      expect(Number.isFinite(game.distance)).toBe(true);
      expect(Number.isFinite(game.time)).toBe(true);
      expect(Number.isFinite(game.score.score)).toBe(true);
      expect(Number.isFinite(game.vehicle.speed)).toBe(true);
      expect(Number.isNaN(game.powerups.effects.slowMoTimer)).toBe(false);
      if (game.phase !== Phase.Playing) break;
    }
  });
});
