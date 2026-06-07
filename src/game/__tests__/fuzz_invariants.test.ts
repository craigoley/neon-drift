/**
 * L1 SIM-FUZZING — invariant hunting on the pure core (automated bug hunt).
 *
 * Drives MANY seeded, scripted runs headlessly through the real loop
 * (createGameState/startRun/update) in BOTH modes and asserts invariants that must
 * NEVER break — numeric integrity (no NaN/Infinity/negative), state integrity
 * (legal phases, bounded pools, road-clamped lateral), per-car caps, combo bounds,
 * mode integrity (classic never touches slalomScore; slalom never builds the
 * classic combo), determinism, and edge/stress (long runs, deploy-spam, steer-slam,
 * collect-at-cap, fast 3-miss). Pure — no three, no DOM.
 *
 * A failure prints the seed + which invariant broke, so any finding is reproducible.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type GameState, GameMode, Phase, startRun, update } from '../GameState';
import { createIntent, type InputIntent } from '../Input';
import { grantPowerup } from '../Powerups';
import { roadCenterAt } from '../Road';
import {
  CARS,
  DAILY_SCORING,
  ObstacleKind,
  POWERUPS,
  PowerupKind,
  ROAD,
  SCORING,
  SLALOM,
  TIMESTEP,
  TRAFFIC,
  VEHICLE,
  handlingFor,
  scoringFor,
  slowMoFor,
} from '../../utils/constants';

// ---- input scripts (PURE functions of the frame index — no RNG, no clock) ------
type Script = (frame: number) => InputIntent;
const SCRIPTS: Record<string, Script> = {
  straight: () => createIntent(),
  sineWander: (f) => ({ ...createIntent(), steer: Math.sin(f * 0.13) * 0.8 }),
  steerSlam: (f) => ({ ...createIntent(), steer: f % 2 === 0 ? 1 : -1 }),
  deploySpam: (f) => ({ ...createIntent(), steer: Math.sin(f * 0.07) * 0.5, deploySlowMo: true }),
};

const FINITE_FIELDS = (g: GameState): Array<[string, number]> => {
  const e = g.powerups.effects;
  return [
    ['distance', g.distance], ['time', g.time],
    ['score', g.score.score], ['combo', g.score.combo], ['peakCombo', g.score.peakCombo],
    ['comboTimer', g.score.comboTimer], ['nearMisses', g.score.nearMisses],
    ['slalom.score', g.slalomScore.score], ['cleanMult', g.slalomScore.cleanMultiplier],
    ['gatesThreaded', g.slalomScore.gatesThreaded],
    ['lateral', g.vehicle.lateral], ['lateralVel', g.vehicle.lateralVel],
    ['speed', g.vehicle.speed], ['boostTimer', g.vehicle.boostTimer],
    ['charges', e.slowMoCharges], ['slowMoTimer', e.slowMoTimer], ['slowMoTimeScale', e.slowMoTimeScale],
    ['slowMoCap', e.slowMoCap], ['invuln', e.invulnTimer], ['scoreBoost', e.scoreBoostTimer],
    ['magnet', e.magnetTimer], ['lives', g.lives],
  ];
};

/** Assert every must-hold invariant on a state. `ctx` is printed on failure. */
function assertInvariants(g: GameState, mode: GameMode, ctx: string): void {
  for (const [name, v] of FINITE_FIELDS(g)) {
    if (!Number.isFinite(v)) throw new Error(`${ctx}: ${name} is not finite (${v})`);
  }
  // signs / ranges
  expect(g.score.score, `${ctx} score>=0`).toBeGreaterThanOrEqual(0);
  expect(g.distance, `${ctx} distance>=0`).toBeGreaterThanOrEqual(0);
  expect(g.time, `${ctx} time>=0`).toBeGreaterThanOrEqual(0);
  expect(g.score.combo, `${ctx} combo>=base`).toBeGreaterThanOrEqual(SCORING.baseCombo);
  expect(g.score.combo, `${ctx} combo<=max`).toBeLessThanOrEqual(SCORING.maxCombo + 1e-9);
  expect(g.score.peakCombo, `${ctx} peak<=max`).toBeLessThanOrEqual(SCORING.maxCombo + 1e-9);
  expect(g.score.peakCombo, `${ctx} peak>=base`).toBeGreaterThanOrEqual(SCORING.baseCombo);
  expect(g.vehicle.speed, `${ctx} speed>=0`).toBeGreaterThanOrEqual(0);
  expect(g.vehicle.speed, `${ctx} speed<=cap`).toBeLessThanOrEqual(VEHICLE.maxSpeedCap + VEHICLE.boostBonus + 1e-6);
  expect(g.lives, `${ctx} lives>=0`).toBeGreaterThanOrEqual(0);
  expect(g.lives, `${ctx} lives<=start`).toBeLessThanOrEqual(SLALOM.lives);
  // per-car slow-mo cap
  expect(g.powerups.effects.slowMoCharges, `${ctx} charges>=0`).toBeGreaterThanOrEqual(0);
  expect(g.powerups.effects.slowMoCharges, `${ctx} charges<=cap`).toBeLessThanOrEqual(g.powerups.effects.slowMoCap);
  // clean-streak bounds
  expect(g.slalomScore.cleanMultiplier, `${ctx} clean>=start`).toBeGreaterThanOrEqual(DAILY_SCORING.cleanStart);
  expect(g.slalomScore.cleanMultiplier, `${ctx} clean<=max`).toBeLessThanOrEqual(DAILY_SCORING.cleanMax);
  expect(g.slalomScore.gatesThreaded, `${ctx} gates>=0`).toBeGreaterThanOrEqual(0);
  expect(g.slalomScore.score, `${ctx} slalomScore>=0`).toBeGreaterThanOrEqual(0);
  // lateral stays within the road clamp (roadCenter ±halfWidth), +1 for one-step curve drift
  const rc = roadCenterAt(g.seed, g.distance);
  expect(Math.abs(g.vehicle.lateral - rc), `${ctx} lateral within road`).toBeLessThanOrEqual(ROAD.halfWidth + 1);
  // pools never grow, active count bounded
  expect(g.traffic.pool.length, `${ctx} traffic pool size`).toBe(TRAFFIC.poolSize);
  expect(g.powerups.pool.length, `${ctx} powerup pool size`).toBe(POWERUPS.poolSize);
  expect(g.traffic.pool.filter((o) => o.active).length, `${ctx} active traffic`).toBeLessThanOrEqual(TRAFFIC.poolSize);
  expect(g.powerups.pool.filter((p) => p.active).length, `${ctx} active pickups`).toBeLessThanOrEqual(POWERUPS.poolSize);
  // phase always legal
  expect([Phase.Menu, Phase.Playing, Phase.Paused, Phase.Crashed], `${ctx} phase`).toContain(g.phase);
  // mode integrity
  if (mode === GameMode.Classic) {
    // classic NEVER mutates the slalom score state
    expect(g.slalomScore.score, `${ctx} classic slalomScore untouched`).toBe(0);
    expect(g.slalomScore.cleanMultiplier, `${ctx} classic clean untouched`).toBe(DAILY_SCORING.cleanStart);
    expect(g.slalomScore.gatesThreaded, `${ctx} classic gates untouched`).toBe(0);
  } else {
    // slalom is gates-only: no near-miss ever fires, so the classic combo never builds
    expect(g.score.combo, `${ctx} slalom combo stays base`).toBe(SCORING.baseCombo);
    expect(g.score.nearMisses, `${ctx} slalom no near-misses`).toBe(0);
  }
}

