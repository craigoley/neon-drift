/**
 * Endless road as a RECYCLED POOL of fixed-length segments. PURE — no three.
 *
 * A fixed window of segments is kept around the player: `segmentsAhead` in front
 * plus `segmentsBehind` behind. As the player advances, any segment that falls
 * behind the window is recycled in place (its object is reused) to become the
 * next segment ahead — the pool never grows and nothing is allocated per frame.
 *
 * Each segment's lateral curve offset is a deterministic function of (seed,
 * index), so a given seed always reproduces exactly the same road regardless of
 * how the player drives it.
 */

import { hashNoise } from '../utils/rng';
import { ROAD } from '../utils/constants';

export interface RoadSegment {
  /** Global segment index from the start of the run (monotonic per recycle). */
  index: number;
  /** Distance (world units) of this segment's near edge from the run start. */
  start: number;
  /** Lateral centre offset of the road at this segment (the gentle curve). */
  curve: number;
}

export interface RoadState {
  /** Fixed-size pool of segment objects (length never changes after init). */
  segments: RoadSegment[];
  seed: number;
  /** Telemetry: total segments ever spawned (initial fill + recycles). */
  spawned: number;
  /** Telemetry: total recycle events. */
  recycled: number;
}

/** Pool capacity: the full window plus the player's current segment. */
export function poolSize(): number {
  return ROAD.segmentsAhead + ROAD.segmentsBehind + 1;
}

/**
 * Deterministic, smooth curve offset for a segment index under a given seed.
 * A low-frequency sine gives sweeping bends; the seed sets the phase so different
 * seeds produce different — but per-seed reproducible — roads.
 */
function curveFor(seed: number, index: number): number {
  const phase = hashNoise(seed, 0) * Math.PI;
  return Math.sin(index * ROAD.curveFrequency + phase) * ROAD.curveAmplitude;
}

/**
 * The lateral centre of the road at an arbitrary forward `distance`. Same curve
 * as `curveFor` but evaluated at the FRACTIONAL segment index, so the centre is
 * smooth and continuous (no per-segment steps). Pure — the gameplay layer uses
 * this to make the drivable corridor (and traffic spawns) follow the bend, so
 * the curve shifts the lateral challenge instead of being purely cosmetic.
 */
export function roadCenterAt(seed: number, distance: number): number {
  const phase = hashNoise(seed, 0) * Math.PI;
  const index = distance / ROAD.segmentLength;
  return Math.sin(index * ROAD.curveFrequency + phase) * ROAD.curveAmplitude;
}

export function createRoadState(seed: number): RoadState {
  const count = poolSize();
  const segments: RoadSegment[] = [];
  for (let index = 0; index < count; index++) {
    segments.push({ index, start: index * ROAD.segmentLength, curve: curveFor(seed, index) });
  }
  return { segments, seed, spawned: count, recycled: 0 };
}

/**
 * Recycle any segment that has fallen behind the player's window into a fresh
 * segment at the front. Mutates `state` in place; allocates nothing.
 *
 * Window indices are exactly {lowIndex .. highIndex}, a contiguous run of
 * `poolSize()` values. A lagging segment is lifted by `poolSize()` — which lands
 * it precisely in the gap at the top of the window — preserving the contiguous,
 * unique set.
 */
export function updateRoad(state: RoadState, distance: number): RoadState {
  const playerIndex = Math.floor(distance / ROAD.segmentLength);
  const lowIndex = playerIndex - ROAD.segmentsBehind;
  const size = poolSize();

  for (const seg of state.segments) {
    while (seg.index < lowIndex) {
      seg.index += size;
      seg.start = seg.index * ROAD.segmentLength;
      seg.curve = curveFor(state.seed, seg.index);
      state.spawned++;
      state.recycled++;
    }
  }
  return state;
}

/** Active segment count (always the fixed pool size — exposed for telemetry). */
export function activeSegmentCount(state: RoadState): number {
  return state.segments.length;
}
