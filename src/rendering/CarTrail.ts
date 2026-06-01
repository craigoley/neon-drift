/**
 * Car light-trail: a glowing ribbon of the car's recent path that lengthens with
 * speed and burns brighter/hotter while DRIFTING (so a drift leaves a visible
 * streak — ties to the drift skill). Reads vehicle state; never mutates it.
 *
 * Bounded by construction: a FIXED ring buffer of `count` points (touch devices
 * use fewer). Each frame the stored points stream backward (+z) at the world
 * scroll speed and a fresh point is emitted at the car; positions + per-vertex
 * fade colours are written into reused buffers — NO per-frame allocation. Drawn
 * additively (brightness = visibility) and low behind the car, so it reads as
 * glow and never paints over incoming obstacles.
 */

import * as THREE from 'three';
import { clamp, inverseLerp } from '../utils/math';
import { JUICE } from '../utils/constants';

export class CarTrail {
  private readonly count: number;
  private readonly line: THREE.Line;
  private readonly material: THREE.LineBasicMaterial;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;

  // Ring buffer of emitted points (world space). z grows as the world scrolls.
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private head = 0;
  private filled = 0;
  /** Eased global brightness (0..1), driven by speed + drift. */
  private intensity = 0;

  private readonly cool = new THREE.Color(JUICE.trailColor);
  private readonly hot = new THREE.Color(JUICE.trailDriftColor);
  private readonly scratch = new THREE.Color();

  constructor(scene: THREE.Scene, isTouch: boolean) {
    this.count = isTouch ? JUICE.trailPointsTouch : JUICE.trailPoints;
    this.positions = new Float32Array(this.count * 3);
    this.colors = new Float32Array(this.count * 3);
    this.px = new Float32Array(this.count);
    this.py = new Float32Array(this.count);
    this.pz = new Float32Array(this.count);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setDrawRange(0, 0);
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.line = new THREE.Line(geo, this.material);
    this.line.frustumCulled = false;
    scene.add(this.line);
  }

  /**
   * Emit the car's current position, stream the trail backward by `speed*dt`,
   * and rewrite the geometry newest→oldest with a brightness fade. `normSpeed`
   * (0..1) + `drifting` set the colour and how strongly the trail shows.
   */
  update(lateral: number, speed: number, normSpeed: number, drifting: boolean, dt: number): void {
    // Stream existing points backward (toward / past the camera).
    for (let i = 0; i < this.filled; i++) this.pz[i] += speed * dt;

    // Emit a fresh head point at the car (x = lateral, on the road, z = 0).
    this.head = (this.head + 1) % this.count;
    this.px[this.head] = lateral;
    this.py[this.head] = JUICE.trailY;
    this.pz[this.head] = 0;
    if (this.filled < this.count) this.filled++;

    // Target brightness: fades in above the speed floor, peaks higher while
    // drifting (the streak). Eased so it never pops.
    const speedFactor = clamp(inverseLerp(JUICE.trailSpeedFloor, 1, normSpeed), 0, 1);
    const peak = drifting ? JUICE.trailDriftOpacity : JUICE.trailMaxOpacity;
    const target = speedFactor * peak;
    this.intensity += (target - this.intensity) * Math.min(1, dt * JUICE.trailOpacityRate);

    const base = drifting ? this.hot : this.cool;
    if (this.intensity <= JUICE.trailMinIntensity) {
      this.line.visible = false;
      return;
    }
    this.line.visible = true;

    // Write newest→oldest into the contiguous draw buffer with a linear fade so
    // the tail dissolves; additive blending turns brightness into visibility.
    for (let j = 0; j < this.filled; j++) {
      const src = (this.head - j + this.count) % this.count;
      const o = j * 3;
      this.positions[o] = this.px[src];
      this.positions[o + 1] = this.py[src];
      this.positions[o + 2] = this.pz[src];
      const fade = (1 - j / this.count) * this.intensity;
      this.scratch.copy(base).multiplyScalar(fade);
      this.colors[o] = this.scratch.r;
      this.colors[o + 1] = this.scratch.g;
      this.colors[o + 2] = this.scratch.b;
    }
    this.line.geometry.setDrawRange(0, this.filled);
    (this.line.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.line.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Active point count (always ≤ the fixed buffer — for the debug funnel). */
  activeCount(): number {
    return this.filled;
  }

  /** Pool capacity (fixed; never grows). */
  capacity(): number {
    return this.count;
  }
}
