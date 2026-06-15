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
  /** Surface height the car rides at (PR3a) — eased toward the terrain when GROUNDED, or
   *  integrated ballistically while AIRBORNE (air-time). */
  y: number;
  /** Vertical velocity (units/s) — 0 while grounded; set on launch + integrated in flight. */
  vy: number;
  /** True while the car is in the AIR (off the surface) — see updateVertical. */
  airborne: boolean;
  /** Facing angle (radians). 0 = facing -z (forward). Increasing = turning right. */
  heading: number;
  /** Forward speed along the heading (world units/s); >= 0 (no reverse in PR1). */
  speed: number;
}

export function createZenVehicle(): ZenVehicle {
  return { x: 0, z: 0, y: 0, vy: 0, airborne: false, heading: 0, speed: 0 };
}

/**
 * Advance the Zen vehicle one frame. `steer` ∈ [-1, 1] turns (right = +); `throttle`
 * ∈ [-1, 1] drives (>= 0 accelerate, < 0 brake). `slope` (PR3a) is the rise/run of the
 * terrain along the heading (uphill > 0) — a GENTLE, bounded speed nudge. Mutates `v`.
 *
 * Props are SOLID (a separate DEFLECT/SLIDE step resolves the car's position out of prop
 * circles — see ZenWorld.resolve, applied by the session); movement here is unaware of
 * them. Calm by construction: turn authority eases IN with speed (no pivot-in-place at
 * rest), coasting glides to rest via friction, and speed is clamped to a modest cap.
 * Heading 0 + speed → moves -z (forward); turning right then driving curves toward +x.
 */
export function updateZen(v: ZenVehicle, steer: number, throttle: number, dt: number, slope = 0): ZenVehicle {
  // Turn authority ramps from 0 (stopped) to 1 (>= turnFullSpeed) so the car turns by
  // driving, not by spinning in place.
  const authority = clamp(v.speed / ZEN.turnFullSpeed, 0, 1);
  v.heading += clamp(steer, -1, 1) * ZEN.turnRate * authority * dt;

  // Throttle accelerates (or brakes).
  const t = clamp(throttle, -1, 1);
  v.speed += (t >= 0 ? t * ZEN.accel : t * ZEN.brakeAccel) * dt;

  // GENTLE slope nudge: uphill (slope > 0) bleeds a little speed, downhill adds a little —
  // a calm "I'm on a hill" cue. BOUNDED: uphill, the slope can never drag you below the
  // floor (or below your current speed if already under it). So even a STEEP MOUNTAIN climb
  // (PR4) never stalls — at extreme slopes the throttle alone can't overcome the bleed, so
  // this clamp is what keeps a peak a calm drive-up rather than an impassable wall.
  const slopeAccel = -ZEN.slopeStrength * slope;
  const preSlope = v.speed;
  v.speed += slopeAccel * dt;
  if (slopeAccel < 0) {
    v.speed = Math.max(v.speed, Math.min(preSlope, ZEN.slopeUphillFloor));
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
  // Cap the per-frame step so a big residual gap (e.g. settling after a flew-into-a-wall
  // landing) is spread over frames, never a teleport. Real hill/descent tracking moves far
  // less than maxLandStep per frame, so this is a no-op for normal grounded driving.
  const step = (targetY - v.y) * smoothFollow(ZEN.terrainFollowLerp, dt);
  v.y += clamp(step, -ZEN.maxLandStep, ZEN.maxLandStep);
  return v;
}

/** The firm, SLOPE-AWARE landing catch-up rate (world units/frame): ride up a rising far-side at
 *  ~its own climb rate (|slope|·speed), floored at maxLandStep (so gentle landings are unchanged)
 *  and ceilinged at landSettleCeil (so even a near-vertical wall never teleports). */
function landCatchupRate(v: ZenVehicle, slope: number, dt: number): number {
  return Math.min(
    ZEN.landSettleCeil,
    Math.max(ZEN.maxLandStep, Math.abs(slope) * v.speed * dt * ZEN.landRideFactor),
  );
}

/**
 * Vertical update with AIR-TIME. `groundY` = heightAt(x, z) + ride height (the surface the
 * car is over now); `slope` = rise/run along the heading (0 while airborne).
 *
 * GROUNDED: ease onto the surface (followSurface) and carry the surface vertical velocity
 *   `vy = slope × speed`. DETACH when the surface falls away FASTER than gravity could pull
 *   the car down (`surfaceAccel < -airGravity`): to stay glued there the car would have to
 *   plunge faster than free-fall (the downward SNAP), so instead it leaves the ground and
 *   ARCS off the crest under gravity. Cresting ANY rise that drops away fast gives air —
 *   small crests small arcs, sharp peaks / ramps bigger (capped). Gentle hills + mild
 *   downslopes drop slower than gravity → stay grounded, smooth (no accidental air).
 * AIRBORNE: a calm parabola — `vy -= airGravity·dt; y += vy·dt` — until `y` meets the
 *   terrain again, then LAND smoothly (grounded, vy 0; no crash, no speed penalty).
 *
 * `allowAir` (default true) gates the crest-detach: on a DESIGNED drivable surface (a vista mesa /
 * tunnel floor — see ZenLandmarkSurface) the session passes false, so the car stays glued to the
 * surface (no crest-jumps on a platform or down a tunnel ramp) and just eases along it.
 *
 * Pure; mutates and returns `v`. (Forward x,z motion is handled by updateZen; props are
 * not collided while airborne — the car flies over them.)
 */
export function updateVertical(v: ZenVehicle, groundY: number, slope: number, dt: number, allowAir = true): ZenVehicle {
  if (v.airborne) {
    v.vy -= ZEN.airGravity * dt;
    v.y += v.vy * dt;
    if (v.y <= groundY) {
      // Land — clear the gap at the SLOPE-AWARE firm rate (ride up a rising far-side at ~its own
      // climb rate) so a steep-crest landing settles firmly, not a slow float-up. A clean touch-down
      // (gap < maxLandStep) still snaps up instantly; a big gap settles over a couple of bounded
      // frames (landSettleCeil → no teleport). Grounded tracking (followSurface) is untouched.
      v.y += Math.min(groundY - v.y, landCatchupRate(v, slope, dt));
      v.vy = 0;
      v.airborne = false;
    }
    return v;
  }

  // Grounded: how fast the surface is moving up/down under us, and how fast THAT is
  // changing. vy holds last frame's surface velocity.
  const surfaceVy = slope * v.speed;
  const surfaceAccel = (surfaceVy - v.vy) / dt;
  // DETACH when the surface drops away FASTER than gravity could pull us down — i.e. the
  // surface is accelerating downward harder than free-fall (`surfaceAccel < -airGravity`).
  // To "stay glued" there the car would have to plunge faster than gravity = the downward
  // SNAP. Instead we leave the ground and fall under gravity: a gentle ARC off the crest.
  // Small crests → small arcs, sharp peaks / ramps → bigger arcs (capped); flat, uphill and
  // mild downslopes drop slower than gravity → stay grounded + smooth. No upward-momentum
  // gate: cresting a rise should always arc, not just when you're already climbing fast.
  if (allowAir && surfaceAccel < -ZEN.airGravity) {
    v.airborne = true;
    v.vy = Math.min(v.vy, ZEN.maxLaunchVel); // detach with our current vertical velocity (capped)
    v.y += v.vy * dt;
    return v;
  }

  // Stay glued: ease onto the surface (PR3a feel), carry the surface velocity for the
  // next frame's detach test.
  followSurface(v, groundY, dt);
  v.vy = surfaceVy;
  return v;
}
