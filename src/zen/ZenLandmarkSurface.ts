/**
 * ZEN LANDMARK SURFACE — the PURE drivable-surface override for VISTA + TUNNEL (no three, no DOM
 * → Node-testable). The novel part: for the first time the car leaves the terrain surface — it
 * drives ONTO a raised mesa (vista) or DOWN INTO a tube below the ground (tunnel).
 *
 * Approach (recon decision): a CAR-ONLY surface override, NOT a change to heightAt. `heightAt` and
 * the terrain grid stay exactly as they are (the terrain is the tunnel's "roof"); the car simply
 * follows a DIFFERENT drivable surface inside a vista/tunnel footprint — raised for a vista, lowered
 * for a tunnel. The override BLENDS to heightAt at the footprint rim (continuous → the session's
 * eased follow has no snap at the mouth), and the session SUPPRESSES crest-detach while on it (you're
 * on a designed surface, not crest-jumping). This keeps the whole feature inside the landmark layer
 * (gate-safe, isolated, revertible) — terrain code is untouched.
 *
 * Only VISTA + TUNNEL landmarks reshape the surface; everywhere else this is just `heightAt`.
 */

import { ZEN, ZEN_LANDMARK } from '../utils/constants';
import { heightAt } from './ZenHeight';
import { smoothstep } from './ZenNoise';
import { landmarksInRadius, LANDMARK_VISTA, LANDMARK_TUNNEL, type Landmark } from './ZenLandmarkModel';

/** Reused scratch for surfaceUnder results (no per-frame allocation). */
const _su = { y: 0, enclosed: false };

/** The drivable surface at (x, z) under a single VISTA/TUNNEL landmark, or null if outside it. */
function surfaceUnder(seed: number, lm: Landmark, x: number, z: number): { y: number; enclosed: boolean } | null {
  if (lm.type === LANDMARK_VISTA) {
    const R = ZEN_LANDMARK.vistaRadius * lm.scale;
    const dx = x - lm.x;
    const dz = z - lm.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= R) return null;
    const topR = ZEN_LANDMARK.vistaTopRadius * lm.scale;
    // 1 on the flat top, easing to 0 at the rim (so the mesa blends into the terrain).
    const bump = d <= topR ? 1 : 1 - smoothstep(topR, R, d);
    const flatTopY = heightAt(seed, lm.x, lm.z) + ZEN_LANDMARK.vistaHeight * lm.scale;
    // Blend terrain → flat top by the bump: rim = terrain (continuous), centre = level overlook.
    _su.y = heightAt(seed, x, z) * (1 - bump) + flatTopY * bump;
    _su.enclosed = false;
    return _su;
  }
  // TUNNEL: descend below the terrain along the through-axis, blending to terrain at the mouths
  // (along) and the walls (lateral).
  const tx = Math.sin(lm.rotationY);
  const tz = Math.cos(lm.rotationY);
  const dx = x - lm.x;
  const dz = z - lm.z;
  const s = Math.abs(dx * tx + dz * tz); // distance along the tunnel axis from the centre
  const lat = Math.abs(-dx * tz + dz * tx); // perpendicular (lateral) distance from the centreline
  const halfL = (ZEN_LANDMARK.tunnelLength * lm.scale) * 0.5;
  const hw = ZEN_LANDMARK.tunnelHalfWidth * lm.scale;
  if (s >= halfL || lat >= hw) return null;
  // Descent profile: full depth through the inner half, easing to 0 at the mouths (entry ramps).
  const depthF = 1 - smoothstep(halfL * ZEN_LANDMARK.tunnelDepthEaseStart, halfL, s);
  // Lateral: flat across the channel, easing up to the terrain near the walls.
  const latF = 1 - smoothstep(hw * ZEN_LANDMARK.tunnelLateralEaseStart, hw, lat);
  const dip = ZEN_LANDMARK.tunnelDepth * lm.scale * depthF * latF;
  _su.y = heightAt(seed, x, z) - dip;
  _su.enclosed = dip >= ZEN_LANDMARK.tunnelEnclosedDepth;
  return _su;
}

/** The covering VISTA/TUNNEL surface at (x, z), or null if the car is on normal terrain here. */
function coveringSurface(seed: number, x: number, z: number): { y: number; enclosed: boolean } | null {
  const near = landmarksInRadius(seed, x, z, ZEN_LANDMARK.surfaceQueryRadius);
  for (const lm of near) {
    if (lm.type !== LANDMARK_VISTA && lm.type !== LANDMARK_TUNNEL) continue;
    const s = surfaceUnder(seed, lm, x, z);
    if (s) return s; // rare + large → at most one covers a point; first wins
  }
  return null;
}

/**
 * The car's DRIVABLE surface height at (x, z): the vista/tunnel override where one applies, else the
 * plain terrain `heightAt`. Continuous everywhere (overrides blend to heightAt at their rims).
 */
export function drivableSurfaceY(seed: number, x: number, z: number): number {
  const s = coveringSurface(seed, x, z);
  return s ? s.y : heightAt(seed, x, z);
}

/** Is the car on a VISTA/TUNNEL drivable surface here? (The session suppresses crest-detach on it.) */
export function onLandmarkSurface(seed: number, x: number, z: number): boolean {
  return coveringSurface(seed, x, z) !== null;
}

/** Is the car deep INSIDE a tunnel here (enclosed)? — for any in-tunnel-only handling. */
export function inEnclosedTunnel(seed: number, x: number, z: number): boolean {
  const s = coveringSurface(seed, x, z);
  return s !== null && s.enclosed;
}

/** Reused scratch for queryDrivableSurface (no per-frame allocation). */
const _query = { y: 0, onSurface: false };

/** Combined query: drivable Y + on-surface flag in ONE coveringSurface call (the session tick needs
 *  both at the same position — calling onLandmarkSurface + drivableSurfaceY separately would double
 *  the landmarksInRadius scan). */
export function queryDrivableSurface(seed: number, x: number, z: number): { y: number; onSurface: boolean } {
  const s = coveringSurface(seed, x, z);
  _query.y = s ? s.y : heightAt(seed, x, z);
  _query.onSurface = s !== null;
  return _query;
}

/** Slope (rise/run) of the DRIVABLE surface along a unit heading — the override-aware analogue of
 *  ZenHeight.slopeAlong (used for the gentle speed nudge + the visual pitch). */
export function surfaceSlopeAlong(seed: number, x: number, z: number, dirX: number, dirZ: number): number {
  const eps = ZEN.terrainSlopeEps;
  const ahead = drivableSurfaceY(seed, x + dirX * eps, z + dirZ * eps);
  const behind = drivableSurfaceY(seed, x - dirX * eps, z - dirZ * eps);
  return (ahead - behind) / (2 * eps);
}
