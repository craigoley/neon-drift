/**
 * ZEN SECRET AREAS (PR1 slice) — the PURE logic for the portal warp (no three, no DOM →
 * Node-testable). A "secret area" is NOT a world swap: it's a TELEPORT to a far, deterministic
 * coordinate band, and the infinite position-deterministic world regenerates around you via the
 * existing streaming (ZenChunkField). The only world state is the ZenVehicle, so save/restore is a
 * handful of numbers. The fade/teleport/camera-snap ORCHESTRATION lives in ZenSession (it owns the
 * DOM fader + the renderer); this module owns the parts worth testing.
 */

import { ZEN_SECRET, ZEN_LANDMARK } from '../utils/constants';
import {
  landmarkForCell,
  landmarksInRadius,
  crossedOpening,
  LANDMARK_GATEWAY,
  type Landmark,
} from './ZenLandmarkModel';
import type { ZenVehicle } from './ZenVehicle';

/** The savable world-position state of the car (everything that defines "where I am"). */
export interface VehicleSnapshot {
  x: number;
  z: number;
  y: number;
  vy: number;
  airborne: boolean;
  heading: number;
  speed: number;
}

/** Copy the car's world state out (before warping into a secret area). */
export function snapshot(v: ZenVehicle): VehicleSnapshot {
  return { x: v.x, z: v.z, y: v.y, vy: v.vy, airborne: v.airborne, heading: v.heading, speed: v.speed };
}

/** Copy a saved world state back into the car (on returning to the main world). */
export function restore(v: ZenVehicle, s: VehicleSnapshot): void {
  v.x = s.x;
  v.z = s.z;
  v.y = s.y;
  v.vy = s.vy;
  v.airborne = s.airborne;
  v.heading = s.heading;
  v.speed = s.speed;
}

/**
 * The GATEWAY nearest the fixed far secret coordinate — the secret region's arrival + RETURN portal.
 * Deterministic (a Chebyshev-ring scan outward from the base cell, first GATEWAY wins), so a secret
 * area is a real PLACE you return to. (PR1: one fixed region; PR3 derives per-portal regions.)
 */
export function findReturnPortal(seed: number): Landmark {
  const cs = ZEN_LANDMARK.cellSize;
  const bcx = Math.floor(ZEN_SECRET.regionX / cs);
  const bcz = Math.floor(ZEN_SECRET.regionZ / cs);
  for (let r = 0; r < 48; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // only the ring at radius r
        const lm = landmarkForCell(seed, bcx + dx, bcz + dz);
        if (lm && lm.type === LANDMARK_GATEWAY) return lm;
      }
    }
  }
  throw new Error('no gateway found near the secret region');
}

/** Where the car arrives in the secret area: `arrivalApproach` units off the portal along its
 *  through-axis, FACING AWAY from it (forward points INTO the region) — so driving forward takes
 *  you DEEPER to explore; the portal sits BEHIND you, and you return by turning around + going back
 *  through it. (The old version faced the portal → driving forward instantly bounced you home.) */
export function arrivalPose(portal: Landmark): { x: number; z: number; heading: number } {
  const tax = Math.sin(portal.rotationY); // through-axis (local +Z under the Y-rotation)
  const taz = Math.cos(portal.rotationY);
  return {
    x: portal.x + tax * ZEN_SECRET.arrivalApproach,
    z: portal.z + taz * ZEN_SECRET.arrivalApproach,
    // forward (sin h, −cos h) = +through-axis (h = π − rot) → AWAY from the portal, into the region.
    heading: Math.PI - portal.rotationY,
  };
}

/** Did the car cross ANY gateway's opening (prev → curr)? The portal trigger — entering a secret
 *  area (main world) or leaving it (secret region). Bounded scan of nearby gateways. */
export function crossedAnyGateway(seed: number, prevX: number, prevZ: number, x: number, z: number): boolean {
  const near = landmarksInRadius(seed, x, z, ZEN_LANDMARK.solidQueryRadius);
  for (const lm of near) {
    if (lm.type === LANDMARK_GATEWAY && crossedOpening(lm, prevX, prevZ, x, z)) return true;
  }
  return false;
}