const SEEDS = Array.from({ length: 30 }, (_, i) => (i * 2654435761) >>> 0); // well-spread 32-bit seeds

describe('L1 fuzz — invariants hold across many seeds × scripts × both modes', () => {
  for (const mode of [GameMode.Classic, GameMode.DailySlalom]) {
    for (const scriptName of Object.keys(SCRIPTS)) {
      it(`${mode} / ${scriptName}: 1200 steps, invariants never break`, () => {
        const script = SCRIPTS[scriptName];
        for (const seed of SEEDS) {
          const g = startRun(createGameState(seed), undefined, undefined, seed, undefined, mode);
          // deploy-spam needs charges to actually exercise the deploy path
          if (scriptName === 'deploySpam') for (let i = 0; i < 5; i++) grantPowerup(g.powerups.effects, PowerupKind.SlowMo);
          for (let f = 0; f < 1200; f++) {
            update(g, script(f), TIMESTEP);
            if (f % 200 === 0) assertInvariants(g, mode, `seed=${seed} ${mode}/${scriptName} f=${f}`);
          }
          assertInvariants(g, mode, `seed=${seed} ${mode}/${scriptName} final`);
        }
      });
    }
  }
});

describe('L1 fuzz — determinism sweep (same seed + script ⇒ identical state)', () => {
  it('30 seeds × both modes: two runs are byte-identical (rng anchor + fields)', () => {
    const run = (seed: number, mode: GameMode): GameState => {
      const g = startRun(createGameState(seed), undefined, undefined, seed, undefined, mode);
      for (let i = 0; i < 3; i++) grantPowerup(g.powerups.effects, PowerupKind.SlowMo);
      for (let f = 0; f < 800; f++) update(g, SCRIPTS.deploySpam(f), TIMESTEP);
      return g;
    };
    for (const mode of [GameMode.Classic, GameMode.DailySlalom]) {
      for (const seed of SEEDS) {
        const a = run(seed, mode);
        const b = run(seed, mode);
        const tag = `seed=${seed} ${mode}`;
        expect(a.rng.getState(), `${tag} rng`).toBe(b.rng.getState());
        expect(a.powerups.rng.getState(), `${tag} pickup rng`).toBe(b.powerups.rng.getState());
        expect(a.phase, `${tag} phase`).toBe(b.phase);
        expect(a.lives, `${tag} lives`).toBe(b.lives);
        expect(a.traffic.spawned, `${tag} spawned`).toBe(b.traffic.spawned);
        expect(a.distance, `${tag} distance`).toBeCloseTo(b.distance, 9);
        expect(a.score.score, `${tag} score`).toBeCloseTo(b.score.score, 6);
        expect(a.slalomScore.score, `${tag} slalomScore`).toBeCloseTo(b.slalomScore.score, 6);
      }
    }
  });
});

