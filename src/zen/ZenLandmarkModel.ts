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
import { smoothstep } from './ZenNoise';

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

/** DRIVE-THROUGH types (ring, arch) — you pass through an opening, so the reward must land while
 *  the structure is still AHEAD (a front-loaded flash) + as you cross the opening (a gate ripple).
 *  The MONOLITH is a SIGHT type — you stop in front of it, so its ramp-to-peak glow stays in view. */
export function isDriveThrough(type: LandmarkType): boolean {
  return type === LANDMARK_ARCH || type === LANDMARK_RING;
}

/** The reach radius for a landmark (scaled with the structure). Drive-through types use a LARGER
 *  radius so the flash fires while the structure is clearly ahead; sight types use the close reach.
 *  Within this horizontal distance the reach moment fires (once per visit; the renderer debounces). */
export function reachRadius(lm: Landmark): number {
  const base = isDriveThrough(lm.type) ? ZEN_LANDMARK.driveThroughReachRadius : ZEN_LANDMARK.reachRadius;
  return base * lm.scale;
}

/** Whether the car (carX, carZ) is within reach of the landmark (horizontal distance). */
export function isReached(lm: Landmark, carX: number, carZ: number): boolean {
  const dx = lm.x - carX;
  const dz = lm.z - carZ;
  const r = reachRadius(lm);
  return dx * dx + dz * dz <= r * r;
}

/** Total seconds the reach glow runs for a type (so the renderer knows when to end the pulse). */
export function reachDuration(type: LandmarkType): number {
  return isDriveThrough(type) ? ZEN_LANDMARK.flashSeconds : ZEN_LANDMARK.pulseSeconds;
}

/**
 * The reach-glow envelope (0..1) at elapsed time `t` for a type:
 *  - SIGHT (monolith): sin(π·t/pulseSeconds) — ramps to peak at the MIDDLE (0.8s). Works because
 *    you stop in front of the solid structure, so it's in view the whole pulse.
 *  - DRIVE-THROUGH (ring, arch): FRONT-LOADED — a quick rise to peak over `flashRiseSeconds`, then
 *    a smooth decay. Peaks early (~0.12s) while the structure is still ahead + in view, instead of
 *    ~0.8s later when it's behind you.
 */
export function reachEnvelope(type: LandmarkType, t: number): number {
  if (!isDriveThrough(type)) {
    return Math.sin(Math.PI * (t / ZEN_LANDMARK.pulseSeconds));
  }
  const rise = ZEN_LANDMARK.flashRiseSeconds;
  if (t < rise) return smoothstep(0, rise, t); // quick rise to the early peak
  const u = (t - rise) / (ZEN_LANDMARK.flashSeconds - rise);
  return 1 - smoothstep(0, 1, u); // smooth decay
}

// --- GATE pass-through (drive-through opening crossing) ---

/** Opening centre height (local, pre-scale) — where the gate ripple sits on the structure. */
export function openingHeight(type: LandmarkType): number {
  if (type === LANDMARK_RING) return ZEN_LANDMARK.ringRadius * ZEN_LANDMARK.ringCentreFactor;
  return ZEN_LANDMARK.archHeight * ZEN_LANDMARK.archOpeningHeightRatio; // arch
}

/** Opening radius (local, pre-scale) — the clear gap you drive through, and the ripple's size. */
export function openingRadius(type: LandmarkType): number {
  return type === LANDMARK_RING ? ZEN_LANDMARK.ringRadius : ZEN_LANDMARK.archHalfWidth;
}

/** Signed distance of (x, z) along the structure's THROUGH-AXIS (local +Z under the Y-rotation:
 *  (0,0,1) → (sinθ, cosθ) in world x/z). 0 == on the opening plane; the sign flips as you cross. */
export function signedThroughDistance(lm: Landmark, x: number, z: number): number {
  return (x - lm.x) * Math.sin(lm.rotationY) + (z - lm.z) * Math.cos(lm.rotationY);
}

/**
 * Did the car CROSS the opening plane (prev→curr) within the opening radius? Pure: a sign flip of
 * the through-axis distance AND the crossing point is laterally inside the opening (so brushing
 * past the side doesn't fire). Only meaningful for drive-through types. The renderer debounces by
 * the sign flip itself (a straight pass crosses once).
 */
export function crossedOpening(lm: Landmark, prevX: number, prevZ: number, x: number, z: number): boolean {
  if (!isDriveThrough(lm.type)) return false;
  const sPrev = signedThroughDistance(lm, prevX, prevZ);
  const sCurr = signedThroughDistance(lm, x, z);
  if ((sPrev < 0) === (sCurr < 0)) return false; // same side → no crossing
  // Lateral distance from the centre at the current point (perpendicular component).
  const dx = x - lm.x;
  const dz = z - lm.z;
  const lat2 = dx * dx + dz * dz - sCurr * sCurr; // total² − along² = perpendicular²
  const r = openingRadius(lm.type) * lm.scale;
  return lat2 <= r * r;
}
