/**
 * Traffic / obstacle generation. PURE — no three, no DOM, no global RNG. Spawn
 * decisions are driven by an injected random source so tests are deterministic.
 */

import { clamp } from '../utils/math';
import { ROAD, TRAFFIC } from '../utils/constants';

export interface Obstacle {
  /** Monotonic id, unique within a run. */
  id: number;
  /** Lane index the obstacle occupies, 0..laneCount-1. */
  lane: number;
  /** World-space Z; starts far ahead (very negative) and streams toward 0. */
  z: number;
}

export interface TrafficState {
  obstacles: Obstacle[];
  /** Seconds since the last spawn. */
  sinceSpawn: number;
  /** Next obstacle id to assign. */
  nextId: number;
}

export function createTrafficState(): TrafficState {
  return { obstacles: [], sinceSpawn: 0, nextId: 0 };
}

/** A source of randomness in [0, 1). `Math.random` in the browser, seeded in tests. */
export type RandomSource = () => number;

/** The spawn interval shrinks with elapsed play time, down to a floor. */
export function spawnInterval(elapsed: number): number {
  return clamp(
    TRAFFIC.spawnInterval - elapsed * TRAFFIC.difficultyRamp,
    TRAFFIC.minSpawnInterval,
    TRAFFIC.spawnInterval,
  );
}

/**
 * Advance traffic by `dt` seconds. Obstacles move toward the player at the
 * player's speed; new ones spawn on the difficulty cadence. Obstacles that pass
 * behind the player are culled. Returns a new state — never mutates the input.
 */
export function updateTraffic(
  state: TrafficState,
  dt: number,
  elapsed: number,
  playerSpeed: number,
  random: RandomSource,
): TrafficState {
  // Stream existing obstacles toward the camera, dropping any that passed us.
  const moved = state.obstacles
    .map((o) => ({ ...o, z: o.z + playerSpeed * dt }))
    .filter((o) => o.z < ROAD.segmentLength);

  let { sinceSpawn, nextId } = state;
  sinceSpawn += dt;

  if (sinceSpawn >= spawnInterval(elapsed)) {
    sinceSpawn = 0;
    const lane = Math.floor(random() * ROAD.laneCount);
    moved.push({
      id: nextId,
      lane,
      z: -ROAD.segmentLength * ROAD.visibleSegments,
    });
    nextId += 1;
  }

  return { obstacles: moved, sinceSpawn, nextId };
}
