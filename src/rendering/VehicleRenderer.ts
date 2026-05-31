/**
 * Renders the player car: a low-poly body with glowing neon edge lines and twin
 * headlight beams. Reads VehicleState (pure) and positions/rolls the mesh; never
 * mutates state. All geometry built once.
 *
 * Cosmetics are driven by the selected car (`applyCar`): body, glow (edges) and
 * accent (headlights) colours. Physics is identical across cars this PR — only
 * the colours change.
 */

import * as THREE from 'three';
import type { VehicleState } from '../game/Vehicle';
import { clamp } from '../utils/math';
import { CAR_VIS, type CarDef } from '../utils/constants';

export class VehicleRenderer {
  readonly group = new THREE.Group();

  private readonly bodyMat: THREE.MeshBasicMaterial;
  private readonly edgesMat: THREE.LineBasicMaterial;
  private readonly headlightMats: THREE.MeshBasicMaterial[] = [];

  constructor(scene: THREE.Scene) {
    const { width, height, length } = CAR_VIS;

    // Dark body so the emissive edges read as neon wireframe.
    this.bodyMat = new THREE.MeshBasicMaterial();
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, length), this.bodyMat);
    body.position.y = height / 2;

    this.edgesMat = new THREE.LineBasicMaterial();
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, length)),
      this.edgesMat,
    );
    edges.position.y = height / 2;

    this.group.add(body, edges);
    this.group.add(this.makeHeadlight(-width / 2 + CAR_VIS.headlightInset, length));
    this.group.add(this.makeHeadlight(width / 2 - CAR_VIS.headlightInset, length));

    scene.add(this.group);
  }

  /**
   * A soft forward-pointing light beam. Additive blending (not normal) is what
   * makes the open cone read as *light* rather than a flat triangle: it ADDS its
   * colour to the scene, brightest where the beam is densest and fading at the
   * edges. depthWrite off + a render order after the opaque geometry keeps it
   * from punching a solid hole over the car.
   */
  private makeHeadlight(x: number, length: number): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: CAR_VIS.headlightOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.headlightMats.push(mat);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(
        CAR_VIS.headlightConeRadius,
        CAR_VIS.headlightLength,
        CAR_VIS.headlightConeSegments,
        1,
        true,
      ),
      mat,
    );
    cone.renderOrder = CAR_VIS.headlightRenderOrder; // draw after opaque geometry
    // Point the cone forward (-z) and sit it at the car's nose.
    cone.rotation.x = -Math.PI / 2;
    cone.position.set(x, CAR_VIS.height / 2, -length / 2 - CAR_VIS.headlightLength / 2);
    return cone;
  }

  /** Apply a car's cosmetic colours. Cheap — only material colours change. */
  applyCar(car: CarDef): void {
    this.bodyMat.color.setHex(car.cosmetic.body);
    this.edgesMat.color.setHex(car.cosmetic.glow);
    for (const mat of this.headlightMats) mat.color.setHex(car.cosmetic.accent);
  }

  /** Mirror pure state onto the transform; roll into the steer for feel. */
  sync(state: VehicleState): void {
    this.group.position.x = state.lateral;
    const roll = clamp(-state.lateralVel / CAR_VIS.rollReference, -1, 1) * CAR_VIS.maxRoll;
    this.group.rotation.z = roll;
  }
}
