/**
 * Speed-line streaks that rush past the camera at high speed. A single
 * LineSegments with a fixed vertex buffer; positions are mutated in place each
 * frame (no per-frame allocation). Opacity fades in above a speed threshold.
 * Reads only camera position + normalised speed; never mutates game state.
 */

import * as THREE from 'three';
import { inverseLerp, clamp } from '../utils/math';
import { JUICE, PALETTE } from '../utils/constants';

const STREAK_LENGTH = JUICE.speedLineLength;
const FIELD_RADIUS = JUICE.speedLineFieldRadius;
const FIELD_DEPTH = JUICE.speedLineFieldDepth;
const FORWARD_SPEED = JUICE.speedLineForwardSpeed;

export class SpeedLines {
  private readonly lines: THREE.LineSegments;
  private readonly positions: Float32Array;
  private readonly material: THREE.LineBasicMaterial;
  // Per-streak local base position (relative to the camera-following group).
  private readonly bx: Float32Array;
  private readonly by: Float32Array;
  private readonly bz: Float32Array;

  constructor(scene: THREE.Scene) {
    const n = JUICE.speedLineCount;
    this.positions = new Float32Array(n * 2 * 3);
    this.bx = new Float32Array(n);
    this.by = new Float32Array(n);
    this.bz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.respawn(i, Math.random() * FIELD_DEPTH);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.LineBasicMaterial({
      color: PALETTE.cyan,
      transparent: true,
      opacity: 0,
      fog: false,
    });
    this.lines = new THREE.LineSegments(geo, this.material);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }

  private respawn(i: number, depthFromFar: number): void {
    const angle = Math.random() * Math.PI * 2;
    const r = FIELD_RADIUS * (0.4 + 0.6 * Math.random());
    this.bx[i] = Math.cos(angle) * r;
    this.by[i] = Math.sin(angle) * r + JUICE.speedLineHeightOffset;
    // Place ahead of the camera (-z), streaming back toward it (+z).
    this.bz[i] = -FIELD_DEPTH + depthFromFar;
  }

  update(cameraX: number, cameraY: number, cameraZ: number, normalizedSpeed: number, dt: number): void {
    const target = clamp(inverseLerp(JUICE.speedLineThreshold, 1, normalizedSpeed), 0, 1);
    this.material.opacity +=
      (target - this.material.opacity) * Math.min(1, dt * JUICE.speedLineOpacityRate);

    this.lines.position.set(cameraX, cameraY, cameraZ);

    const step = FORWARD_SPEED * dt * (JUICE.speedLineBaseSpeedScale + normalizedSpeed);
    for (let i = 0; i < this.bx.length; i++) {
      this.bz[i] += step;
      if (this.bz[i] > JUICE.speedLinePastMargin) this.respawn(i, 0);
      const o = i * 6;
      this.positions[o] = this.bx[i];
      this.positions[o + 1] = this.by[i];
      this.positions[o + 2] = this.bz[i];
      this.positions[o + 3] = this.bx[i];
      this.positions[o + 4] = this.by[i];
      this.positions[o + 5] = this.bz[i] - STREAK_LENGTH;
    }
    (this.lines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
