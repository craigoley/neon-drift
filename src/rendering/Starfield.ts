/**
 * Procedural star-field backdrop: a fixed cloud of points high in the night sky.
 * Three.js layer — positions are seeded + static (allocated once, never grows);
 * brightness is driven by the active biome (Midnight full, Sunset none) via
 * setIntensity. Follows the camera horizontally so the stars sit in the sky like
 * the rest of the backdrop, and draws behind the sun + mountains.
 */

import * as THREE from 'three';
import { STARFIELD } from '../utils/constants';
import { hashNoise } from '../utils/rng';

export class Starfield {
  readonly points: THREE.Points;
  private readonly material: THREE.PointsMaterial;

  constructor(scene: THREE.Scene, seed: number) {
    const positions = new Float32Array(STARFIELD.count * 3);
    for (let i = 0; i < STARFIELD.count; i++) {
      // Three independent seeded hashes per star → stable, reproducible layout.
      const hx = hashNoise(seed, i * 3 + 1); // [-1, 1]
      const hy = hashNoise(seed, i * 3 + 2) * 0.5 + 0.5; // [0, 1]
      const hz = hashNoise(seed, i * 3 + 3); // [-1, 1]
      positions[i * 3] = hx * STARFIELD.halfWidth;
      positions[i * 3 + 1] = STARFIELD.yMin + hy * (STARFIELD.yMax - STARFIELD.yMin);
      positions[i * 3 + 2] = hz * STARFIELD.halfDepth;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: STARFIELD.size,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      // Pure background layer — never depth-interacts with gameplay geometry.
      fog: false,
      depthWrite: false,
      depthTest: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = STARFIELD.renderOrder;
    this.points.visible = false;
    scene.add(this.points);
  }

  /** Biome brightness in [0, 1]; hides the field entirely at ~0 (no overdraw). */
  setIntensity(intensity: number): void {
    const op = Math.max(0, Math.min(1, intensity)) * STARFIELD.baseOpacity;
    this.material.opacity = op;
    this.points.visible = op > 0.01;
  }

  /** Keep the star box centred on the camera (in the sky ahead). */
  update(cameraX: number, cameraZ: number): void {
    this.points.position.set(cameraX, 0, cameraZ - STARFIELD.depth);
  }
}
