/**
 * ZEN AIR-SHADOW — the readability fix for air-time (#116 launched the car a real ~5–9u
 * but it read invisibly: nothing was terrain-anchored, so no gap ever opened). A glow
 * ellipse pinned to the TERRAIN directly under the car (NOT parented to the car), so:
 *   - GROUNDED: it sits right under the car → reads as the car's ground spot (like before).
 *   - AIRBORNE: the car rises but the shadow STAYS on the ground → a visible GAP opens =
 *     the universal "it's in the air" cue. Shrinks + dims with height (a classic shadow).
 * No physics change — this just makes the EXISTING arc read instantly.
 */

import * as THREE from 'three';
import { ZEN } from '../utils/constants';
import { clamp, lerp } from '../utils/math';

export class ZenShadow {
  private readonly geo: THREE.CircleGeometry;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.geo = new THREE.CircleGeometry(ZEN.shadowRadius, 24);
    this.mat = new THREE.MeshBasicMaterial({
      color: ZEN.shadowColor,
      transparent: true,
      opacity: ZEN.shadowOpacity,
      blending: THREE.AdditiveBlending, // a glow spot on the neon floor, on-aesthetic
      depthWrite: false,
      fog: true,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.rotation.x = -Math.PI / 2; // lie flat on the ground (XZ plane)
    this.mesh.renderOrder = 1; // over the wireframe terrain, under the car
    scene.add(this.mesh);
  }

  /**
   * Pin the shadow to the terrain under the car. `airHeight` = carY − groundY (≈0 grounded,
   * up to the arc height airborne) shrinks + dims it so a gap clearly opens as the car
   * rises. Pure scalar math; no per-frame allocation.
   */
  update(carX: number, groundY: number, carZ: number, airHeight: number): void {
    this.mesh.position.set(carX, groundY + ZEN.shadowYOffset, carZ);
    const t = clamp(airHeight / ZEN.shadowFadeHeight, 0, 1);
    const s = lerp(1, ZEN.shadowMinScale, t);
    this.mesh.scale.set(s, s, s);
    this.mat.opacity = ZEN.shadowOpacity * lerp(1, ZEN.shadowMinOpacityMul, t);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
