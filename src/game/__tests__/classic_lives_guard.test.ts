/**
 * REGRESSION GUARD — classic is single-collision death; the slalom 3-life system
 * must NEVER leak into classic (the bug class of the gate-feedback leak #65).
 *
 * Background: a playtest reported "classic survives multiple crashes (3 lives)".
 * Instrumenting main's pure sim across single-crash, multi-crash, and cross-mode
 * (daily→classic) scenarios showed classic ALWAYS dies on the first collision and
 * NO slalom state leaks across a startRun — i.e. the live observation is not a
 * main-sim bug (build-identity). These tests lock that invariant so it can't
 * regress silently: if the isSlalom guard on the lives-decrement (GameState.ts) is
 * ever dropped/inverted, or slalom state leaks across a mode switch, this fails.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type GameState, GameMode, isSlalom, Phase, startRun, update } from '../GameState';
import { createIntent } from '../Input';
import { roadCenterAt } from '../Road';
import { DAILY_SCORING, ObstacleKind, SLALOM, TIMESTEP } from '../../utils/constants';

/** Force a dead-ahead static collision at the player and step once. No shield. */
function forceCollision(g: GameState): void {
  const center = roadCenterAt(g.seed, g.distance);
  g.vehicle.lateral = center;
  const o = g.traffic.pool.find((x) => !x.active) ?? g.traffic.pool[0];
  o.active = true;
  o.kind = ObstacleKind.Static;
  o.sway = 0;
  o.swayPhase = 0;
  o.consumed = false;
  o.passed = false;
  o.speed = 0;
  o.laneOffset = 0;
  o.distance = g.distance + 0.5;
  update(g, createIntent(), TIMESTEP);
}

describe('classic lives guard — single-collision death never leaks 3 lives', () => {
  it('a classic run ends on the FIRST collision (no shield) — lives inert', () => {
    const g = startRun(createGameState(7), undefined, undefined, 7);
    expect(isSlalom(g)).toBe(false);
    expect(g.powerups.effects.invulnTimer).toBe(0);
    forceCollision(g);
    expect(g.phase, 'classic dies on hit #1').toBe(Phase.Crashed);
    expect(g.lives, 'lives untouched (inert in classic)').toBe(SLALOM.lives);
  });

  it('classic survives ZERO crashes — it never decrements lives or continues', () => {
    // Across several seeds, the first forced collision must always end the run.
    for (const seed of [1, 7, 42, 123, 2024]) {
      const g = startRun(createGameState(seed), undefined, undefined, seed);
      let survived = 0;
      for (let k = 0; k < 4 && g.phase === Phase.Playing; k++) {
        forceCollision(g);
        if (g.phase === Phase.Playing) survived++;
      }
      expect(survived, `seed=${seed}: classic survived a crash while Playing`).toBe(0);
    }
  });

  it('no slalom state leaks daily → classic across startRun (mode/lives/streak reset)', () => {
    const g = createGameState(7);
    // A daily (slalom) run, then a classic run started exactly as main.onPlay does.
    startRun(g, undefined, undefined, 7, undefined, GameMode.DailySlalom);
    g.slalomScore.cleanMultiplier = 5; // pretend a streak built
    g.lives = 1; // pretend lives were spent
    startRun(g, undefined, undefined, 99, undefined, GameMode.Classic);
    expect(isSlalom(g), 'classic run is not flagged slalom').toBe(false);
    expect(g.mode).toBe(GameMode.Classic);
    expect(g.lives, 'lives reset to full each run').toBe(SLALOM.lives);
    expect(g.slalomScore.cleanMultiplier, 'slalom streak reset').toBe(DAILY_SCORING.cleanStart);
    // And the classic run still dies on the first hit.
    forceCollision(g);
    expect(g.phase).toBe(Phase.Crashed);
  });

  it('slalom STILL has its 3-life system (the guard fix must not break slalom)', () => {
    const g = startRun(createGameState(123), undefined, undefined, 123, undefined, GameMode.DailySlalom);
    expect(isSlalom(g)).toBe(true);
    // Force a gate-wall miss: opening hard to one side, car at centre.
    const forceWallMiss = () => {
      const center = roadCenterAt(g.seed, g.distance);
      g.vehicle.lateral = center;
      g.powerups.effects.invulnTimer = 0;
      const gate = g.traffic.pool.find((x) => !x.active) ?? g.traffic.pool[0];
      gate.active = true;
      gate.kind = ObstacleKind.Gate;
      gate.openingHalfWidth = 2.6;
      gate.laneOffset = 9;
      gate.sway = 0;
      gate.swayPhase = 0;
      gate.consumed = false;
      gate.passed = false;
      gate.speed = 0;
      gate.distance = g.distance + 0.5;
      update(g, createIntent(), TIMESTEP);
    };
    forceWallMiss();
    expect(g.lives, 'slalom miss costs a life').toBe(SLALOM.lives - 1);
    expect(g.phase, 'slalom run continues after a non-fatal miss').toBe(Phase.Playing);
  });
});
