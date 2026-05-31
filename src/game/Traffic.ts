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
import { roadCenterAt } from './Road';
import type { Rng } from '../utils/rng';

export interface Obstacle {
  active: boolean;
  /** Unique id within a run (stable while active; for renderer pooling). */
  id: number;
  /** Lateral position, 0 = centre (the live value, after any sway). */
  lateral: number;
  /** Lane centre this obstacle was spawned on; movers sway about it. */
  baseLateral: number;
  /** Sway amplitude (world units); 0 = a static obstacle holding its line. */
  sway: number;
  /** Current sway phase (radians); advanced each frame for movers. */
  swayPhase: number;
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
    pool.push({
      active: false,
      id: -1,
      lateral: 0,
      baseLateral: 0,
      sway: 0,
      swayPhase: 0,
      distance: 0,
      speed: 0,
      passed: false,
    });
  }
  return { pool, sinceSpawn: 0, nextId: 0, spawned: 0, culled: 0 };
}

/** Spawn interval (seconds) for a given distance — flat through the grace
 *  period, then shrinks toward a floor as difficulty ramps. */
export function spawnInterval(distance: number): number {
  const ramped = Math.max(0, distance - TRAFFIC.rampStartDistance);
  return clamp(
    TRAFFIC.baseSpawnInterval - ramped * TRAFFIC.spawnRampPerUnit,
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
  seed: number,
  playerDistance: number,
  dt: number,
): TrafficState {
  // Move + cull + sway.
  const cullLine = playerDistance - TRAFFIC.cullBehind;
  for (const o of state.pool) {
    if (!o.active) continue;
    o.distance += o.speed * dt;
    // Movers drift laterally about their lane; static obstacles hold their line.
    if (o.sway > 0) {
      o.swayPhase += TRAFFIC.swayRate * dt;
      o.lateral = o.baseLateral + Math.sin(o.swayPhase) * o.sway;
    }
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
      const spawnDistance = playerDistance + TRAFFIC.spawnAhead;
      // Spawn relative to the curved road centre so traffic sits on the road
      // through bends, not in a fixed absolute lane.
      const center = roadCenterAt(seed, spawnDistance);
      slot.active = true;
      slot.id = state.nextId++;
      slot.baseLateral = clamp(center + rng.range(-spread, spread), -ROAD.halfWidth, ROAD.halfWidth);
      // A fraction become lane-changing movers.
      if (rng.next() < TRAFFIC.moverFraction) {
        slot.sway = rng.range(TRAFFIC.swayAmplitudeMin, TRAFFIC.swayAmplitudeMax);
        slot.swayPhase = rng.range(0, Math.PI * 2);
      } else {
        slot.sway = 0;
        slot.swayPhase = 0;
      }
      slot.lateral = slot.baseLateral + Math.sin(slot.swayPhase) * slot.sway;
      slot.speed = rng.range(TRAFFIC.minSpeed, TRAFFIC.maxSpeed);
      slot.distance = spawnDistance;
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
