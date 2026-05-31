/**
 * Player vehicle physics. PURE — no three, no DOM. Mutates its state in place
 * (the game update owns the only mutation path; renderers only read). Free
 * lateral movement with acceleration + friction so steering feels weighty; the
 * handbrake reduces lateral friction for sharp drift dodges. Forward speed
 * auto-accelerates toward a cap that rises with distance.
 */

import { clamp, decay } from '../utils/math';
import { ROAD, VEHICLE } from '../utils/constants';
import type { InputIntent } from './Input';

export interface VehicleState {
  /** Lateral position, 0 = centre, clamped to +/- road half-width. */
  lateral: number;
  /** Lateral velocity (world units / second). */
  lateralVel: number;
  /** Forward speed (world units / second). */
  speed: number;
}

export function createVehicleState(): VehicleState {
  return { lateral: 0, lateralVel: 0, speed: VEHICLE.startSpeed };
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
 * Mutates and returns `state`.
 */
export function updateVehicle(
  state: VehicleState,
  intent: InputIntent,
  distance: number,
  dt: number,
): VehicleState {
  // Forward: auto-accelerate toward the distance-dependent cap.
  const cap = speedCap(distance);
  state.speed = clamp(state.speed + VEHICLE.acceleration * dt, 0, cap);

  // Lateral: steer applies acceleration; friction bleeds velocity. Handbrake
  // retains far more lateral velocity, letting the car slide/drift sideways.
  state.lateralVel += intent.steer * VEHICLE.lateralAccel * dt;
  const retained = intent.handbrake ? VEHICLE.handbrakeFriction : VEHICLE.lateralFriction;
  state.lateralVel *= decay(retained, dt);
  state.lateral += state.lateralVel * dt;

  // Clamp to the road; kill velocity into the wall so the car doesn't stick.
  if (state.lateral > ROAD.halfWidth) {
    state.lateral = ROAD.halfWidth;
    if (state.lateralVel > 0) state.lateralVel = 0;
  } else if (state.lateral < -ROAD.halfWidth) {
    state.lateral = -ROAD.halfWidth;
    if (state.lateralVel < 0) state.lateralVel = 0;
  }

  return state;
}
