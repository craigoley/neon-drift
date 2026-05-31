/**
 * Renders the player car: a dark low-poly body with glowing neon edge lines.
 * Reads VehicleState (pure) and positions/rolls the mesh; never mutates state.
 * All geometry built once.
 *
 * The forward headlight cones were removed: from the chase cam (behind/above)
 * the open cones rendered as two flat triangles stuck to the car's nose rather
 * than reading as light (additive blending on a flat, unlit cone still paints
 * solid triangles). They didn't earn their place, so the car is now just the
 * neon wireframe box.
 */

import * as THREE from 'three';
import type { VehicleState } from '../game/Vehicle';
import { clamp } from '../utils/math';
import { CAR_VIS, PALETTE } from '../utils/constants';

export class VehicleRenderer {
  readonly group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    const { width, height, length } = CAR_VIS;

    // Dark body so the emissive edges read as neon wireframe.
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, length),
      new THREE.MeshBasicMaterial({ color: PALETTE.deepPurple }),
    );
    body.position.y = height / 2;

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, length)),
      new THREE.LineBasicMaterial({ color: PALETTE.cyan }),
    );
    edges.position.y = height / 2;

    this.group.add(body, edges);
    scene.add(this.group);
  }

  /** Mirror pure state onto the transform; roll into the steer for feel. */
  sync(state: VehicleState): void {
    this.group.position.x = state.lateral;
    const roll = clamp(-state.lateralVel / CAR_VIS.rollReference, -1, 1) * CAR_VIS.maxRoll;
    this.group.rotation.z = roll;
  }
}
