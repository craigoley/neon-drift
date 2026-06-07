/**
 * L1 validation-stack scenarios (recon #A2/#A3/#A4). These EXTEND the existing
 * coverage rather than duplicate it:
 *  - #A2  slalom clean-streak climb-then-reset, INTEGRATED through update() (the
 *         existing slalom_score.test.ts tests threadGate/missGate in isolation).
 *  - #A3  classic graze gradient with a MOVER, pinning the moverNearMissWeight ×
 *         grazeMultiplier COMPOSITION (graze_scoring.test.ts only uses statics).
 *  - #A4  a threaded gate contributes NOTHING to classic score/combo in either
 *         mode (sim-level parity; the #65 VISUAL leak is L2's job — see note).
 *
 * Pure — no three, no DOM.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type GameState, GameMode, Phase, startRun, update } from '../GameState';
import { createIntent } from '../Input';
import { roadCenterAt } from '../Road';
import { createTrafficState } from '../Traffic';
import { createScoreState, grazeMultiplier, resolveTraffic, type TrafficEvents } from '../Scoring';
import { DAILY_SCORING, ObstacleKind, SCORING, TIMESTEP } from '../../utils/constants';

const intent = createIntent();

// ---------------------------------------------------------------------------
// #A2 — slalom clean-streak climbs through update(), resets on a miss
// ---------------------------------------------------------------------------
describe('L1 #A2 — slalom clean-streak (integrated through update)', () => {
  // Thread ONE gate cleanly THROUGH the real update() loop (not a direct
  // threadGate() unit call): park the car dead-centre with a generous centred
  // opening just ahead, then step until the gate is passed. Each thread costs only
  // a step or two, so the slalom's own ~1 s gate cadence never spawns an
  // interfering gate during a short climb.
  function threadCenteredGate(game: GameState): void {
    const center = roadCenterAt(game.seed, game.distance);
    game.vehicle.lateral = center;
    game.vehicle.lateralVel = 0;
    const g = game.traffic.pool.find((o) => !o.active) ?? game.traffic.pool[0];
    g.active = true;
    g.kind = ObstacleKind.Gate;
    g.openingHalfWidth = 6; // wide opening centred on the road → an easy clean thread
    g.laneOffset = 0;
    g.sway = 0;
    g.swayPhase = 0;
    g.consumed = false;
    g.passed = false;
    g.speed = 0;
    g.distance = game.distance + 0.5; // just ahead → threads within a step or two
    for (let i = 0; i < 6 && !g.passed; i++) update(game, intent, TIMESTEP);
  }

  // Force a deterministic NON-FATAL gate-wall miss (opening hard to one side, car
  // at centre → wall-hit on the next step). Mirrors gamestate.test.ts's helper.
  function forceWallMiss(game: GameState): void {
    const center = roadCenterAt(game.seed, game.distance);
    game.vehicle.lateral = center;
    const g = game.traffic.pool.find((o) => !o.active) ?? game.traffic.pool[0];
    g.active = true;
    g.kind = ObstacleKind.Gate;
    g.openingHalfWidth = 2.6;
    g.laneOffset = 9; // opening hard to one side → centre car is OUTSIDE it
    g.sway = 0;
    g.swayPhase = 0;
    g.consumed = false;
    g.passed = false;
    g.speed = 0;
    g.distance = game.distance + 0.5;
    update(game, intent, TIMESTEP);
  }

  it('cleanMultiplier steps up per clean gate (super-linear score), then a wall miss resets it', () => {
    const game = startRun(createGameState(123), undefined, undefined, 123, undefined, GameMode.DailySlalom);
    expect(game.slalomScore.cleanMultiplier).toBe(DAILY_SCORING.cleanStart); // 1
    expect(game.slalomScore.gatesThreaded).toBe(0);

    const N = 5;
    const deltas: number[] = [];
    let prevScore = game.slalomScore.score;
    for (let k = 0; k < N; k++) {
      const threadsBefore = game.slalomScore.gatesThreaded;
      threadCenteredGate(game);
      expect(game.slalomScore.gatesThreaded).toBe(threadsBefore + 1); // exactly one clean thread
      // cleanMultiplier climbs by cleanStep each clean gate (integer-stepped), capped.
      expect(game.slalomScore.cleanMultiplier).toBe(
        Math.min(DAILY_SCORING.cleanStart + (k + 1) * DAILY_SCORING.cleanStep, DAILY_SCORING.cleanMax),
      );
      deltas.push(game.slalomScore.score - prevScore);
      prevScore = game.slalomScore.score;
    }

    // Score is SUPER-LINEAR while clean: each gate scores base × accuracy ×
    // cleanMultiplier at a RISING multiplier, so each gate's contribution strictly
    // exceeds the previous one.
    for (let k = 1; k < N; k++) expect(deltas[k]).toBeGreaterThan(deltas[k - 1]);
    expect(game.slalomScore.score).toBeGreaterThan(0);

    // A wall miss BREAKS the streak: the multiplier resets to its floor, but the
    // score already banked is RETAINED (not zeroed) and a life is spent (non-fatal).
    const bankedBeforeMiss = game.slalomScore.score;
    const livesBefore = game.lives;
    forceWallMiss(game);
    expect(game.slalomScore.cleanMultiplier).toBe(DAILY_SCORING.cleanStart); // reset to floor
    expect(game.slalomScore.score).toBeCloseTo(bankedBeforeMiss, 6); // banked score kept
    expect(game.lives).toBe(livesBefore - 1); // cost a life
    expect(game.phase).toBe(Phase.Playing); // run continues (non-fatal)
  });
});

// ---------------------------------------------------------------------------
// #A3 — classic graze gradient: mover weight × closeness
// ---------------------------------------------------------------------------
describe('L1 #A3 — classic graze gradient (mover weight × closeness)', () => {
  // Resolve ONE just-passed MOVER at a known lateral gap and return the resulting
  // combo + events. Player sits at (0,0); the obstacle is placed BEHIND (distance
  // -50) so it counts as passed but never overlaps the collision AABB — isolating
  // the graze gradient from the collision band. Mirrors graze_scoring.test.ts but
  // uses a MOVER (weight 2) to pin the weight × graze COMPOSITION.
  function resolveMoverGap(gap: number): { combo: number; events: TrafficEvents } {
    const traffic = createTrafficState();
    const o = traffic.pool[0];
    o.active = true;
    o.passed = false;
    o.kind = ObstacleKind.Mover;
    o.lateral = gap; // player at 0 → lateral gap == gap
    o.distance = -50; // well behind → passed, no longitudinal overlap (no crash)
    o.sway = 0;
    const score = createScoreState();
    const events: TrafficEvents = { crashed: false, nearMisses: 0 };
    resolveTraffic(events, score, 0, 0, traffic);
    return { combo: score.combo, events };
  }

  // Expected combo for a mover near-miss at `gap`: baseCombo + comboStep ×
  // moverNearMissWeight × grazeMultiplier(gap), capped at maxCombo.
  const expectedCombo = (gap: number): number =>
    Math.min(
      SCORING.baseCombo + SCORING.comboStep * SCORING.moverNearMissWeight * grazeMultiplier(gap),
      SCORING.maxCombo,
    );

  it('a close pass scores the full composed step; a far-but-still-near pass much less', () => {
    const closeGap = 2.5; // near the collision boundary → grazeMultiplier near grazeMax
    const farGap = SCORING.nearMissLateral - 0.2; // 3.8, just inside the outer window → ~1.0

    const close = resolveMoverGap(closeGap);
    const far = resolveMoverGap(farGap);

    // Exact composition (the value this test adds over the static-based graze test).
    expect(close.combo).toBeCloseTo(expectedCombo(closeGap), 6);
    expect(far.combo).toBeCloseTo(expectedCombo(farGap), 6);

    // The gradient itself: closer pays strictly more.
    expect(close.combo).toBeGreaterThan(far.combo);

    // nearMissClosest surfaces the actual gap of the pass.
    expect(close.events.nearMissClosest).toBeCloseTo(closeGap, 9);
    expect(far.events.nearMissClosest).toBeCloseTo(farGap, 9);
  });
});

// ---------------------------------------------------------------------------
// #A4 — a threaded gate contributes NOTHING to classic score/combo (mode parity)
// ---------------------------------------------------------------------------
describe('L1 #A4 — gate threading leaves the classic ScoreState untouched in both modes', () => {
  // Thread a gate via the mode-agnostic resolveTraffic seam in a given mode and
  // return the run. The gate-thread EVENT fires in BOTH modes (slalom scoring
  // needs it), but a gate is a PURE obstacle for the classic ScoreState: no
  // near-miss, no combo, no classic points. Slalom's gate points go to the
  // SEPARATE slalomScore, never to `score`.
  //
  // NOTE: the #65 VISUAL leak (a classic gate-thread pulsing/chiming) lived in the
  // composition root (main.ts: `isSlalom(game) && gateThreaded`) and is NOT
  // L1-observable — its predicate is pinned in gamestate.test.ts and the pixel
  // behaviour is L2's job. This test locks the SIM contract underneath it.
  function threadGateInMode(mode: GameMode): GameState {
    const game = startRun(createGameState(5), undefined, undefined, 5, undefined, mode);
    const g = game.traffic.pool.find((o) => !o.active) ?? game.traffic.pool[0];
    g.active = true;
    g.kind = ObstacleKind.Gate;
    g.openingHalfWidth = 3;
    g.lateral = 0;
    g.laneOffset = 0;
    g.distance = game.distance - 1; // just behind the player → a fresh crossing
    g.passed = false;
    resolveTraffic(game.lastEvents, game.score, 0, game.distance, game.traffic);
    return game;
  }

  it('classic and slalom leave score/combo identical (and zero) after threading a gate', () => {
    const classic = threadGateInMode(GameMode.Classic);
    const slalom = threadGateInMode(GameMode.DailySlalom);

    for (const game of [classic, slalom]) {
      expect(game.lastEvents.gateThreaded).toBe(true); // the event fires in both modes
      expect(game.lastEvents.nearMisses).toBe(0); // a gate is NEVER a near-miss
      expect(game.score.combo).toBe(SCORING.baseCombo); // no combo from a gate
      expect(game.score.score).toBe(0); // no classic points from a gate
    }

    // Parity: the classic scoring state is identical across modes — a gate's
    // contribution to classic score/combo is exactly zero either way.
    expect(classic.score.score).toBe(slalom.score.score);
    expect(classic.score.combo).toBe(slalom.score.combo);
  });
});
