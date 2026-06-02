/**
 * Renders the player car: the shared procedural low-poly synthwave vehicle (see
 * CarMesh) — a tapered hull, raked cabin, four wheels, neon edge lines and a
 * ground-glow blob. Reads VehicleState (pure) and positions the mesh; never
 * mutates state. Geometry is built once.
 *
 * The lateral position is applied to the OUTER group; roll (steer lean) is
 * applied to the inner `chassis`, so the ground-glow blob that sits under the car
 * stays flat on the road and doesn't tilt with the lean.
 *
 * Cosmetics are driven by the selected car (`applyCar`): body (a deep signature
 * tint), neon glow (edges + ground glow) and accent (side strips). There are no
 * headlights — forward light quads regressed to opaque artifacts twice (#13,
 * #42) and were removed.
 */

import * as THREE from 'three';
import type { VehicleState } from '../game/Vehicle';
import { clamp } from '../utils/math';
import { CAR_VIS, type CarDef } from '../utils/constants';
import { CarMesh } from './CarMesh';

export class VehicleRenderer {
  readonly group: THREE.Group;

  private readonly car: CarMesh;

  constructor(scene: THREE.Scene, car?: CarDef) {
    this.car = new CarMesh(car);
    this.group = this.car.group;
    scene.add(this.group);
  }

  /** Apply a car's cosmetic colours. Cheap — only colours change. */
  applyCar(car: CarDef): void {
    this.car.applyCar(car);
  }

  /** Mirror pure state onto the transform. Roll leans the chassis into the steer
   *  for feel; the outer group carries the lateral position. */
  sync(state: VehicleState): void {
    this.group.position.x = state.lateral;

    const chassis = this.car.chassis;
    chassis.rotation.z = clamp(-state.lateralVel / CAR_VIS.rollReference, -1, 1) * CAR_VIS.maxRoll;
  }
}
