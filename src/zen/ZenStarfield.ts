/**
 * ZEN FREE-ROAM star-field — a 360° dome of seeded points around the camera, brightness
 * driven by the active biome (Midnight full, Sunset none). The free-roam analogue of the
 * racing Starfield (rendering/Starfield.ts), but DOME-shaped, not a forward box: the Zen
 * camera faces any direction, so stars must surround it on every heading. Positions are
 * seeded + static (allocated once, never grows); only the material opacity changes, so a
 * biome transition is a cheap fade. Horizon-locked to the camera POSITION (like the
 * backdrop) so the dome drifts with you but never follows your facing.
 */

import * as THREE from 'three';
import { ZEN_STARS } from '../utils/constants';
import { hashNoise } from '../utils/rng';

export class ZenStarfield {
  readonly points: THREE.Points;
  private readonly group = new THREE.Group();
  private readonly material: THREE.PointsMaterial;
  private readonly geo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, seed: number) {
    const positions = new Float32Array(ZEN_STARS.count * 3);
    const R = ZEN_STARS.radius;
    for (let i = 0; i < ZEN_STARS.count; i++) {
      // Two seeded hashes → a stable point on the UPPER hemisphere dome. `hy` biases the
      // height to the [minHeightFraction, 1] band so no star sits below the mountains.
      const az = (hashNoise(seed, i * 2 + 1) + 1) * Math.PI; // [0, 2π) azimuth
      const hy = ZEN_STARS.minHeightFraction +
        (hashNoise(seed, i * 2 + 2) * 0.5 + 0.5) * (1 - ZEN_STARS.minHeightFraction); // [minH, 1]
      const y = hy * R;
      const ring = Math.sqrt(Math.max(0, R * R - y * y)); // horizontal radius at this height
      positions[i * 3] = Math.cos(az) * ring;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(az) * ring;
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: ZEN_STARS.size,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      // Pure background layer — never depth-interacts with the floor / props / car.
      fog: false,
      depthWrite: false,
      depthTest: false,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = ZEN_STARS.renderOrder;
    this.points.visible = false;
    this.group.add(this.points);
    scene.add(this.group);
  }

  /** Biome brightness in [0, 1]; hides the dome entirely at ~0 (no overdraw in daylit
   *  biomes like Sunset). */
  setIntensity(intensity: number): void {
    const op = Math.max(0, Math.min(1, intensity)) * ZEN_STARS.baseOpacity;
    this.material.opacity = op;
    this.points.visible = op > 0.01;
  }

  /** Keep the dome centred on the camera position (horizon-lock — drifts with you, never
   *  follows your facing). */
  update(cameraX: number, cameraZ: number): void {
    this.group.position.set(cameraX, 0, cameraZ);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geo.dispose();
    this.material.dispose();
  }
}
