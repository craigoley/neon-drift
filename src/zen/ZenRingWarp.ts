/**
 * ZEN RING RANDOM-WARP — the PURE destination picker (no three, no DOM → Node-testable). Driving
 * through a ring blinks you to a RANDOM, unpredictable spot to explore: a random direction + a random
 * distance in a band. NOT returnable (no seed, no save) — that's the point, it's a shuffle. `rng` is
 * injectable (default Math.random) so tests are deterministic. The fade/teleport/camera-snap/guard
 * ORCHESTRATION lives in ZenSession (reusing the secret-area machinery); this owns the dest maths.
 *
 * The infinite world is position-deterministic, so ANY coordinate is valid terrain (heightAt is
 * defined everywhere) — the session lands the car on heightAt there, faces it along the travel
 * direction, and arms a bounce-guard so it can't instantly re-warp at the destination.
 */

import { ZEN_RING } from '../utils/constants';
import { lerp } from '../utils/math';

export interface WarpDest {
  x: number;
  z: number;
  heading: number;
}

/** A random warp destination from (fromX, fromZ): a random heading + a random distance in the band.
 *  The arrival heading faces the travel direction (forward = (sin h, −cos h)), so you land already
 *  pointed INTO the new area. */
export function randomWarpDestination(fromX: number, fromZ: number, rng: () => number = Math.random): WarpDest {
  const angle = rng() * Math.PI * 2;
  const dist = lerp(ZEN_RING.minDistance, ZEN_RING.maxDistance, rng());
  return {
    x: fromX + Math.sin(angle) * dist, // forward.x = sin(angle)
    z: fromZ - Math.cos(angle) * dist, // forward.z = −cos(angle)
    heading: angle,
  };
}
