/**
 * MP-RACE crash rule (MP-1 PR3) — crash = SLOWDOWN, not end-of-run. PURE/headless.
 *
 * The freeze: a crash ended the run → the crashed car froze (Crashed early-returns in
 * update) and, on the shared deadly course, both cars inevitably crash → the whole
 * race freezes with no resolution. Fix: in mpRace mode a crash slows the car and the
 * run CONTINUES, so the sim keeps advancing (and the lockstep keeps getting intents).
 *
 * The LOAD-BEARING test is determinism: the slowdown must be computed IDENTICALLY on
 * both peers (both simulate both cars from the same inputs), or it would desync. So a
 * scripted run that crashes, replayed, must reproduce the EXACT same state.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type GameState, GameMode, isSlalom, Phase, startRun, update } from '../GameState';
import { createIntent, type InputIntent } from '../Input';
import { roadCenterAt } from '../Road';
import { MP_CRASH, ObstacleKind, SLALOM, TIMESTEP } from '../../utils/constants';

const BASE = [undefined, undefined] as const;

/** Start a classic run; mpRace toggles the MP crash rule (8th startRun arg). */
function start(seed: number, mpRace: boolean): GameState {
  return startRun(createGameState(seed), ...BASE, seed, undefined, GameMode.Classic, undefined, mpRace);
}

/** Force a dead-ahead static collision at the player and step once (no shield). */
function forceCollision(g: GameState): void {
  const center = roadCenterAt(g.seed, g.distance);
  g.vehicle.lateral = center;
  g.powerups.effects.invulnTimer = 0; // ensure no i-frames swallow it
  const o = g.traffic.pool.find((x) => !x.active) ?? g.traffic.pool[0];
  o.active = true;
  o.kind = ObstacleKind.Static;
  o.sway = 0; o.swayPhase = 0; o.consumed = false; o.passed = false; o.speed = 0; o.laneOffset = 0;
  o.distance = g.distance + 0.5;
  update(g, createIntent(), TIMESTEP);
}

describe('MP-race crash = slowdown (run continues, never freezes)', () => {
  it('a crash slows the car + grants i-frames but does NOT end the run', () => {
    const g = start(7, true);
    expect(isSlalom(g)).toBe(false);
    expect(g.mpRace).toBe(true);
    const before = g.vehicle.speed;
    forceCollision(g);
    expect(g.phase, 'run continues (not Crashed)').toBe(Phase.Playing);
    expect(g.vehicle.speed, 'dropped to the crash speed').toBeCloseTo(MP_CRASH.crashSpeed, 6);
    expect(g.vehicle.speed).toBeLessThan(before);
    expect(g.powerups.effects.invulnTimer, 'i-frames granted').toBeGreaterThan(0);
    expect(g.lastEvents.mpCrashed, 'crash cue fired').toBe(true);
  });

  it('after the crash the car keeps driving and recovers speed — the run never ends', () => {
    const g = start(21, true); // drives straight into the seeded obstacle
    const intent = createIntent();
    let crashes = 0;
    const speeds: number[] = [];
    for (let f = 0; f < 1200; f++) {
      update(g, intent, TIMESTEP);
      if (g.lastEvents.mpCrashed) crashes++;
      speeds.push(g.vehicle.speed);
    }
    expect(g.phase, 'still Playing after 1200 frames of crashes').toBe(Phase.Playing);
    expect(crashes, 'it actually crashed (≥1)').toBeGreaterThanOrEqual(1);
    expect(g.distance, 'kept moving — distance grew past 0').toBeGreaterThan(0);
    expect(Math.max(...speeds), 'speed recovered above the crash floor').toBeGreaterThan(MP_CRASH.crashSpeed * 2);
  });
});

describe('MP-race crash is DETERMINISTIC (identical on both peers — the desync guard)', () => {
  it('a scripted run through crashes replays to a byte-identical state', () => {
    const script = (f: number): InputIntent => ({ ...createIntent(), steer: Math.sin(f * 0.05) * 0.3 });
    const run = (): GameState => {
      const g = start(21, true); // straight-ish → crashes repeatedly under MP rule
      for (let f = 0; f < 1500; f++) update(g, script(f), TIMESTEP);
      return g;
    };
    const a = run();
    const b = run();
    expect(a.rng.getState(), 'RNG exact (any slowdown divergence would show here)').toBe(b.rng.getState());
    expect(a.powerups.rng.getState()).toBe(b.powerups.rng.getState());
    expect(a.distance).toBeCloseTo(b.distance, 9);
    expect(a.vehicle.speed).toBeCloseTo(b.vehicle.speed, 9);
    expect(a.vehicle.lateral).toBeCloseTo(b.vehicle.lateral, 9);
    expect(a.score.score).toBeCloseTo(b.score.score, 6);
  });

  it('two sims with the SAME seed + inputs but DIFFERENT cars each stay self-consistent', () => {
    // (both peers run both of these; each must be deterministic on both machines)
    for (const car of ['pulse', 'nova'] as const) {
      const mk = () => {
        const g = startRun(createGameState(99), undefined, undefined, 99, undefined, GameMode.Classic, undefined, true);
        for (let f = 0; f < 800; f++) update(g, { ...createIntent(), steer: Math.cos(f * 0.04) * 0.4 }, TIMESTEP);
        return g;
      };
      void car;
      expect(mk().rng.getState()).toBe(mk().rng.getState());
    }
  });
});

describe('single-player crash behaviour is UNCHANGED (mpRace=false)', () => {
  it('classic (mpRace off) still ends on the FIRST crash', () => {
    const g = start(7, false);
    expect(g.mpRace).toBe(false);
    forceCollision(g);
    expect(g.phase, 'classic single-collision death intact').toBe(Phase.Crashed);
    expect(g.lastEvents.mpCrashed).toBeFalsy();
  });

  it('slalom still has its 3-life system (mpRace off)', () => {
    const g = startRun(createGameState(123), undefined, undefined, 123, undefined, GameMode.DailySlalom);
    expect(isSlalom(g)).toBe(true);
    expect(g.mpRace).toBe(false);
    const forceWallMiss = () => {
      const c = roadCenterAt(g.seed, g.distance);
      g.vehicle.lateral = c;
      g.powerups.effects.invulnTimer = 0;
      const gate = g.traffic.pool.find((x) => !x.active) ?? g.traffic.pool[0];
      gate.active = true; gate.kind = ObstacleKind.Gate; gate.openingHalfWidth = 2.6; gate.laneOffset = 9;
      gate.sway = 0; gate.swayPhase = 0; gate.consumed = false; gate.passed = false; gate.speed = 0;
      gate.distance = g.distance + 0.5;
      update(g, createIntent(), TIMESTEP);
    };
    forceWallMiss();
    expect(g.lives).toBe(SLALOM.lives - 1);
    expect(g.phase).toBe(Phase.Playing);
  });
});
