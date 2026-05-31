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
  /** Absolute lateral position (the live value: road centre + lane offset +
   *  any sway, clamped to the road). 0 = world centre. */
  lateral: number;
  /** Lane position as an offset from the road centre, so the obstacle tracks
   *  the road through bends instead of holding an absolute line. */
  laneOffset: number;
  /** Sway amplitude (world units); 0 = a static obstacle holding its lane. */
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
      laneOffset: 0,
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
 * Absolute lateral for an obstacle: the road centre at its current distance,
 * plus its lane offset, plus any sway — clamped to the drivable corridor so it
 * always sits on the road through bends. Pure.
 */
function resolveLateral(o: Obstacle, seed: number): number {
  const center = roadCenterAt(seed, o.distance);
  const sway = o.sway > 0 ? Math.sin(o.swayPhase) * o.sway : 0;
  return clamp(center + o.laneOffset + sway, center - ROAD.halfWidth, center + ROAD.halfWidth);
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
  // Move + resolve lateral against the curve + cull.
  const cullLine = playerDistance - TRAFFIC.cullBehind;
  for (const o of state.pool) {
    if (!o.active) continue;
    o.distance += o.speed * dt;
    // Movers advance their sway phase; static obstacles hold their lane offset.
    if (o.sway > 0) o.swayPhase += TRAFFIC.swayRate * dt;
    o.lateral = resolveLateral(o, seed);
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
      // Pick a lane as an offset from the road centre; resolveLateral maps it to
      // an absolute position on the curved road each frame.
      slot.laneOffset = rng.range(-spread, spread);
      // A fraction become lane-changing movers.
      if (rng.next() < TRAFFIC.moverFraction) {
        slot.sway = rng.range(TRAFFIC.swayAmplitudeMin, TRAFFIC.swayAmplitudeMax);
        slot.swayPhase = rng.range(0, Math.PI * 2);
      } else {
        slot.sway = 0;
        slot.swayPhase = 0;
      }
      slot.speed = rng.range(TRAFFIC.minSpeed, TRAFFIC.maxSpeed);
      slot.distance = playerDistance + TRAFFIC.spawnAhead;
      slot.lateral = resolveLateral(slot, seed);
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
