/**
 * Traffic / obstacle spawning as a RECYCLED POOL. PURE — no three.
 *
 * A fixed-size pool of obstacle objects is allocated once. Spawning activates an
 * inactive slot; culling (once an obstacle falls behind the player) deactivates
 * it back into the pool. The pool never grows and nothing is allocated per
 * frame. Spawn density rises with distance travelled.
 *
 * Each slot carries a `kind` (see ObstacleKind) so a SINGLE pool supports four
 * behaviours — static, lane-changing mover, gate (barrier + opening) and ramp
 * (beneficial boost-strip) — via per-type spawn config + update logic, never a
 * forked parallel pool. The spawn MIX ramps with distance (per-kind weights);
 * the spawn DENSITY (interval) ramps separately.
 *
 * Randomness comes from an injected seeded Rng so runs are reproducible.
 */

import { clamp } from '../utils/math';
import {
  GATE,
  OBSTACLE_DEFS,
  OBSTACLE_ORDER,
  ObstacleKind,
  OPENING_SEED,
  ROAD,
  TRAFFIC,
} from '../utils/constants';
import { roadCenterAt } from './Road';
import type { Rng } from '../utils/rng';

export interface Obstacle {
  active: boolean;
  /** Unique id within a run (stable while active; for renderer pooling). */
  id: number;
  /** Behaviour type — drives spawn config, movement and collision. */
  kind: ObstacleKind;
  /** Absolute lateral position (the live value: road centre + lane offset +
   *  any sway, clamped to the road). 0 = world centre. For a GATE this is the
   *  centre of the passable opening. */
  lateral: number;
  /** Lane position as an offset from the road centre, so the obstacle tracks
   *  the road through bends instead of holding an absolute line. */
  laneOffset: number;
  /** Sway amplitude (world units); 0 = a static obstacle holding its lane.
   *  Only MOVERS sway. */
  sway: number;
  /** Current sway phase (radians); advanced each frame for movers. */
  swayPhase: number;
  /** GATE only: half-width of the passable opening (0 for other kinds). */
  openingHalfWidth: number;
  /** RAMP only: true once its boost has been applied (so it fires exactly once). */
  consumed: boolean;
  /** Forward distance from the run start (world units). */
  distance: number;
  /** Forward speed (world units / second) — slower than the player. Gates and
   *  ramps are stationary (0); static/mover obstacles roll forward. */
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
      kind: ObstacleKind.Static,
      lateral: 0,
      laneOffset: 0,
      sway: 0,
      swayPhase: 0,
      openingHalfWidth: 0,
      consumed: false,
      distance: 0,
      speed: 0,
      passed: false,
    });
  }
  return { pool, sinceSpawn: 0, nextId: 0, spawned: 0, culled: 0 };
}

/**
 * Place ONE easy obstacle near the start of a fresh run (see OPENING_SEED) so the
 * opening has an immediate, low-stakes steer-around decision instead of empty
 * road. Claims pool slot 0 (always free in a freshly-created state) and activates
 * it as a dead-centre STATIC obstacle a short distance ahead. Sets fields
 * DIRECTLY (no rng draws) so the deterministic traffic sequence is unperturbed.
 * Call once from startRun, after createTrafficState. Pure.
 */
export function seedOpeningObstacle(state: TrafficState, seed: number): void {
  const slot = state.pool[0];
  slot.active = true;
  slot.id = state.nextId++;
  slot.kind = ObstacleKind.Static; // easy + predictable (not gate/ramp/mover)
  slot.sway = 0;
  slot.swayPhase = 0;
  slot.openingHalfWidth = 0;
  slot.consumed = false;
  slot.laneOffset = OPENING_SEED.laneOffset;
  slot.speed = OPENING_SEED.speed;
  slot.distance = OPENING_SEED.distance; // run starts at distance 0 → absolute ahead
  slot.lateral = resolveLateral(slot, seed);
  slot.passed = false;
  state.spawned++;
}

/** Spawn interval (seconds) for a given distance — flat through the grace
 *  period, then shrinks toward a floor as difficulty ramps. This is the spawn
 *  DENSITY; the spawn MIX is a separate per-kind weighting (see kindWeightAt). */
