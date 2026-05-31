/**
 * Renders the player car: a low-poly body with glowing neon edge lines and twin
 * headlight beams. Reads VehicleState (pure) and positions/rolls the mesh; never
 * mutates state. All geometry built once.
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
    this.group.add(this.makeHeadlight(-width / 2 + CAR_VIS.headlightInset, length));
    this.group.add(this.makeHeadlight(width / 2 - CAR_VIS.headlightInset, length));

    scene.add(this.group);
  }

  /**
   * A soft forward-pointing light beam. Additive blending (not normal) is what
   * makes the open cone read as *light* rather than a flat orange triangle: it
   * ADDS its colour to the scene, brightest where the beam is densest and
   * fading into nothing at the edges. depthWrite off + a render order after the
   * opaque geometry keeps it from ever punching a solid hole over the car.
   * Intensity (headlightOpacity) and length (headlightLength) live in CAR_VIS.
   */
  private makeHeadlight(x: number, length: number): THREE.Mesh {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(
        CAR_VIS.headlightConeRadius,
        CAR_VIS.headlightLength,
        CAR_VIS.headlightConeSegments,
        1,
        true,
      ),
      new THREE.MeshBasicMaterial({
        color: PALETTE.accent,
        transparent: true,
        opacity: CAR_VIS.headlightOpacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    cone.renderOrder = 1; // draw after opaque geometry
    // Point the cone forward (-z) and sit it at the car's nose.
    cone.rotation.x = -Math.PI / 2;
    cone.position.set(x, CAR_VIS.height / 2, -length / 2 - CAR_VIS.headlightLength / 2);
    return cone;
  }

  /** Mirror pure state onto the transform; roll into the steer for feel. */
  sync(state: VehicleState): void {
    this.group.position.x = state.lateral;
    const roll = clamp(-state.lateralVel / CAR_VIS.rollReference, -1, 1) * CAR_VIS.maxRoll;
    this.group.rotation.z = roll;
  }
}
