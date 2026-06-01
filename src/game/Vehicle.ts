/**
 * Player vehicle physics. PURE — no three, no DOM. Mutates its state in place
 * (the game update owns the only mutation path; renderers only read). Free
 * lateral movement with acceleration + friction so steering feels weighty; the
 * handbrake reduces lateral friction for sharp drift dodges. Forward speed
 * auto-accelerates toward a cap that rises with distance.
 */

import { clamp, decay } from '../utils/math';
import { DRIFT, ROAD, VEHICLE, type CarHandling } from '../utils/constants';
import type { InputIntent } from './Input';

export interface VehicleState {
  /** Lateral position, 0 = centre, clamped to +/- road half-width. */
  lateral: number;
  /** Lateral velocity (world units / second). */
  lateralVel: number;
  /** Forward speed (world units / second). */
  speed: number;
  /** Seconds remaining on a RAMP speed boost. While > 0 the speed cap is raised
   *  by VEHICLE.boostBonus so the car can briefly ride above its normal top
   *  speed; 0 = no boost. */
  boostTimer: number;
  /** True while a drift is active (handbrake held mid-run). Read by the renderer
   *  (yaw/trail/colour), audio (screech) and scoring (drifted near-miss bonus). */
  drifting: boolean;
}

export function createVehicleState(): VehicleState {
  return { lateral: 0, lateralVel: 0, speed: VEHICLE.startSpeed, boostTimer: 0, drifting: false };
}

/**
 * The forward speed cap for a given distance travelled. Rises from baseSpeedCap
 * toward maxSpeedCap on an exponential-approach curve (never quite reaching it).
 */
export function speedCap(distance: number): number {
  const t = 1 - Math.exp(-distance / VEHICLE.speedCapRampDistance);
  return VEHICLE.baseSpeedCap + (VEHICLE.maxSpeedCap - VEHICLE.baseSpeedCap) * t;
}

/** Normalised speed in [0, 1] across the whole cap range — for FOV/audio/juice. */
export function normalizedSpeed(speed: number): number {
  const span = VEHICLE.maxSpeedCap - VEHICLE.baseSpeedCap;
  if (span <= 0) return 0;
  return clamp((speed - VEHICLE.baseSpeedCap) / span, 0, 1);
}

/**
 * Advance the vehicle by `dt` seconds under the given intent and distance.
 * Per-car `handling` multipliers scale the base tuning (see CarHandling); pass
 * BASE_HANDLING for stock behaviour. Mutates and returns `state`.
 */
export function updateVehicle(
  state: VehicleState,
  intent: InputIntent,
  distance: number,
  roadCenter: number,
  handling: CarHandling,
  dt: number,
): VehicleState {
  // Forward: auto-accelerate toward the distance-dependent cap, scaled by the
  // car's top-speed multiplier. A live RAMP boost raises the cap by boostBonus
  // so the car can briefly out-run its normal top speed, then settles when the
  // boost expires.
  const baseCap = speedCap(distance) * handling.speedCap;
  const cap = state.boostTimer > 0 ? baseCap + VEHICLE.boostBonus : baseCap;
  state.speed = clamp(state.speed + VEHICLE.acceleration * dt, 0, cap);
  if (state.boostTimer > 0) state.boostTimer = Math.max(0, state.boostTimer - dt);

  state.drifting = intent.handbrake;

  // DRIFT speed cost (the trade): holding the handbrake scrubs forward speed
  // toward a floor (a fraction of the cap), so a juke costs distance/score and
  // can't just be held forever. Normal acceleration recovers it once released.
  if (state.drifting) {
    // Clamp the floor to the current speed so a drift can only ever REMOVE
    // speed — never nudge it up to the floor on the rare frame speed sits just
    // below it (the cap, and thus the floor, rises with distance).
    const floor = Math.min(state.speed, cap * DRIFT.minSpeedFraction);
    state.speed = Math.max(floor, state.speed - DRIFT.speedDrag * dt);
  }

  // Lateral: steer applies acceleration (scaled by grip); friction bleeds
  // velocity. While DRIFTING the steering accel is multiplied (DRIFT.accelBoost,
  // scaled by the car's `drift` stat) for a sharp juke — this is what makes a
  // last-second dodge possible and is the felt difference normal steering can't
  // match. The handbrake also retains far more lateral velocity (the slide).
  // Clamp the retained fraction below 1 so no multiplier can make the car
  // uncontrollable or blow up to NaN/Infinity.
  const accelMul = state.drifting ? DRIFT.accelBoost * handling.drift : 1;
  state.lateralVel += intent.steer * VEHICLE.lateralAccel * handling.lateralAccel * accelMul * dt;
  const requested = intent.handbrake
    ? VEHICLE.handbrakeFriction * handling.drift
    : VEHICLE.lateralFriction * handling.lateralFriction;
  const retained = clamp(requested, 0, VEHICLE.maxRetainedFriction);
  state.lateralVel *= decay(retained, dt);
  state.lateral += state.lateralVel * dt;

  // Clamp to the road, which bends with the curve — the drivable corridor is
  // [centre - halfWidth, centre + halfWidth]. Kill velocity into the wall so
  // the car doesn't stick. The player must steer to follow the bend.
  const maxLat = roadCenter + ROAD.halfWidth;
  const minLat = roadCenter - ROAD.halfWidth;
  if (state.lateral > maxLat) {
    state.lateral = maxLat;
    if (state.lateralVel > 0) state.lateralVel = 0;
  } else if (state.lateral < minLat) {
    state.lateral = minLat;
    if (state.lateralVel < 0) state.lateralVel = 0;
  }

  return state;
}
