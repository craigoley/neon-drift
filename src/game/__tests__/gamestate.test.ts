import { describe, expect, it } from 'vitest';
import { createGameState, GameMode, isSlalom, Phase, pause, resume, returnToMenu, startRun, update } from '../GameState';
import { activeSegmentCount, createRoadState, poolSize, roadCenterAt, updateRoad } from '../Road';
import { activeObstacleCount, createTrafficState, updateTraffic } from '../Traffic';
import { createIntent } from '../Input';
import { Rng } from '../../utils/rng';
import { ObstacleKind, SCORING, SLALOM, TIMESTEP, TRAFFIC } from '../../utils/constants';
import { createScoreState, resolveTraffic, type TrafficEvents } from '../Scoring';

describe('GameState — full-loop integration & bounded pools', () => {
  it('road + traffic pools plateau (never climb) over a long surviving run', () => {
    // A surviving traversal (the renderer/player would be dodging). We advance
    // the road + traffic subsystems over a long distance to show that ACTIVE
    // counts plateau while the pool ARRAYS never grow and recycle/cull climb.
    const seed = 2024;
    const road = createRoadState(seed);
    const traffic = createTrafficState();
    const rng = new Rng(seed);

    const roadLen = road.segments.length;
    const trafficLen = traffic.pool.length;
    expect(roadLen).toBe(poolSize());
    expect(trafficLen).toBe(TRAFFIC.poolSize);

    let maxActiveSeg = 0;
    let maxActiveObs = 0;
    const samples: string[] = [];
    const speed = 160;
    let distance = 0;

    const steps = Math.round(120 / TIMESTEP); // ~120 s of survival
    for (let i = 0; i < steps; i++) {
      distance += speed * TIMESTEP;
      updateRoad(road, distance);
      updateTraffic(traffic, rng, seed, distance, TIMESTEP);
      // Pool ARRAYS never grow — this is the bounded-memory guarantee.
      expect(road.segments.length).toBe(roadLen);
      expect(traffic.pool.length).toBe(trafficLen);
      maxActiveSeg = Math.max(maxActiveSeg, activeSegmentCount(road));
      maxActiveObs = Math.max(maxActiveObs, activeObstacleCount(traffic));
      if (i % Math.round(20 / TIMESTEP) === 0) {
        samples.push(
          `t=${(i * TIMESTEP).toFixed(0)}s dist=${distance.toFixed(0)} ` +
            `road(active/spawned/recycled)=${activeSegmentCount(road)}/${road.spawned}/${road.recycled} ` +
            `traf(active/spawned/culled)=${activeObstacleCount(traffic)}/${traffic.spawned}/${traffic.culled}`,
        );
      }
    }
    console.log('[pool telemetry]\n' + samples.join('\n'));

    // Active counts are bounded by their pools (plateau, not climb).
    expect(maxActiveSeg).toBeLessThanOrEqual(poolSize());
    expect(maxActiveObs).toBeLessThanOrEqual(TRAFFIC.poolSize);
    // Cumulative counters DID climb — proving continuous recycling, not growth.
    expect(road.recycled).toBeGreaterThan(400);
    expect(traffic.culled).toBeGreaterThan(10);
  });

  it('with no steering the car drives straight and crashes (game over works)', () => {
    const game = startRun(createGameState(2024));
    const intent = createIntent();
    let steps = 0;
    const maxSteps = Math.round(120 / TIMESTEP);
    while (game.phase === Phase.Playing && steps < maxSteps) {
      update(game, intent, TIMESTEP);
      steps++;
    }
    expect(game.phase).toBe(Phase.Crashed);
    expect(game.distance).toBeGreaterThan(0);
  });

  it('crash ends the run and restart begins a fresh one', () => {
    const game = startRun(createGameState(5));
    // Force a crash by parking a static obstacle on the player. Its lateral is
    // resolved as roadCentre + laneOffset, so cancel the centre to land at the
    // player's lateral (0).
    const o = game.traffic.pool[0];
    o.active = true;
    o.laneOffset = -roadCenterAt(game.seed, game.distance);
    o.sway = 0;
    o.speed = 0;
    o.distance = game.distance;
    o.passed = false;
    update(game, createIntent(), TIMESTEP);
    expect(game.phase).toBe(Phase.Crashed);

    const restart = createIntent();
    restart.restart = true;
    update(game, restart, TIMESTEP);
    expect(game.phase).toBe(Phase.Playing);
    expect(game.distance).toBeGreaterThanOrEqual(0);
    expect(game.score.score).toBe(0);
  });
});

