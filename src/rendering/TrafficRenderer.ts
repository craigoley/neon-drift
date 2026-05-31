/**
 * Renders traffic obstacles. Keeps a pool of meshes keyed by obstacle id and
 * positions them from the pure TrafficState each frame. Never mutates state.
 */

import * as THREE from 'three';
import type { TrafficState } from '../game/Traffic';
import { laneCenters } from '../game/Road';
import { PALETTE } from '../utils/constants';

export class TrafficRenderer {
  private readonly group = new THREE.Group();
  private readonly geometry = new THREE.BoxGeometry(1.6, 1, 2.6);
  private readonly material = new THREE.MeshBasicMaterial({
    color: PALETTE.cyan,
    wireframe: true,
  });
  private readonly pool = new Map<number, THREE.Mesh>();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** Reconcile the mesh pool with the current obstacle list. */
  sync(state: TrafficState): void {
    const lanes = laneCenters();
    const live = new Set<number>();

    for (const obstacle of state.obstacles) {
      live.add(obstacle.id);
      let mesh = this.pool.get(obstacle.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.geometry, this.material);
        this.pool.set(obstacle.id, mesh);
        this.group.add(mesh);
      }
      mesh.position.set(lanes[obstacle.lane] ?? 0, 0.5, obstacle.z);
    }

    // Remove meshes whose obstacles have been culled.
    for (const [id, mesh] of this.pool) {
      if (!live.has(id)) {
        this.group.remove(mesh);
        this.pool.delete(id);
      }
    }
  }
}
