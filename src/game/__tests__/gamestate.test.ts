import { describe, expect, it } from 'vitest';
import { createGameState, Phase, pause, resume, returnToMenu, startRun, update } from '../GameState';
import { activeSegmentCount, createRoadState, poolSize, roadCenterAt, updateRoad } from '../Road';
import { activeObstacleCount, createTrafficState, updateTraffic } from '../Traffic';
import { createIntent } from '../Input';
import { Rng } from '../../utils/rng';
import { TIMESTEP, TRAFFIC } from '../../utils/constants';

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

  it('startRun threads the isDaily flag + an explicit seed (OPP-09 daily run)', () => {
    const game = createGameState(1);
    // A normal run is not daily.
    startRun(game);
    expect(game.isDaily).toBe(false);

    // A daily run carries the flag (so run-end routes to the daily store) and the
    // supplied fixed seed (so the same date replays the SAME road).
    const dailySeed = 2392771152; // dailySeed(2026-05-31), see daily_seed.test.ts
    startRun(game, undefined, undefined, dailySeed, undefined, true);
    expect(game.isDaily).toBe(true);
    expect(game.seed).toBe(dailySeed);

    // Determinism: re-running the same seed reproduces an identical road layout.
    const curvesA = game.road.segments.map((s) => s.curve);
    startRun(game, undefined, undefined, dailySeed, undefined, true);
    const curvesB = game.road.segments.map((s) => s.curve);
    expect(curvesB).toEqual(curvesA);
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