describe('L1 fuzz — phase integrity: a Crashed run is frozen', () => {
  it('once Crashed, further update() calls do not advance sim state', () => {
    // Drive straight in slalom until the run ends (3 missed gate-walls).
    const g = startRun(createGameState(42), undefined, undefined, 42, undefined, GameMode.DailySlalom);
    const intent = createIntent();
    let steps = 0;
    while (g.phase === Phase.Playing && steps < 20000) {
      update(g, intent, TIMESTEP);
      steps++;
    }
    expect(g.phase).toBe(Phase.Crashed);
    const snap = { distance: g.distance, time: g.time, score: g.score.score, slalom: g.slalomScore.score, lives: g.lives };
    for (let i = 0; i < 100; i++) update(g, intent, TIMESTEP);
    expect(g.distance).toBe(snap.distance);
    expect(g.time).toBe(snap.time);
    expect(g.score.score).toBe(snap.score);
    expect(g.slalomScore.score).toBe(snap.slalom);
    expect(g.lives).toBe(snap.lives);
  });
});

describe('L1 fuzz — mode integrity: daily seed is stable per date', () => {
  it('the same calendar date always maps to the same seed (and adjacent dates differ)', async () => {
    const { dailySeed } = await import('../../utils/daily');
    const d1 = new Date(2026, 5, 7);
    const d1b = new Date(2026, 5, 7, 23, 59); // same local date, different time
    const d2 = new Date(2026, 5, 8);
    expect(dailySeed(d1)).toBe(dailySeed(d1b)); // stable within the day
    expect(dailySeed(d1)).not.toBe(dailySeed(d2)); // avalanches across days
    expect(Number.isInteger(dailySeed(d1))).toBe(true);
    expect(dailySeed(d1)).toBeGreaterThanOrEqual(0); // 32-bit unsigned
  });
});

