/**
 * Player vehicle physics. PURE — no three, no DOM. Mutates its state in place
 * (the game update owns the only mutation path; renderers only read). Free
 * lateral movement with acceleration + friction so steering feels weighty.
 * Forward speed auto-accelerates toward a cap that rises with distance.
 */

import { clamp, decay } from '../utils/math';
import { ROAD, SLALOM, VEHICLE, type CarHandling } from '../utils/constants';
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
}

export function createVehicleState(): VehicleState {
  return { lateral: 0, lateralVel: 0, speed: VEHICLE.startSpeed, boostTimer: 0 };
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
  slalom = false,
): VehicleState {
  // Forward: auto-accelerate toward the distance-dependent cap, scaled by the
  // car's top-speed multiplier. A live RAMP boost raises the cap by boostBonus
  // so the car can briefly out-run its normal top speed, then settles when the
  // boost expires. In DAILY SLALOM the speed is instead PINNED to a constant (no
  // ramp/accel/boost) so the gate course plays at one fixed pace.
  const baseCap = speedCap(distance) * handling.speedCap;
  const cap = state.boostTimer > 0 ? baseCap + VEHICLE.boostBonus : baseCap;
  state.speed = slalom ? SLALOM.constantSpeed : clamp(state.speed + VEHICLE.acceleration * dt, 0, cap);
  if (state.boostTimer > 0) state.boostTimer = Math.max(0, state.boostTimer - dt);

  // Lateral: steer applies acceleration (scaled by the car's grip), friction
  // bleeds velocity. The per-car `lateralFriction` multiplier is the looseness
  // lever — a higher value retains lateral velocity longer (a slidier, more
  // "agile"/tossable tail), a lower one settles quickly (planted/precise). Clamp
  // the retained fraction below 1 so no multiplier can make the car
  // uncontrollable or blow up to NaN/Infinity.
  state.lateralVel += intent.steer * VEHICLE.lateralAccel * handling.lateralAccel * dt;
  const requested = VEHICLE.lateralFriction * handling.lateralFriction;
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
