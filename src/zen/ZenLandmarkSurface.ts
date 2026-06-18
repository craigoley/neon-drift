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

import { ZEN, ZEN_LANDMARK, ZEN_SLIDE, ZEN_DRIVEDOWN } from '../utils/constants';
import { heightAt } from './ZenHeight';
import { smoothstep } from './ZenNoise';
import { landmarksInRadius, tunnelBendShape, tunnelDepthFactor, tunnelBasinCoverageFactor, LANDMARK_VISTA, LANDMARK_TUNNEL, type Landmark } from './ZenLandmarkModel';

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
  // TUNNEL: the car rides the SAME floor it sees — ONE definition shared with the rendered floor
  // mesh (ZenLandmarks): a CENTRE-anchored depth profile along the through-axis (tunnelDepthFactor),
  // FLAT across the channel. The centreline CURVES sideways by bendOff (same tunnelBendShape as the
  // mesh) — used ONLY to test whether the car is within the curved tube (lat < hw), NOT to reshape
  // the floor Y. (Diagnosis #148: the old per-car heightAt(CAR) anchor + a lateral taper the mesh
  // lacked disagreed with the visible road → the car bobbed/popped THROUGHOUT. Now they're identical.)
  const tx = Math.sin(lm.rotationY);
  const tz = Math.cos(lm.rotationY);
  const dx = x - lm.x;
  const dz = z - lm.z;
  const along = dx * tx + dz * tz; // signed distance along the tunnel axis from the centre
  const perp = -dx * tz + dz * tx; // signed perpendicular distance from the straight axis
  const s = Math.abs(along);
  const halfL = (ZEN_LANDMARK.tunnelLength * lm.scale) * 0.5;
  const hw = ZEN_LANDMARK.tunnelHalfWidth * lm.scale;
  const amp = ZEN_LANDMARK.tunnelBendAmplitude * lm.scale;
  const bendOff = amp * tunnelBendShape(along / halfL);
  // PATH-RELATIVE (Frenet) membership: the TRUE perpendicular distance from the car to the CURVED
  // centreline, not the axis-relative gap. The centreline's local slope (lateral per along) is
  // d(bendOff)/d(along); the perpendicular distance to its tangent line = |perp − bendOff| /
  // √(1 + slope²) (exact to first order — curvature-invariant). So "in the tube" is exactly
  // |d| ≤ halfWidth, no thin corridor artifact from the axis frame (diagnosis #153). The depth-Y
  // below still keys off `along` (NOT a nearest-point arc-length), so it stays byte-identical to the
  // rendered floor mesh (the #149 unified-floor invariant).
  const eps = halfL * 1e-3;
  const bendSlope = (amp * tunnelBendShape((along + eps) / halfL) - amp * tunnelBendShape((along - eps) / halfL)) / (2 * eps);
  const d = Math.abs(perp - bendOff) / Math.sqrt(1 + bendSlope * bendSlope);
  if (s >= halfL || d >= hw) {
    // OUTSIDE the tube. Normally → null (terrain). STAGE A DRIVE-DOWN (flag-gated, OFF in production):
    // a DEEP DRIVABLE BASIN — a sunken drive-around room at the tunnel's deep centre that the tube
    // floor hands off to with NO pop (the SEAM RULE). When the flag is OFF this block is skipped and
    // the tunnel branch is byte-identical to before (the normal tunnel + the #154 canary unchanged).
    if (ZEN_DRIVEDOWN.enabled) {
      // CROSS-ANCHOR (the critical line): the basin drops below the SAME heightAt(tunnel CENTRE) the
      // tube's deepest floor uses — NOT heightAt(this point). The combined coverage (Stage A centre disc
      // ∪ Stage C1 far corridor, tunnelBasinCoverageFactor) is flat-deep wherever it abuts the tube wall
      // (the tube is at FULL depth there) → basin Y EQUALS tube floor Y → pop-free; and it now COVERS
      // the held-deep far mouth (B's latent terminus) so leaving the far end lands on the deep room.
      const depthFactor = tunnelBasinCoverageFactor(along, perp, halfL, lm.scale);
      if (depthFactor > 0) {
        const basinDepth = ZEN_LANDMARK.tunnelDepth * lm.scale * depthFactor;
        _su.y = heightAt(seed, lm.x, lm.z) - basinDepth;
        _su.enclosed = basinDepth >= ZEN_LANDMARK.tunnelEnclosedDepth;
        return _su;
      }
    }
    return null;
  }
  // The floor: terrain at the tunnel CENTRE minus the shared depth profile — EXACTLY the rendered
  // mesh's world Y (heightAt(centre) + scale·localFloorY), at any lateral offset within the tube.
  const depth = ZEN_LANDMARK.tunnelDepth * lm.scale * tunnelDepthFactor(along / halfL);
  _su.y = heightAt(seed, lm.x, lm.z) - depth;
  _su.enclosed = depth >= ZEN_LANDMARK.tunnelEnclosedDepth;
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

/** The VISTA whose FLAT TOP (the deck) the car is standing on at (x, z), or null. This is the
 *  Sky-Slide trigger: driving onto a vista deck auto-launches the slide. The deck is the flat-top
 *  radius (where the surface override is fully raised), tightened by deckTriggerRadiusFrac so the
 *  launch fires when you're solidly ON the overlook, not skimming its sloped rim. Pure → testable. */
export function vistaDeckUnder(seed: number, x: number, z: number): Landmark | null {
  const near = landmarksInRadius(seed, x, z, ZEN_LANDMARK.surfaceQueryRadius);
  for (const lm of near) {
    if (lm.type !== LANDMARK_VISTA) continue;
    const r = ZEN_LANDMARK.vistaTopRadius * lm.scale * ZEN_SLIDE.deckTriggerRadiusFrac;
    const dx = x - lm.x;
    const dz = z - lm.z;
    if (dx * dx + dz * dz <= r * r) return lm;
  }
  return null;
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

/** How far the drivable surface sits BELOW the local terrain roof at (x, z) — the positional DEPTH
 *  signal (Stage C1). 0 on plain terrain; ≈ tunnelDepth·scale when deep in a tunnel/basin; negative on
 *  a raised vista. The session drives the amber palette + cavern visibility off this (with hysteresis),
 *  replacing the warp-event trigger — you are "in the cavern" because you DROVE down into it, by
 *  position, not by a teleport. Pure (heightAt − drivableSurfaceY) → Node-testable. */
export function driveDownDepth(seed: number, x: number, z: number): number {
  return heightAt(seed, x, z) - drivableSurfaceY(seed, x, z);
}

/** Slope (rise/run) of the DRIVABLE surface along a unit heading — the override-aware analogue of
 *  ZenHeight.slopeAlong (used for the gentle speed nudge + the visual pitch). */
export function surfaceSlopeAlong(seed: number, x: number, z: number, dirX: number, dirZ: number): number {
  const eps = ZEN.terrainSlopeEps;
  const ahead = drivableSurfaceY(seed, x + dirX * eps, z + dirZ * eps);
  const behind = drivableSurfaceY(seed, x - dirX * eps, z - dirZ * eps);
  return (ahead - behind) / (2 * eps);
}
