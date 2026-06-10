/**
 * ZEN FREE-ROAM vehicle — heading-based 2D motion. PURE (no three, no DOM).
 *
 * This is a PARALLEL model to the forward-road `game/Vehicle.ts`, NOT a reuse: the
 * state is a 2D world position `(x, z)` + a facing `heading` + a scalar `speed`,
 * integrated ALONG the heading — versus the forward sim's "forward distance + lateral
 * offset". It lives in src/zen/ and imports nothing from src/game/, so it can never
 * touch the shared sim.
 *
 * DETERMINISM: Zen is single-player with no lockstep/replay, so it is EXEMPT from the
 * detmath constraint (which exists only for cross-engine MP) and uses Math.sin/cos
 * freely. Because this code is isolated in src/zen/, that non-deterministic math can
 * never perturb the MP-deterministic forward sim.
 *
 * FEEL is the point (PR1 is the playtest gate); all tuning lives in `ZEN` (constants).
 */

import { clamp, decay } from '../utils/math';
import { ZEN } from '../utils/constants';

export interface ZenVehicle {
  /** World position. Ahead = -z (matches the renderer + the forward world's mapping). */
  x: number;
  z: number;
  /** Facing angle (radians). 0 = facing -z (forward). Increasing = turning right. */
  heading: number;
  /** Forward speed along the heading (world units/s); >= 0 (no reverse in PR1). */
  speed: number;
}

export function createZenVehicle(): ZenVehicle {
  return { x: 0, z: 0, heading: 0, speed: 0 };
}

/**
 * Advance the Zen vehicle one frame. `steer` ∈ [-1, 1] turns (right = +); `throttle`
 * ∈ [-1, 1] drives (>= 0 accelerate, < 0 brake). Mutates and returns `v`.
 *
 * Calm by construction: turn authority eases IN with speed (no pivot-in-place at
 * rest), coasting glides to rest via friction, and speed is clamped to a modest cap.
 * Heading 0 + speed → moves -z (forward); turning right then driving curves toward +x.
 */
export function updateZen(v: ZenVehicle, steer: number, throttle: number, dt: number): ZenVehicle {
  // Turn authority ramps from 0 (stopped) to 1 (>= turnFullSpeed) so the car turns by
  // driving, not by spinning in place.
  const authority = clamp(v.speed / ZEN.turnFullSpeed, 0, 1);
  v.heading += clamp(steer, -1, 1) * ZEN.turnRate * authority * dt;

  // Throttle accelerates (or brakes); then coast-friction bleeds speed toward rest.
  const t = clamp(throttle, -1, 1);
  v.speed += (t >= 0 ? t * ZEN.accel : t * ZEN.brakeAccel) * dt;
  v.speed *= decay(ZEN.friction, dt);
  v.speed = clamp(v.speed, 0, ZEN.maxSpeed);

  // Integrate along the heading (-z = forward; right turn curves toward +x).
  v.x += Math.sin(v.heading) * v.speed * dt;
  v.z += -Math.cos(v.heading) * v.speed * dt;
  return v;
}
