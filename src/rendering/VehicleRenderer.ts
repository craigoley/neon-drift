/**
 * Renders the player car: a dark low-poly body with glowing neon edge lines.
 * Reads VehicleState (pure) and positions/rolls the mesh; never mutates state.
 * All geometry built once.
 *
 * The forward headlight cones were removed (#13): from the chase cam (behind/
 * above) the open cones rendered as flat triangles stuck to the nose rather than
 * reading as light, so the car is just the neon wireframe box now.
 *
 * Cosmetics are driven by the selected car (`applyCar`): body + glow (edge)
 * colours. Physics is identical across cars this PR — only the colours change.
 * (The car's `accent` colour is used by the car-picker preview, not the mesh.)
 */

import * as THREE from 'three';
import type { VehicleState } from '../game/Vehicle';
import { clamp } from '../utils/math';
import { CAR_VIS, PALETTE, type CarDef } from '../utils/constants';

export class VehicleRenderer {
  readonly group = new THREE.Group();

  private readonly bodyMat: THREE.MeshBasicMaterial;
  private readonly edgesMat: THREE.LineBasicMaterial;

  constructor(scene: THREE.Scene) {
    const { width, height, length } = CAR_VIS;

    // Dark body so the emissive edges read as neon wireframe. Default colours
    // match the original look; applyCar() overrides them per selected car.
    this.bodyMat = new THREE.MeshBasicMaterial({ color: PALETTE.deepPurple });
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, length), this.bodyMat);
    body.position.y = height / 2;

    this.edgesMat = new THREE.LineBasicMaterial({ color: PALETTE.cyan });
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, length)),
      this.edgesMat,
    );
    edges.position.y = height / 2;

    this.group.add(body, edges);
    scene.add(this.group);
  }

  /** Apply a car's cosmetic colours (body + glow). Cheap — only colours change. */
  applyCar(car: CarDef): void {
    this.bodyMat.color.setHex(car.cosmetic.body);
    this.edgesMat.color.setHex(car.cosmetic.glow);
  }

  /** Mirror pure state onto the transform; roll into the steer for feel. */
  sync(state: VehicleState): void {
    this.group.position.x = state.lateral;
    const roll = clamp(-state.lateralVel / CAR_VIS.rollReference, -1, 1) * CAR_VIS.maxRoll;
    this.group.rotation.z = roll;
  }
}
