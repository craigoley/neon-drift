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

import { clamp, decay, smoothFollow } from '../utils/math';
import { ZEN } from '../utils/constants';

export interface ZenVehicle {
  /** World position. Ahead = -z (matches the renderer + the forward world's mapping). */
  x: number;
  z: number;
  /** Surface height the car rides at (PR3a) — eased toward the terrain each frame. */
  y: number;
  /** Facing angle (radians). 0 = facing -z (forward). Increasing = turning right. */
  heading: number;
  /** Forward speed along the heading (world units/s); >= 0 (no reverse in PR1). */
  speed: number;
  /** Post-bump recovery HOLD remaining (seconds, PR3b tune). While > 0 the throttle's
   *  recovery is dampened so a prop bump reads as a distinct dip + ease-back, not a blip. */
  bumpHold: number;
}

export function createZenVehicle(): ZenVehicle {
  return { x: 0, z: 0, y: 0, heading: 0, speed: 0, bumpHold: 0 };
}

/**
 * Advance the Zen vehicle one frame. `steer` ∈ [-1, 1] turns (right = +); `throttle`
 * ∈ [-1, 1] drives (>= 0 accelerate, < 0 brake). `slope` (PR3a) is the rise/run of the
 * terrain along the heading (uphill > 0) — a GENTLE, bounded speed nudge. `contact`
 * (PR3b, 0..1) is how firmly the car is touching a prop — a GENTLE, bounded slowdown
 * (mirrors the MP crash=slowdown concept: slow, never stop, never end). Mutates `v`.
 *
 * Calm by construction: turn authority eases IN with speed (no pivot-in-place at
 * rest), coasting glides to rest via friction, and speed is clamped to a modest cap.
 * Heading 0 + speed → moves -z (forward); turning right then driving curves toward +x.
 */
export function updateZen(
  v: ZenVehicle,
  steer: number,
  throttle: number,
  dt: number,
  slope = 0,
  contact = 0,
): ZenVehicle {
  // Turn authority ramps from 0 (stopped) to 1 (>= turnFullSpeed) so the car turns by
  // driving, not by spinning in place.
  const authority = clamp(v.speed / ZEN.turnFullSpeed, 0, 1);
  v.heading += clamp(steer, -1, 1) * ZEN.turnRate * authority * dt;

  // Bump-hold timer ticks down. While it's active, the THROTTLE's forward push is
  // dampened so a recent contact stays felt for a beat before easing back (set below).
  if (v.bumpHold > 0) v.bumpHold = Math.max(0, v.bumpHold - dt);

  // Throttle accelerates (forward push dampened during a bump-hold) or brakes.
  const t = clamp(throttle, -1, 1);
  const accelScale = v.bumpHold > 0 ? ZEN.contactHoldThrottleScale : 1;
  v.speed += (t >= 0 ? t * ZEN.accel * accelScale : t * ZEN.brakeAccel) * dt;

  // GENTLE slope nudge: uphill (slope > 0) bleeds a little speed, downhill adds a little —
  // a calm "I'm on a hill" cue. BOUNDED: the slope ALONE can never drag you below the
  // uphill floor, so climbing is a nudge, never a grind/stall (the throttle still rules).
  const slopeAccel = -ZEN.slopeStrength * slope;
  const preSlope = v.speed;
  v.speed += slopeAccel * dt;
  if (slopeAccel < 0 && preSlope > ZEN.slopeUphillFloor) {
    v.speed = Math.max(v.speed, ZEN.slopeUphillFloor);
  }

  // Contact slowdown: touching a prop bleeds speed (more the more central the hit) for a
  // clearly-FELT bite, and a real overlap ARMS the brief hold so the dip lingers + eases
  // back (not a blip). BOUNDED by the contact floor — it never stops the car dead or ends
  // the run; you keep crawling and the throttle recovers you (zen = no failure). The floor
  // also keeps a bump-while-climbing from STACKING with the slope into a dead stop.
  if (contact > 0) {
    const preContact = v.speed;
    v.speed -= ZEN.contactDecel * contact * dt;
    v.speed = Math.max(v.speed, Math.min(preContact, ZEN.contactFloor));
    if (contact >= ZEN.contactHoldThreshold) v.bumpHold = ZEN.contactHoldTime;
  }

  // Coast-friction bleeds speed toward rest, then clamp to the calm cap.
  v.speed *= decay(ZEN.friction, dt);
  v.speed = clamp(v.speed, 0, ZEN.maxSpeed);

  // Integrate along the heading (-z = forward; right turn curves toward +x).
  v.x += Math.sin(v.heading) * v.speed * dt;
  v.z += -Math.cos(v.heading) * v.speed * dt;
  return v;
}

/**
 * Ease the car's Y toward the terrain surface (PR3a) so it FLOWS over hills rather than
 * snapping. `targetY` = heightAt(x, z) + ride height. Tight enough to hug the ground,
 * smoothed so tiny gradient changes don't jitter. Mutates and returns `v`.
 */
export function followSurface(v: ZenVehicle, targetY: number, dt: number): ZenVehicle {
  v.y += (targetY - v.y) * smoothFollow(ZEN.terrainFollowLerp, dt);
  return v;
}