export function spawnInterval(distance: number): number {
  const ramped = Math.max(0, distance - TRAFFIC.rampStartDistance);
  return clamp(
    TRAFFIC.baseSpawnInterval - ramped * TRAFFIC.spawnRampPerUnit,
    TRAFFIC.minSpawnInterval,
    TRAFFIC.baseSpawnInterval,
  );
}

/**
 * Spawn MIX weight for a kind at a given distance. The kind is unavailable
 * before its `startDistance`; past it the weight ramps linearly from `weightBase`
 * toward `weightMax`. Drives which behaviours appear as the run escalates.
 */
export function kindWeightAt(kind: ObstacleKind, distance: number): number {
  const def = OBSTACLE_DEFS[kind];
  if (distance < def.startDistance) return 0;
  return clamp(def.weightBase + def.weightPerUnit * (distance - def.startDistance), 0, def.weightMax);
}

/** Weighted random pick of an obstacle kind for the given distance. */
export function pickKind(rng: Rng, distance: number): ObstacleKind {
  let total = 0;
  for (const k of OBSTACLE_ORDER) total += kindWeightAt(k, distance);
  if (total <= 0) return ObstacleKind.Static; // before any unlock (shouldn't happen: static is always on)
  let roll = rng.next() * total;
  for (const k of OBSTACLE_ORDER) {
    roll -= kindWeightAt(k, distance);
    if (roll < 0) return k;
  }
  return ObstacleKind.Static;
}

/** Count of currently-active obstacles (telemetry). */
export function activeObstacleCount(state: TrafficState): number {
  let n = 0;
  for (const o of state.pool) if (o.active) n++;
  return n;
}

/** Count of currently-active obstacles of a given kind (debug funnel). */
export function activeObstacleCountByKind(state: TrafficState, kind: ObstacleKind): number {
  let n = 0;
  for (const o of state.pool) if (o.active && o.kind === kind) n++;
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

/** Configure a freshly-activated slot for its kind. Pure given the slot's
 *  distance + rng. */
function configureForKind(slot: Obstacle, kind: ObstacleKind, rng: Rng): void {
  // Reset all per-kind fields to a clean baseline, then set what the kind needs.
  slot.kind = kind;
  slot.sway = 0;
  slot.swayPhase = 0;
  slot.openingHalfWidth = 0;
  slot.consumed = false;

  const spread = ROAD.halfWidth * TRAFFIC.lateralSpread;
  switch (kind) {
    case ObstacleKind.Static:
      slot.laneOffset = rng.range(-spread, spread);
      slot.speed = rng.range(TRAFFIC.minSpeed, TRAFFIC.maxSpeed);
      break;
    case ObstacleKind.Mover:
      slot.laneOffset = rng.range(-spread, spread);
      slot.speed = rng.range(TRAFFIC.minSpeed, TRAFFIC.maxSpeed);
      slot.sway = rng.range(TRAFFIC.swayAmplitudeMin, TRAFFIC.swayAmplitudeMax);
      slot.swayPhase = rng.range(0, Math.PI * 2);
      break;
    case ObstacleKind.Gate: {
      // A stationary barrier; pick an opening half-width, then place the opening
      // centre so the whole opening fits on the road (no clamping needed).
      const ohw = rng.range(GATE.openingHalfWidthMin, GATE.openingHalfWidthMax);
      slot.openingHalfWidth = ohw;
      const room = Math.max(0, ROAD.halfWidth - ohw);
      slot.laneOffset = rng.range(-room, room);
      slot.speed = 0;
      break;
    }
    case ObstacleKind.Ramp:
      // A stationary beneficial strip somewhere on the road.
      slot.laneOffset = rng.range(-spread, spread);
      slot.speed = 0;
      break;
  }
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
    // Movers advance their sway phase; everything else holds its lane offset.
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
      slot.active = true;
      slot.id = state.nextId++;
      // Pick a behaviour by the distance-scaled mix, then configure the slot.
      configureForKind(slot, pickKind(rng, playerDistance), rng);
      slot.distance = playerDistance + TRAFFIC.spawnAhead;
      slot.lateral = resolveLateral(slot, seed);
      slot.passed = false;
      state.spawned++;
    }
    // Whether or not a slot was free, defer one interval rather than busy-retrying.
    state.sinceSpawn = 0;
  }

  return state;
}
