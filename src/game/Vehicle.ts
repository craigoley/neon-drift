/**
 * Player vehicle physics. PURE — no three, no DOM. Deterministic given the same
 * input and timestep, so it is fully unit-testable in Node.
 */

import { clamp } from '../utils/math';
import { VEHICLE } from '../utils/constants';
import type { InputState } from './Input';

export interface VehicleState {
  /** Lateral position across the road, clamped to [-lateralBound, +lateralBound]. */
  lateral: number;
  /** Current forward speed in world-units per second. */
  speed: number;
  /** Total forward distance travelled this run, in world units. */
  distance: number;
}

export function createVehicleState(): VehicleState {
  return { lateral: 0, speed: VEHICLE.baseSpeed, distance: 0 };
}

/**
 * Advance the vehicle by `dt` seconds under the given input. Returns a new
 * state object — never mutates the input state.
 */
export function updateVehicle(state: VehicleState, input: InputState, dt: number): VehicleState {
  // Forward speed: accelerate toward maxSpeed, brake back toward baseSpeed.
  let speed = state.speed;
  if (input.brake) {
    speed -= VEHICLE.acceleration * 2 * dt;
  } else if (input.accelerate) {
    speed += VEHICLE.acceleration * dt;
  }
  speed = clamp(speed, VEHICLE.baseSpeed, VEHICLE.maxSpeed);

  // Lateral movement from steer input, clamped to the road edges.
  const lateral = clamp(
    state.lateral + input.steer * VEHICLE.lateralSpeed * dt,
    -VEHICLE.lateralBound,
    VEHICLE.lateralBound,
  );

  return {
    lateral,
    speed,
    distance: state.distance + speed * dt,
  };
}