describe('L1 fuzz — stress / edge cases', () => {
  it('very long run (12k steps) keeps invariants and bounded pools', () => {
    const g = startRun(createGameState(2025), undefined, undefined, 2025, undefined, GameMode.Classic);
    for (let f = 0; f < 12000; f++) {
      update(g, SCRIPTS.sineWander(f), TIMESTEP);
      if (f % 1000 === 0) assertInvariants(g, GameMode.Classic, `longrun f=${f}`);
    }
    assertInvariants(g, GameMode.Classic, 'longrun final');
  });

  it('deploy-spam never drives charges negative or above cap (every car)', () => {
    for (const car of CARS) {
      const cap = slowMoFor(car.id).cap;
      const g = startRun(
        createGameState(7), handlingFor(car.id), undefined, 7, scoringFor(car.id), GameMode.Classic, slowMoFor(car.id),
      );
      for (let f = 0; f < 1500; f++) {
        // Re-bank periodically AND spam deploy, so collect-at-cap and deploy race.
        if (f % 30 === 0) for (let i = 0; i < 6; i++) grantPowerup(g.powerups.effects, PowerupKind.SlowMo);
        update(g, SCRIPTS.deploySpam(f), TIMESTEP);
        expect(g.powerups.effects.slowMoCharges, `${car.id} charges>=0`).toBeGreaterThanOrEqual(0);
        expect(g.powerups.effects.slowMoCharges, `${car.id} charges<=cap`).toBeLessThanOrEqual(cap);
      }
    }
  });

  it('steer-slam (±1 every frame) keeps lateral road-clamped and finite', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const g = startRun(createGameState(seed), undefined, undefined, seed, undefined, GameMode.Classic);
      for (let f = 0; f < 1500; f++) {
        update(g, SCRIPTS.steerSlam(f), TIMESTEP);
        const rc = roadCenterAt(g.seed, g.distance);
        expect(Number.isFinite(g.vehicle.lateral)).toBe(true);
        expect(Math.abs(g.vehicle.lateral - rc), `seed=${seed} f=${f} lateral`).toBeLessThanOrEqual(ROAD.halfWidth + 1);
      }
    }
  });

  it('three fast gate-wall misses end a slalom run with lives at exactly 0', () => {
    const g = startRun(createGameState(99), undefined, undefined, 99, undefined, GameMode.DailySlalom);
    const intent = createIntent();
    const forceWallMiss = (): void => {
      const center = roadCenterAt(g.seed, g.distance);
      g.vehicle.lateral = center;
      g.powerups.effects.invulnTimer = 0; // clear any i-frames so the wall lands
      const gate = g.traffic.pool.find((o) => !o.active) ?? g.traffic.pool[0];
      gate.active = true;
      gate.kind = ObstacleKind.Gate;
      gate.openingHalfWidth = 2.6;
      gate.laneOffset = 9; // opening hard to one side → centre car wall-hits it
      gate.sway = 0;
      gate.swayPhase = 0;
      gate.consumed = false;
      gate.passed = false;
      gate.speed = 0;
      gate.distance = g.distance + 0.5;
      update(g, intent, TIMESTEP);
    };
    forceWallMiss(); // 3 -> 2
    expect(g.lives).toBe(2);
    forceWallMiss(); // 2 -> 1
    expect(g.lives).toBe(1);
    forceWallMiss(); // 1 -> 0 -> Crashed
    expect(g.lives).toBe(0);
    expect(g.phase).toBe(Phase.Crashed);
  });
});
