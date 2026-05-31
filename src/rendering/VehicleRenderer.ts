/**
 * Renders the player vehicle as procedural neon geometry. Reads VehicleState
 * (a pure type from the game layer) and positions the mesh. Never mutates it.
 */

import * as THREE from 'three';
import type { VehicleState } from '../game/Vehicle';
import { PALETTE } from '../utils/constants';

export class VehicleRenderer {
  readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.BoxGeometry(1.4, 0.6, 2.4);
    const material = new THREE.MeshBasicMaterial({
      color: PALETTE.accent,
      wireframe: true,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(0, 0.3, 0);
    scene.add(this.mesh);
  }

  /** Mirror the pure vehicle state onto the mesh transform. */
  sync(state: VehicleState): void {
    this.mesh.position.x = state.lateral;
  }
}
