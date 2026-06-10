/**
 * ZEN FREE-ROAM renderer — a PARALLEL three.js scene + chase camera, drawn with the
 * game's SHARED WebGLRenderer (one GL context; the forward SceneManager scene is left
 * untouched and simply not drawn while Zen is active). Reuses the procedural `CarMesh`
 * (so the player drives THE car, cosmetics and all); the rest (grid plane, chase cam)
 * is Zen-specific. No post/bloom in PR1 — the FEEL gate is about movement, not polish.
 *
 * The camera follows the car's position and eases BEHIND its facing (smoothed) for a
 * gliding, calm chase — distinct from the forward game's fixed, forward-locked cam.
 */

import * as THREE from 'three';
import { PALETTE, ZEN, type CarDef } from '../utils/constants';
import { clamp, smoothFollow } from '../utils/math';
import { CarMesh } from '../rendering/CarMesh';
import type { ZenVehicle } from './ZenVehicle';

export class ZenRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly car: CarMesh;
  private readonly grid: THREE.GridHelper;
  private readonly cell: number;
  private aspect = 0;

  constructor(renderer: THREE.WebGLRenderer, car?: CarDef) {
    this.renderer = renderer;
    this.scene.background = new THREE.Color(PALETTE.deepPurple);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 4000);
    this.camera.position.set(0, ZEN.camHeight, ZEN.camDistance);

    // Streaming neon grid = the "endless plane". Recentred on the car (snapped to a
    // cell) each frame so the lines appear to flow under the car in any direction.
    this.cell = ZEN.gridSize / ZEN.gridDivisions;
    this.grid = new THREE.GridHelper(ZEN.gridSize, ZEN.gridDivisions, ZEN.gridCenterColor, ZEN.gridColor);
    this.grid.position.y = ZEN.groundY;
    this.scene.add(this.grid);

    this.car = new CarMesh(car);
    this.scene.add(this.car.group);

    this.resize();
  }

  /** Apply a car's cosmetic colours (selected car + its paint). */
  applyCar(car: CarDef): void {
    this.car.applyCar(car);
  }

  /** Equip / clear a GLOW cosmetic override on the Zen car (purely visual). */
  setGlow(hex: number | null): void {
    this.car.setGlowOverride(hex);
  }

  /**
   * Mirror the pure Zen vehicle onto the scene + ease the chase camera, then draw.
   * `steer` drives a gentle visual bank; `dt` paces the camera smoothing.
   */
  render(v: ZenVehicle, steer: number, dt: number): void {
    // Car: position on the plane, yaw to face the heading (group), bank into the turn
    // (chassis only, so the wheels-on-ground read stays). rotation.y = -heading aligns
    // the mesh's forward (-z) with the movement direction (sin h, -cos h).
    this.car.group.position.set(v.x, ZEN.groundY, v.z);
    this.car.group.rotation.y = -v.heading;
    this.car.chassis.rotation.z = -clamp(steer, -1, 1) * ZEN.leanMax;

    // Grid: recentre on the car snapped to a cell → seamless infinite plane.
    this.grid.position.x = Math.round(v.x / this.cell) * this.cell;
    this.grid.position.z = Math.round(v.z / this.cell) * this.cell;

    // Chase camera: target sits BEHIND the car along its facing, raised; ease toward
    // it (smoothFollow) so turns feel like a gliding swing, not a snap. Always look at
    // the car. Behind = opposite the movement dir (sin h, -cos h) → (-sin h, +cos h).
    const tx = v.x - Math.sin(v.heading) * ZEN.camDistance;
    const tz = v.z + Math.cos(v.heading) * ZEN.camDistance;
    const f = smoothFollow(ZEN.camPosLerp, dt);
    this.camera.position.x += (tx - this.camera.position.x) * f;
    this.camera.position.z += (tz - this.camera.position.z) * f;
    this.camera.position.y += (ZEN.camHeight - this.camera.position.y) * f;
    this.camera.lookAt(v.x, ZEN.camLookAtHeight, v.z);

    this.resize(); // cheap aspect check (updates only on a real size change)
    this.renderer.render(this.scene, this.camera);
  }

  /** Keep the camera aspect in sync with the (shared) renderer's drawing buffer. */
  private resize(): void {
    const size = this.renderer.getSize(_tmpSize);
    const a = size.x / Math.max(1, size.y);
    if (a !== this.aspect) {
      this.aspect = a;
      this.camera.aspect = a;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Free the Zen-owned geometry/materials (the shared renderer is NOT disposed). */
  dispose(): void {
    this.scene.remove(this.car.group);
    this.car.dispose();
    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
  }
}

// Reused scratch vector for the aspect check (no per-frame allocation).
const _tmpSize = new THREE.Vector2();
