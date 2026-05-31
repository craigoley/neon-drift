import { describe, expect, it } from 'vitest';
import { createGameState, Phase, startRun, update } from '../GameState';
import { activeSegmentCount, createRoadState, poolSize, updateRoad } from '../Road';
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
    // eslint-disable-next-line no-console
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
    // Force a crash by parking an obstacle dead-centre on the player.
    const o = game.traffic.pool[0];
    o.active = true;
    o.lateral = 0;
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
