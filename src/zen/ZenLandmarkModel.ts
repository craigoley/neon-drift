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
import { ZEN, ZEN_LANDMARK, ZEN_DRIVEDOWN } from '../utils/constants';
import { chunkKey } from './ZenWorld';
import { maskAt } from './ZenHeight';
import { smoothstep } from './ZenNoise';

/** The landmark TYPES. Structural ids, not tuning — extend with more kinds as easy follow-ups.
 *  RING/ARCH/GATEWAY are DRIVE-THROUGH (pass-through reward); VISTA/TUNNEL are SURFACE types that
 *  reshape the car's drivable surface (drive ONTO / INTO) with an arrival glow. (The MONOLITH was
 *  removed — no interaction.) */
export const LANDMARK_RING = 0;
export const LANDMARK_ARCH = 1;
export const LANDMARK_GATEWAY = 2;
export const LANDMARK_VISTA = 3;
export const LANDMARK_TUNNEL = 4;
export const LANDMARK_TYPE_COUNT = 5;
export type LandmarkType = 0 | 1 | 2 | 3 | 4;

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

/** Pick a landmark type by the placement WEIGHTS (tunnel/vista rarer than the drive-throughs). */
function pickType(lseed: number, key: number): LandmarkType {
  const w = ZEN_LANDMARK.typeWeights;
  let total = 0;
  for (let i = 0; i < w.length; i++) total += w[i];
  let r = unit(lseed, key, 3) * total;
  for (let i = 0; i < w.length; i++) {
    if (r < w[i]) return i as LandmarkType;
    r -= w[i];
  }
  return (w.length - 1) as LandmarkType;
}

/** VISTA + TUNNEL reshape the car's DRIVABLE SURFACE (drive ONTO / INTO) — see ZenLandmarkSurface.
 *  The other types sit on the terrain. */
export function isSurfaceType(type: LandmarkType): boolean {
  return type === LANDMARK_VISTA || type === LANDMARK_TUNNEL;
}

/**
 * The tunnel's LATERAL CURVE, as a unit shape over the axial fraction `t` (= localZ / halfLength,
 * −1..1). Returns the centreline's sideways offset in units of `tunnelBendAmplitude` — multiply by
 * the amplitude (and the landmark scale, in world space) to get the actual offset. Expressing the
 * curve as a lateral offset in the STRAIGHT-axis frame (not an arc-length reparameterisation) lets
 * the rendered tube/floor (ZenLandmarks) and the pure drivable surface (ZenLandmarkSurface) share
 * ONE definition — so the car always sits on the floor it sees, through every bend.
 *
 * A gentle sweeping sine, WINDOWED by the same ease as the descent (the `tunnelDepthEaseStart`
 * smoothstep) so the bend is zero AND tangent at the mouths — the tunnel runs straight into the
 * surface, then curves as it deepens (no kink at the entrance). Calm by design, not technical.
 */
export function bendShape(t: number, waves: number, easeStart: number): number {
  const window = 1 - smoothstep(easeStart, 1, Math.abs(t));
  return window * Math.sin(Math.PI * waves * t);
}

export function tunnelBendShape(t: number): number {
  return bendShape(t, ZEN_LANDMARK.tunnelBendWaves, ZEN_LANDMARK.tunnelDepthEaseStart);
}

/**
 * The tunnel floor's DEPTH FACTOR at a normalized axial position `tNorm = along / halfLength` ∈
 * [−1, 1]: 1 deep in the inner half, easing to 0 at the mouths (the descent/ascent ramps). The ONE
 * source of truth for the floor's along-axis shape — BOTH the rendered floor mesh (ZenLandmarks) and
 * the followed drivable surface (ZenLandmarkSurface) call this, so the car sits exactly on the road
 * it sees (diagnosis #148: they used to be two separate definitions → the "bump"). Multiply by
 * `tunnelDepth` (× the landmark scale, in world space) for the actual drop below the floor anchor.
 *
 * TWO profiles, selected by the DRIVE-DOWN flag (OFF in production):
 *  • SYMMETRIC (flag OFF — the #158 warp ships, byte-identical to before): eases to 0 at BOTH mouths
 *    — you drive in one mouth, down, and the far mouth windows back UP to the surface. (Stage A kept
 *    this and proved the centre basin seam pop-free behind the flag.)
 *  • ASYMMETRIC DRIVE-DOWN (flag ON — Stage B): the ENTRY mouth (tNorm < 0) still eases up to the
 *    surface exactly as the symmetric profile (drive in normally, no snap at the mouth), but the FAR
 *    half (tNorm ≥ 0) HOLDS FULL DEPTH (factor = 1) instead of windowing back up — so the tunnel
 *    descends and STAYS deep into the basin seam (the Stage A cross-anchored deep Y). The transition
 *    is dead-FLAT across the deep core: the symmetric entry profile is already 1 for |tNorm| ≤
 *    easeStart, so both sides meet at factor = 1 around tNorm = 0 → no kink, the only grade is the
 *    (unchanged) entry ramp, and the far half is flat-deep → maxStep is trivially bounded. BOTH the
 *    mesh + the surface read THIS function, so they stay unified (the #149 rule) on the asymmetric
 *    profile too. The corridor (#154, lateral) is untouched by this along-axis depth change.
 */
