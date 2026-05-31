/**
 * Renders traffic obstacles as a single InstancedMesh sized to the pure pool.
 * Each frame, active obstacles get a transform and inactive slots are collapsed
 * to zero scale. One reused scratch Object3D composes the matrices — no per-frame
 * allocation. Reads game state; never mutates it.
 */

import * as THREE from 'three';
import type { TrafficState } from '../game/Traffic';
import { TRAFFIC, TRAFFIC_VIS } from '../utils/constants';

export class TrafficRenderer {
  private readonly mesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BoxGeometry(TRAFFIC.halfWidth * 2, TRAFFIC_VIS.meshHeight, TRAFFIC.halfLength * 2);
    // Readability: paint the top (+y) and leading (+z, camera-facing) faces with
    // a bright edge colour and the rest with the orange body, via vertex colours.
    // The hot rim separates an obstacle from whatever it sits against — including
    // the sun's bands at the horizon — so a flat-orange box can't camouflage.
    // BoxGeometry face order is +x,-x,+y,-y,+z,-z (4 verts each); +y = 8..11,
    // +z = 16..19.
    const body = new THREE.Color(TRAFFIC_VIS.bodyColor);
    const edge = new THREE.Color(TRAFFIC_VIS.edgeColor);
    const colors = new Float32Array(24 * 3);
    for (let v = 0; v < 24; v++) {
      const c = (v >= 8 && v <= 11) || (v >= 16 && v <= 19) ? edge : body;
      colors[v * 3] = c.r;
      colors[v * 3 + 1] = c.g;
      colors[v * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
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
      this.dummy.position.set(o.lateral, TRAFFIC_VIS.meshY, -(o.distance - playerDistance));
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
