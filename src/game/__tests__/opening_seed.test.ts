import { describe, expect, it } from 'vitest';
import { createGameState, returnToMenu, startRun } from '../GameState';
import { activeObstacleCount } from '../Traffic';
import { roadCenterAt } from '../Road';
import { ObstacleKind, OPENING_SEED } from '../../utils/constants';

describe('Opening seed — one easy obstacle at run start (OPP-01)', () => {
  it('seeds exactly one dead-centre STATIC obstacle ~200m ahead', () => {
    const game = startRun(createGameState(7));
    const active = game.traffic.pool.filter((o) => o.active);
    expect(active).toHaveLength(1);

    const o = active[0];
    expect(o.kind).toBe(ObstacleKind.Static); // not gate/ramp/mover — predictable + easy
    expect(o.distance).toBeCloseTo(OPENING_SEED.distance); // ~200m ahead of the start
    expect(o.speed).toBe(OPENING_SEED.speed); // stationary → reached promptly
    expect(o.passed).toBe(false); // can still register a near-miss when overtaken
    expect(o.sway).toBe(0); // no sway (Static)
    // laneOffset 0 → sits on the road centre at that distance (an easy steer-around).
    expect(o.lateral).toBeCloseTo(roadCenterAt(game.seed, OPENING_SEED.distance), 6);
  });

  it('does NOT seed on the menu, and RE-seeds on every fresh run (incl. restart)', () => {
    const game = startRun(createGameState(3));
    expect(activeObstacleCount(game.traffic)).toBe(1);

    returnToMenu(game);
    expect(activeObstacleCount(game.traffic)).toBe(0); // menu stays empty

    startRun(game);
    expect(activeObstacleCount(game.traffic)).toBe(1); // fresh run re-seeds
  });

  it('the seed is a normal pooled obstacle (counts as spawned, leaves the rest free)', () => {
    const game = startRun(createGameState(11));
    expect(game.traffic.spawned).toBe(1); // the seed counts as one spawn
    // Only slot 0 is claimed — the timer can still spawn into the other 23.
    expect(game.traffic.pool.filter((o) => !o.active)).toHaveLength(game.traffic.pool.length - 1);
  });
});