export function tunnelDepthFactor(tNorm: number): number {
  // FAR half holds full depth ONLY when the drive-down flag is on; otherwise the symmetric ascent ramp.
  if (ZEN_DRIVEDOWN.enabled && tNorm >= 0) return 1;
  return 1 - smoothstep(ZEN_LANDMARK.tunnelDepthEaseStart, 1, Math.abs(tNorm));
}

/**
 * The DRIVE-DOWN BASIN's depth factor at radial distance `r` (world units) from the tunnel centre, for
 * a landmark of `scale` — 1 on the flat-deep room floor (r ≤ basinFlatRadius·scale), easing to 0 at the
 * room rim (basinRimRadius·scale). The ONE source of truth for the basin floor — BOTH the followed
 * surface (ZenLandmarkSurface) AND the rendered basin mesh (ZenLandmarks) call this, the #149
 * unified-floor rule extended to the new floor. Multiply by `tunnelDepth·scale` for the drop below the
 * SAME centre anchor the tube uses (heightAt(centre)) → the wall seam is Y-equal (the SEAM RULE). */
export function tunnelBasinDepthFactor(r: number, scale: number): number {
  return 1 - smoothstep(ZEN_DRIVEDOWN.basinFlatRadius * scale, ZEN_DRIVEDOWN.basinRimRadius * scale, r);
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
  const type = pickType(lseed, key);
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
 * the car can't drive into. ARCH/GATEWAY = two pillars with a clear gap between them; RING +
 * VISTA + TUNNEL = none (you glide / drive on their surface). No allocation (callback form).
 */
export function eachSolidCircle(lm: Landmark, cb: (cx: number, cz: number, r: number) => void): void {
  // ARCH + GATEWAY: two pillars to either side of a clear opening. The lateral axis is the mesh's
  // local +X under a three.js Y-rotation (1,0,0)→(cosθ,0,−sinθ), so the solid pillars sit exactly
  // where the mesh draws them.
  let halfWidth: number;
  let pillarRadius: number;
  if (lm.type === LANDMARK_ARCH) {
    halfWidth = ZEN_LANDMARK.archHalfWidth;
    pillarRadius = ZEN_LANDMARK.archPillarRadius;
  } else if (lm.type === LANDMARK_GATEWAY) {
    halfWidth = ZEN_LANDMARK.gatewayHalfWidth;
    pillarRadius = ZEN_LANDMARK.gatewayPillarRadius;
  } else {
    return; // RING (free), VISTA + TUNNEL (drive on/through their surface) — no solid parts.
  }
  const half = halfWidth * lm.scale;
  const lx = Math.cos(lm.rotationY);
  const lz = -Math.sin(lm.rotationY);
  const pr = pillarRadius * lm.scale + ZEN.deflectCarRadius;
  cb(lm.x + lx * half, lm.z + lz * half, pr);
  cb(lm.x - lx * half, lm.z - lz * half, pr);
}

/** DRIVE-THROUGH types (ring, arch) — you pass through an opening, so the reward must land while
 *  the structure is still AHEAD (a front-loaded flash) + as you cross the opening (a gate ripple).
 *  The ARRIVAL types (vista, tunnel) keep a ramp-to-peak glow — you are ON/IN them, so it stays in view. */
export function isDriveThrough(type: LandmarkType): boolean {
  return type === LANDMARK_ARCH || type === LANDMARK_RING || type === LANDMARK_GATEWAY;
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
 *  - ARRIVAL (vista, tunnel): sin(π·t/pulseSeconds) — ramps to peak at the MIDDLE (0.8s). Works because
 *    you are ON the vista / IN the tunnel, so it's in view the whole pulse.
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
  if (type === LANDMARK_GATEWAY) return ZEN_LANDMARK.gatewayHeight * ZEN_LANDMARK.gatewayOpeningHeightRatio;
  return ZEN_LANDMARK.archHeight * ZEN_LANDMARK.archOpeningHeightRatio; // arch
}

/** Opening radius (local, pre-scale) — the clear gap you drive through, and the ripple's size. */
export function openingRadius(type: LandmarkType): number {
  if (type === LANDMARK_RING) return ZEN_LANDMARK.ringRadius;
  if (type === LANDMARK_GATEWAY) return ZEN_LANDMARK.gatewayHalfWidth;
  return ZEN_LANDMARK.archHalfWidth; // arch
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

/** Did the car cross the opening (prev→curr) of any nearby landmark OF A GIVEN TYPE? The generic
 *  drive-through trigger — ARCH (speed boost) + RING (random warp) reuse it, the same way
 *  ZenSecret.crossedAnyGateway uses crossedOpening for the secret-area portal. Bounded scan. */
export function crossedAnyOfType(seed: number, type: LandmarkType, prevX: number, prevZ: number, x: number, z: number): boolean {
  const near = landmarksInRadius(seed, x, z, ZEN_LANDMARK.solidQueryRadius);
  for (const lm of near) {
    if (lm.type === type && crossedOpening(lm, prevX, prevZ, x, z)) return true;
  }
  return false;
}
