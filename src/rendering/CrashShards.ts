/**
 * Neon-shard particle burst on crash. A fixed-size THREE.Points cloud with a
 * reused position buffer and parallel velocity/life arrays — nothing is
 * allocated when the burst fires. Reads nothing from game state.
 */

import * as THREE from 'three';
import { JUICE, PALETTE } from '../utils/constants';

const GRAVITY = JUICE.shardGravity;
const DRAG = JUICE.shardDrag;
const LIFETIME = JUICE.shardLifetime;
const SPEED = JUICE.shardSpeed;

export class CrashShards {
  private readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private life = 0;
  private readonly material: THREE.PointsMaterial;

  constructor(scene: THREE.Scene) {
    const n = JUICE.shardCount;
    this.positions = new Float32Array(n * 3);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({
      color: PALETTE.magenta,
      size: JUICE.shardSize,
      transparent: true,
      opacity: 0,
      fog: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  /** Fire a burst at a world position. */
  burst(x: number, y: number, z: number): void {
    for (let i = 0; i < this.vx.length; i++) {
      const o = i * 3;
      this.positions[o] = x;
      this.positions[o + 1] = y;
      this.positions[o + 2] = z;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const s = SPEED * (JUICE.spreadMinFraction + (1 - JUICE.spreadMinFraction) * Math.random());
      this.vx[i] = Math.sin(phi) * Math.cos(theta) * s;
      this.vy[i] = Math.abs(Math.cos(phi)) * s;
      this.vz[i] = Math.sin(phi) * Math.sin(theta) * s;
    }
    this.life = LIFETIME;
    this.points.visible = true;
  }

  update(dt: number): void {
    if (this.life <= 0) return;
    this.life -= dt;
    if (this.life <= 0) {
      this.points.visible = false;
      this.material.opacity = 0;
      return;
    }
    const drag = Math.pow(DRAG, dt);
    for (let i = 0; i < this.vx.length; i++) {
      this.vy[i] -= GRAVITY * dt;
      this.vx[i] *= drag;
      this.vz[i] *= drag;
      const o = i * 3;
      this.positions[o] += this.vx[i] * dt;
      this.positions[o + 1] += this.vy[i] * dt;
      this.positions[o + 2] += this.vz[i] * dt;
    }
    this.material.opacity = this.life / LIFETIME;
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
