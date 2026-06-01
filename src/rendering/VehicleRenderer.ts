/**
 * Renders the player car: the shared procedural low-poly synthwave vehicle (see
 * CarMesh) — a tapered hull, raked cabin, four wheels, neon edge lines and a
 * ground-glow blob. Reads VehicleState (pure) and positions the mesh; never
 * mutates state. Geometry is built once.
 *
 * The lateral position is applied to the OUTER group; roll (steer lean) and yaw
 * (drift slide) are applied to the inner `chassis`, so the ground-glow blob that
 * sits under the car stays flat on the road and doesn't tilt with the lean.
 *
 * Cosmetics are driven by the selected car (`applyCar`): body (a deep signature
 * tint), neon glow (edges + ground glow) and accent (side strips). There are no
 * headlights — forward light quads regressed to opaque artifacts twice (#13,
 * #42) and were removed.
 */

import * as THREE from 'three';
import type { VehicleState } from '../game/Vehicle';
import { clamp } from '../utils/math';
import { CAR_VIS, PALETTE, type CarDef } from '../utils/constants';
import { CarMesh } from './CarMesh';

export class VehicleRenderer {
  readonly group: THREE.Group;

  private readonly car: CarMesh;
  /** The car's own glow colour (restored when not drifting). */
  private readonly baseGlow = new THREE.Color(PALETTE.cyan);
  /** Hot drift glow lerp target. */
  private readonly driftGlow = new THREE.Color(CAR_VIS.driftGlow);

  constructor(scene: THREE.Scene, car?: CarDef) {
    this.car = new CarMesh(car);
    this.group = this.car.group;
    if (car) this.baseGlow.setHex(car.cosmetic.glow);
    scene.add(this.group);
  }

  /** Apply a car's cosmetic colours. Cheap — only colours change. */
  applyCar(car: CarDef): void {
    this.car.applyCar(car);
    this.baseGlow.setHex(car.cosmetic.glow);
  }

  /**
   * Mirror pure state onto the transform. Roll leans into the steer for feel;
   * while DRIFTING the car also YAWS into the slide (nose kicks out) and the
   * glow shifts hot, so a drift is unmistakable at a glance.
   */
  sync(state: VehicleState): void {
    this.group.position.x = state.lateral;

    const chassis = this.car.chassis;
    const rollBoost = state.drifting ? CAR_VIS.driftRollBoost : 1;
    chassis.rotation.z =
      clamp(-state.lateralVel / CAR_VIS.rollReference, -1, 1) * CAR_VIS.maxRoll * rollBoost;

    // Yaw only while drifting — the nose angles into the slide direction.
    chassis.rotation.y = state.drifting
      ? clamp(-state.lateralVel / CAR_VIS.driftYawReference, -1, 1) * CAR_VIS.driftMaxYaw
      : 0;

    // Glow eases toward the hot drift colour while drifting, back otherwise.
    // lerp() mutates in place; snap to the target once within epsilon so the
    // asymptotic ease settles instead of running a vanishing step every frame.
    const target = state.drifting ? this.driftGlow : this.baseGlow;
    const glow = this.car.edgesMat.color;
    if (!glow.equals(target)) {
      glow.lerp(target, CAR_VIS.driftGlowLerp);
      const dist =
        Math.abs(glow.r - target.r) + Math.abs(glow.g - target.g) + Math.abs(glow.b - target.b);
      if (dist < CAR_VIS.driftGlowSnap) glow.copy(target);
    }
  }
}
