/**
 * Renders traffic obstacles as a single InstancedMesh sized to the pure pool.
 * Each frame, active obstacles get a transform and inactive slots are collapsed
 * to zero scale. One reused scratch Object3D composes the matrices — no per-frame
 * allocation. Reads game state; never mutates it.
 */

import * as THREE from 'three';
import type { TrafficState } from '../game/Traffic';
import { TRAFFIC, PALETTE } from '../utils/constants';

export class TrafficRenderer {
  private readonly mesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BoxGeometry(TRAFFIC.halfWidth * 2, 1.2, TRAFFIC.halfLength * 2);
    const mat = new THREE.MeshBasicMaterial({ color: PALETTE.accent });
    this.mesh = new THREE.InstancedMesh(geo, mat, TRAFFIC.poolSize);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Position active obstacles; collapse inactive slots. Car at z = 0, ahead -z. */
  sync(traffic: TrafficState, playerDistance: number): void {
    const pool = traffic.pool;
    for (let i = 0; i < pool.length; i++) {
      const o = pool[i];
      if (!o.active) {
        this.mesh.setMatrixAt(i, this.hidden);
        continue;
      }
      this.dummy.position.set(o.lateral, 0.6, -(o.distance - playerDistance));
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