describe('GameState — menu/pause state machine', () => {
  const intent = createIntent();

  it('menu -> play -> crash -> menu -> play resets cleanly (no stale run carries over)', () => {
    const game = createGameState(9);
    expect(game.phase).toBe(Phase.Menu);

    // Play a bit.
    startRun(game);
    for (let i = 0; i < 120; i++) update(game, intent, TIMESTEP);
    expect(game.phase).toBe(Phase.Playing);
    expect(game.distance).toBeGreaterThan(0);

    // Force a crash.
    const o = game.traffic.pool[0];
    o.active = true;
    o.laneOffset = -roadCenterAt(game.seed, game.distance);
    o.sway = 0;
    o.speed = 0;
    o.distance = game.distance;
    o.passed = false;
    update(game, intent, TIMESTEP);
    expect(game.phase).toBe(Phase.Crashed);

    // Return to menu: fully reset, idle.
    returnToMenu(game);
    expect(game.phase).toBe(Phase.Menu);
    expect(game.distance).toBe(0);
    expect(game.time).toBe(0);
    expect(game.score.score).toBe(0);
    expect(activeObstacleCount(game.traffic)).toBe(0);

    // Idle in the menu — the sim must not advance.
    update(game, intent, TIMESTEP);
    expect(game.distance).toBe(0);

    // Play again from the menu — a clean run.
    startRun(game);
    expect(game.phase).toBe(Phase.Playing);
    expect(game.distance).toBe(0);
    expect(game.score.score).toBe(0);
  });

  it('startRun threads the run mode + an explicit seed (daily slalom run)', () => {
    const game = createGameState(1);
    // A normal run is classic; isSlalom is false.
    startRun(game);
    expect(game.mode).toBe(GameMode.Classic);
    expect(isSlalom(game)).toBe(false);

    // A daily run carries mode='dailySlalom' (so run-end routes to the daily store
    // and the sim branches) and the supplied fixed seed (same date = same road).
    const dailySeed = 2392771152; // dailySeed(2026-05-31), see daily_seed.test.ts
    startRun(game, undefined, undefined, dailySeed, undefined, GameMode.DailySlalom);
    expect(game.mode).toBe(GameMode.DailySlalom);
    expect(isSlalom(game)).toBe(true);
    expect(game.seed).toBe(dailySeed);

    // Determinism: re-running the same seed reproduces an identical road layout.
    const curvesA = game.road.segments.map((s) => s.curve);
    startRun(game, undefined, undefined, dailySeed, undefined, GameMode.DailySlalom);
    const curvesB = game.road.segments.map((s) => s.curve);
    expect(curvesB).toEqual(curvesA);
  });

  it('slalom mode pins speed to the constant every step (no ramp, no drift scrub)', () => {
    const game = startRun(createGameState(7), undefined, undefined, 7, undefined, GameMode.DailySlalom);
    // Drift held the whole time — in classic this would scrub speed; in slalom the
    // constant must hold regardless (only the lateral juke survives).
    const drifting = { ...intent, handbrake: true };
    for (let i = 0; i < 600; i++) {
      update(game, drifting, TIMESTEP);
      if (game.phase !== Phase.Playing) break; // a straight run eventually clips a gate
      expect(game.vehicle.speed).toBeCloseTo(SLALOM.constantSpeed, 6);
    }
  });

  it('slalom mode spawns ONLY gates (zero static/mover/ramp traffic)', () => {
    const game = startRun(createGameState(13), undefined, undefined, 13, undefined, GameMode.DailySlalom);
    for (let i = 0; i < 1200; i++) update(game, intent, TIMESTEP);
    const active = game.traffic.pool.filter((o) => o.active);
    expect(active.length).toBeGreaterThan(0); // gates are streaming
    for (const o of active) expect(o.kind).toBe(ObstacleKind.Gate);
    expect(game.traffic.spawned).toBeGreaterThan(0);
  });

  it('a clean gate thread surfaces a gate-thread event (centeredness), NOT a near-miss', () => {
    const t = createTrafficState();
    const g = t.pool[0];
    g.active = true;
    g.kind = ObstacleKind.Gate;
    g.openingHalfWidth = 3;
    g.lateral = 0;
    g.laneOffset = 0;
    g.distance = 99; // just behind the player → a fresh crossing
    g.passed = false;
    const score = createScoreState();
    const events: TrafficEvents = { crashed: false, nearMisses: 0 };
    resolveTraffic(events, score, 0, 100, t); // dead-centre thread
    expect(events.crashed).toBe(false);
    expect(events.gateThreaded).toBe(true);
    expect(events.gateCenteredness).toBeCloseTo(1, 6); // dead centre
    expect(events.nearMisses).toBe(0); // gates produce NO near-miss
    expect(score.combo).toBe(SCORING.baseCombo); // and NO combo
  });

  it('slalom suppresses the classic distance integral; classic still accrues score', () => {
    const slalomGame = startRun(createGameState(7), undefined, undefined, 7, undefined, GameMode.DailySlalom);
    const classicGame = startRun(createGameState(7));
    for (let i = 0; i < 30; i++) {
      update(slalomGame, intent, TIMESTEP);
      update(classicGame, intent, TIMESTEP);
    }
    // Classic runs the speed×combo integral → score climbs immediately.
    expect(classicGame.score.score).toBeGreaterThan(0);
    // Slalom does NOT (its score is event-driven per gate) — and no gate is
    // reached this early, so the classic score stays exactly 0 and no near-miss
    // ever engages the classic combo.
    expect(slalomGame.score.score).toBe(0);
    expect(slalomGame.score.combo).toBe(SCORING.baseCombo);
  });

  it('pause halts the sim; resume continues from the same spot', () => {
    const game = startRun(createGameState(3));
    for (let i = 0; i < 60; i++) update(game, intent, TIMESTEP);
    const distAtPause = game.distance;

    pause(game);
    expect(game.phase).toBe(Phase.Paused);
    for (let i = 0; i < 120; i++) update(game, intent, TIMESTEP); // frozen
    expect(game.distance).toBe(distAtPause);

    resume(game);
    expect(game.phase).toBe(Phase.Playing);
    update(game, intent, TIMESTEP);
    expect(game.distance).toBeGreaterThan(distAtPause);
  });

  it('pause/resume only act from the matching phase', () => {
    const menu = createGameState();
    pause(menu);
    expect(menu.phase).toBe(Phase.Menu); // can't pause the menu
    resume(menu);
    expect(menu.phase).toBe(Phase.Menu);
  });
});
