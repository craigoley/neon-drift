/**
 * ZEN LANDMARKS model — the PURE logic for the rare neon STRUCTURES you spot from afar and
 * journey to (no three, no DOM → Node-testable). Owns the parts that must be exactly right +
 * tested: position-DETERMINISTIC placement (RARER than ramps — a beacon, not litter), the
 * derived TYPE per landmark, and the SOLID-part geometry (so drive-through vs solid is
 * correct). The three.js meshes + reach effects live in ZenLandmarks; the minimap reads
 * `landmarksInRadius` to mark them.
 *
 * Placement mirrors the ramp/mountain-mask recipe — a low-frequency CELL hash keyed to world
 * coords (path-independent, seamless), gated to GENTLE terrain so you can actually reach them —
 * but on a much bigger cell with a single gate, so landmarks are sparse + special.
 */

import { hashNoise } from '../utils/rng';
import { lerp } from '../utils/math';
import { ZEN, ZEN_LANDMARK } from '../utils/constants';
import { chunkKey } from './ZenWorld';
import { maskAt } from './ZenHeight';

/** The landmark TYPES (this PR's three). Structural ids, not tuning — extend with more kinds
 *  as easy follow-ups (each just adds a mesh + any reach flavour). */
export const LANDMARK_ARCH = 0;
export const LANDMARK_MONOLITH = 1;
export const LANDMARK_RING = 2;
export const LANDMARK_TYPE_COUNT = 3;
export type LandmarkType = 0 | 1 | 2;

export interface Landmark {
  /** Stable id (the cell key) — used to key meshes + debounce the reach moment. */
  id: number;
  type: LandmarkType;
  /** World position (sits on heightAt — the renderer anchors Y). */
  x: number;
  z: number;
  /** Yaw (radians) + uniform scale. */
  rotationY: number;
  scale: number;
}

/** Decorrelate landmark placement from props/ramps/mask/mountains. */
const LANDMARK_SEED_OFFSET = 0x1a9d3;

/** One independent 0..1 value for (cell key, slot) — the same positional-hash pattern the
 *  rest of the Zen world uses, so placement is path-independent + repeatable. */
function unit(seed: number, key: number, slot: number): number {
  const idx = (Math.imul(key, 0x9e3779b1) + slot) | 0;
  return (hashNoise(seed, idx) + 1) * 0.5;
}

/**
 * The landmark in a given cell, or null if the cell carries none (the common case — landmarks
 * are RARE). Deterministic: depends only on (seed, cellX, cellZ). Gated to gentle terrain so the
 * structure is reachable (you can drive up to / through it).
 */
export function landmarkForCell(seed: number, cellX: number, cellZ: number): Landmark | null {
  const cs = ZEN_LANDMARK.cellSize;
  const key = chunkKey(cellX, cellZ);
  const lseed = (seed + LANDMARK_SEED_OFFSET) | 0;
  // RARE: most cells carry no landmark.
  if (unit(lseed, key, 0) > ZEN_LANDMARK.chance) return null;
  const m = ZEN_LANDMARK.edgeMargin;
  const x = cellX * cs + lerp(m, cs - m, unit(lseed, key, 1));
  const z = cellZ * cs + lerp(m, cs - m, unit(lseed, key, 2));
  // GENTLE, reachable ground only (no landmark buried in a mountain).
  if (maskAt(seed, x, z) > ZEN_LANDMARK.maxMask) return null;
  const type = Math.min(LANDMARK_TYPE_COUNT - 1, Math.floor(unit(lseed, key, 3) * LANDMARK_TYPE_COUNT)) as LandmarkType;
  const rotationY = unit(lseed, key, 4) * Math.PI * 2;
  const scale = ZEN_LANDMARK.scaleMin + unit(lseed, key, 5) * (ZEN_LANDMARK.scaleMax - ZEN_LANDMARK.scaleMin);
  return { id: key, type, x, z, rotationY, scale };
}

/**
 * Every landmark within `radius` of (carX, carZ) — live (no stored map): scan the landmark CELLS
 * overlapping the box, take each cell's gated landmark, keep those inside the circle. Bounded:
 * the cell span is ~(2·radius / cellSize)² (a small constant, since the cell is big).
 */
export function landmarksInRadius(seed: number, carX: number, carZ: number, radius: number): Landmark[] {
  const out: Landmark[] = [];
  const cs = ZEN_LANDMARK.cellSize;
  const r2 = radius * radius;
  const minCellX = Math.floor((carX - radius) / cs);
  const maxCellX = Math.floor((carX + radius) / cs);
  const minCellZ = Math.floor((carZ - radius) / cs);
  const maxCellZ = Math.floor((carZ + radius) / cs);
  for (let cz = minCellZ; cz <= maxCellZ; cz++) {
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      const lm = landmarkForCell(seed, cx, cz);
      if (!lm) continue;
      const dx = lm.x - carX;
      const dz = lm.z - carZ;
      if (dx * dx + dz * dz <= r2) out.push(lm);
    }
  }
  return out;
}

/**
 * Visit each SOLID circle (centre x/z, radius incl. the car radius) of a landmark — the parts
 * the car can't drive into. ARCH = two pillars with a clear gap between them; MONOLITH = one
 * solid trunk; RING = none (you glide straight through). No allocation (callback form).
 */
export function eachSolidCircle(lm: Landmark, cb: (cx: number, cz: number, r: number) => void): void {
  if (lm.type === LANDMARK_MONOLITH) {
    cb(lm.x, lm.z, ZEN_LANDMARK.monolithBase * 0.5 * lm.scale + ZEN.deflectCarRadius);
  } else if (lm.type === LANDMARK_ARCH) {
    const half = ZEN_LANDMARK.archHalfWidth * lm.scale;
    // Lateral axis = the mesh's local +X under a three.js Y-rotation (1,0,0)→(cosθ,0,−sinθ),
    // so the solid pillars sit exactly where the mesh draws them (clear opening between).
    const lx = Math.cos(lm.rotationY);
    const lz = -Math.sin(lm.rotationY);
    const pr = ZEN_LANDMARK.archPillarRadius * lm.scale + ZEN.deflectCarRadius;
    cb(lm.x + lx * half, lm.z + lz * half, pr);
    cb(lm.x - lx * half, lm.z - lz * half, pr);
  }
  // RING: pass-through — no solid parts.
}

/** The reach radius for a landmark (scaled with the structure). Within this horizontal distance
 *  the car has "reached" it → the gentle reach moment fires (once per visit; the renderer
 *  debounces). */
export function reachRadius(lm: Landmark): number {
  return ZEN_LANDMARK.reachRadius * lm.scale;
}

/** Whether the car (carX, carZ) is within reach of the landmark (horizontal distance). */
export function isReached(lm: Landmark, carX: number, carZ: number): boolean {
  const dx = lm.x - carX;
  const dz = lm.z - carZ;
  const r = reachRadius(lm);
  return dx * dx + dz * dz <= r * r;
}
