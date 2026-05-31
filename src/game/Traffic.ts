/**
 * Traffic / obstacle spawning as a RECYCLED POOL. PURE — no three.
 *
 * A fixed-size pool of obstacle objects is allocated once. Spawning activates an
 * inactive slot; culling (once an obstacle falls behind the player) deactivates
 * it back into the pool. The pool never grows and nothing is allocated per
 * frame. Spawn density rises with distance travelled.
 *
 * Randomness comes from an injected seeded Rng so runs are reproducible.
 */

import { clamp } from '../utils/math';
import { ROAD, TRAFFIC } from '../utils/constants';
import type { Rng } from '../utils/rng';

export interface Obstacle {
  active: boolean;
  /** Unique id within a run (stable while active; for renderer pooling). */
  id: number;
  /** Lateral position, 0 = centre. */
  lateral: number;
  /** Forward distance from the run start (world units). */
  distance: number;
  /** Forward speed (world units / second) — slower than the player. */
  speed: number;
  /** True once the player has drawn level with / passed this obstacle. */
  passed: boolean;
}

export interface TrafficState {
  /** Fixed-size pool (length never changes after init). */
  pool: Obstacle[];
  /** Seconds since the last spawn. */
  sinceSpawn: number;
  /** Next obstacle id to assign. */
  nextId: number;
  /** Telemetry: total obstacles ever spawned. */
  spawned: number;
  /** Telemetry: total obstacles ever culled. */
  culled: number;
}

export function createTrafficState(): TrafficState {
  const pool: Obstacle[] = [];
  for (let i = 0; i < TRAFFIC.poolSize; i++) {
    pool.push({ active: false, id: -1, lateral: 0, distance: 0, speed: 0, passed: false });
  }
  return { pool, sinceSpawn: 0, nextId: 0, spawned: 0, culled: 0 };
}

/** Spawn interval (seconds) for a given distance — shrinks toward a floor. */
export function spawnInterval(distance: number): number {
  return clamp(
    TRAFFIC.baseSpawnInterval - distance * TRAFFIC.spawnRampPerUnit,
    TRAFFIC.minSpawnInterval,
    TRAFFIC.baseSpawnInterval,
  );
}

/** Count of currently-active obstacles (telemetry). */
export function activeObstacleCount(state: TrafficState): number {
  let n = 0;
  for (const o of state.pool) if (o.active) n++;
  return n;
}

function firstInactive(state: TrafficState): Obstacle | null {
  for (const o of state.pool) if (!o.active) return o;
  return null;
}

/**
 * Advance traffic by `dt` seconds. Moves active obstacles forward, culls those
 * behind the player, and spawns new ones on the difficulty cadence. Mutates and
 * returns `state`; allocates nothing.
 */
export function updateTraffic(
  state: TrafficState,
  rng: Rng,
  playerDistance: number,
  dt: number,
): TrafficState {
  // Move + cull.
  const cullLine = playerDistance - TRAFFIC.cullBehind;
  for (const o of state.pool) {
    if (!o.active) continue;
    o.distance += o.speed * dt;
    if (o.distance < cullLine) {
      o.active = false;
      state.culled++;
    }
  }

  // Spawn on cadence.
  state.sinceSpawn += dt;
  if (state.sinceSpawn >= spawnInterval(playerDistance)) {
    const slot = firstInactive(state);
    if (slot) {
      const spread = ROAD.halfWidth * TRAFFIC.lateralSpread;
      slot.active = true;
      slot.id = state.nextId++;
      slot.lateral = rng.range(-spread, spread);
      slot.speed = rng.range(TRAFFIC.minSpeed, TRAFFIC.maxSpeed);
      slot.distance = playerDistance + TRAFFIC.spawnAhead;
      slot.passed = false;
      state.spawned++;
      state.sinceSpawn = 0;
    } else {
      // Pool saturated — defer one interval rather than busy-retrying.
      state.sinceSpawn = 0;
    }
  }

  return state;
}
