/**
 * ZEN SPEED STREAKS — the "I'm boosting" visual for the ARCH speed-boost. Thin neon lines arranged
 * in a tube around the car's forward axis, streaming BACKWARD past the camera (the universal sense
 * of speed), bloom-lit (additive). They fade IN with the boost intensity and ease OUT as it decays —
 * invisible at rest. Calm-exhilarating, not violent: few lines, soft opacity, no flicker.
 *
 * One LineSegments with a reused position buffer (no per-frame allocation); hidden when not boosting.
 */

import * as THREE from 'three';
import { ZEN_ARCH } from '../utils/constants';

export class ZenSpeedStreaks {
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.LineBasicMaterial;
  private readonly mesh: THREE.LineSegments;
  private readonly pos: Float32Array;
  /** Per-streak fixed angle around the forward axis + radius; animated phase along the span. */
  private readonly ang: number[] = [];
  private readonly rad: number[] = [];
  private readonly phase: number[] = [];

  constructor(scene: THREE.Scene) {
    const n = ZEN_ARCH.streakCount;
    this.pos = new Float32Array(n * 2 * 3); // 2 endpoints × xyz per streak
    for (let i = 0; i < n; i++) {
      this.ang.push((i / n) * Math.PI * 2 + (i % 3) * 0.7); // spread around the tube, decorrelated
      this.rad.push(ZEN_ARCH.streakRadius * (0.55 + 0.45 * ((i * 0.6180339) % 1))); // varied radii
      this.phase.push((i * 0.6180339) % 1); // golden-ratio spread along the span
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({
      color: ZEN_ARCH.streakColor,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.LineSegments(this.geo, this.mat);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false; // it tracks the car; never cull
    scene.add(this.mesh);
  }

  /** Place + flow the streaks around the car. `intensity` ∈ [0,1] (0 = off → hidden). */
  update(carX: number, carY: number, carZ: number, heading: number, intensity: number, dt: number): void {
    if (intensity < 0.02) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mat.opacity = ZEN_ARCH.streakOpacity * intensity;

    // Forward axis + the two perpendiculars spanning the tube cross-section (horizontal + up).
    const fx = Math.sin(heading);
    const fz = -Math.cos(heading);
    const px = Math.cos(heading); // horizontal perpendicular
    const pz = Math.sin(heading);
    const span = ZEN_ARCH.streakSpan;
    const len = ZEN_ARCH.streakLength;
    // Faster flow when more boosted (streaks rush past harder); decrement phase → front-to-back.
    const flow = ZEN_ARCH.streakFlow * (0.5 + 0.5 * intensity) * dt;

    for (let i = 0; i < this.ang.length; i++) {
      let ph = this.phase[i] - flow;
      ph -= Math.floor(ph); // wrap to [0,1)
      this.phase[i] = ph;
      const s = (ph - 0.5) * span; // along the forward axis, ahead (+) → behind (−)
      const r = this.rad[i];
      const ca = Math.cos(this.ang[i]) * r;
      const sa = Math.sin(this.ang[i]) * r;
      // Tube point = car + forward·s + horizontalPerp·ca + up·sa.
      const cx = carX + fx * s + px * ca;
      const cy = carY + sa;
      const cz = carZ + fz * s + pz * ca;
      const o = i * 6;
      this.pos[o] = cx;
      this.pos[o + 1] = cy;
      this.pos[o + 2] = cz;
      this.pos[o + 3] = cx - fx * len; // trailing end, behind along forward
      this.pos[o + 4] = cy;
      this.pos[o + 5] = cz - fz * len;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
