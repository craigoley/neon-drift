/**
 * ZEN TUNNEL BOTTOM-PAYOFF — the PURE trigger logic (no three, no DOM → Node-testable). Descending a
 * tunnel to its DEEP POINT fires a warp to a distinct tunnel-themed hidden space; a return portal there
 * brings you back near the entrance. The fade/teleport/palette ORCHESTRATION lives in ZenSession (it
 * owns the renderer + fader); this module owns the parts worth testing: "am I in a tunnel + where along
 * it am I" and "did I just cross the bottom".
 *
 * IMPORTANT: this does NOT touch the drivable surface (ZenLandmarkSurface is untouched). It reads the
 * same tunnel placement + bend model the surface uses, but only to detect the TRIGGER — the car's
 * actual road-follow (the #154 corridor / #149 unified floor / off-centre canary) is unaffected. The
 * membership maths below mirror surfaceUnder's tube test so "in the tunnel" agrees with what you drive.
 */

import { ZEN_LANDMARK, ZEN_TUNNEL_SECRET } from '../utils/constants';
import {
  landmarksInRadius,
  tunnelBendShape,
  LANDMARK_TUNNEL,
  type Landmark,
} from './ZenLandmarkModel';
import { findReturnPortal } from './ZenSecret';

/** The tunnel currently covering (x, z), plus the car's signed AXIAL position along it (0 at the deep
 *  centre, ±halfL at the mouths) and that half-length. Null if the car isn't inside a tunnel here. */
export interface TunnelCover {
  tunnel: Landmark;
  /** Signed distance along the through-axis from the tunnel centre (the deep point is along = 0). */
  along: number;
  /** Local half-length × scale — |along| ranges 0..halfL inside the tube. */
  halfL: number;
}

/**
 * The tunnel whose tube CONTAINS (x, z), or null. Mirrors surfaceUnder's path-relative (Frenet) tube
 * membership — true perpendicular distance to the curved centreline ≤ halfWidth, within the length —
 * so "inside" agrees with the road you actually drive (without touching the surface code). Tunnels are
 * rare, so at most one covers a point; the first match wins.
 */
export function coveringTunnel(seed: number, x: number, z: number): TunnelCover | null {
  const near = landmarksInRadius(seed, x, z, ZEN_LANDMARK.surfaceQueryRadius);
  for (const lm of near) {
    if (lm.type !== LANDMARK_TUNNEL) continue;
    const tx = Math.sin(lm.rotationY);
    const tz = Math.cos(lm.rotationY);
    const dx = x - lm.x;
    const dz = z - lm.z;
    const along = dx * tx + dz * tz;
    const perp = -dx * tz + dz * tx;
    const halfL = ZEN_LANDMARK.tunnelLength * lm.scale * 0.5;
    if (Math.abs(along) >= halfL) continue;
    const hw = ZEN_LANDMARK.tunnelHalfWidth * lm.scale;
    const amp = ZEN_LANDMARK.tunnelBendAmplitude * lm.scale;
    const bendOff = amp * tunnelBendShape(along / halfL);
    const eps = halfL * 1e-3;
    const bendSlope = (amp * tunnelBendShape((along + eps) / halfL) - amp * tunnelBendShape((along - eps) / halfL)) / (2 * eps);
    const d = Math.abs(perp - bendOff) / Math.sqrt(1 + bendSlope * bendSlope);
    if (d >= hw) continue;
    return { tunnel: lm, along, halfL };
  }
  return null;
}

/** Did the car just cross the DEEP POINT (along = 0) between the previous frame and now? The "bottomed
 *  out" edge: a sign flip of the axial position while inside the tube. (The caller debounces per run so
 *  wiggling around the bottom doesn't re-fire.) prevAlong = null (wasn't in a tunnel last frame) ⇒ no. */
export function passedDeepPoint(prevAlong: number | null, along: number): boolean {
  if (prevAlong === null) return false;
  // Crossed (or landed exactly on) along = 0 — the deepest centre of the descent.
  return (prevAlong > 0 && along <= 0) || (prevAlong < 0 && along >= 0);
}

/** The TUNNEL whose deep end the car is at/near (Stage C1 drive-down cavern placement). Unlike
 *  coveringTunnel (tube membership only — null once you leave the tube sideways onto the basin), this
 *  returns the nearest tunnel landmark by CENTRE distance within the surface query radius, so it still
 *  resolves while you're driving the deep basin/cavern floor outside the tube. Tunnels are rare → at
 *  most one is in range; null if none. Used to place the cavern decoration at this tunnel's deep floor. */
export function nearestTunnel(seed: number, x: number, z: number): Landmark | null {
  const near = landmarksInRadius(seed, x, z, ZEN_LANDMARK.surfaceQueryRadius);
  let best: Landmark | null = null;
  let bestD2 = Infinity;
  for (const lm of near) {
    if (lm.type !== LANDMARK_TUNNEL) continue;
    const d2 = (lm.x - x) * (lm.x - x) + (lm.z - z) * (lm.z - z);
    if (d2 < bestD2) { bestD2 = d2; best = lm; }
  }
  return best;
}

/** The tunnel-payoff region's arrival + RETURN portal — the GATEWAY nearest its far coordinate band.
 *  Deterministic (reuses the secret-area Chebyshev scan, pointed at the DISTINCT tunnel region). */
export function tunnelReturnPortal(seed: number): Landmark {
  return findReturnPortal(seed, ZEN_TUNNEL_SECRET.regionX, ZEN_TUNNEL_SECRET.regionZ);
}
