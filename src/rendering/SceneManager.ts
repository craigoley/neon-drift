/**
 * Owns the three.js scene, chase camera and WebGL renderer. The only place the
 * renderer is constructed. Reads game state to position the camera; never
 * mutates the simulation.
 *
 * Tone mapping is set on the renderer here (ACES Filmic + exposure) so the
 * OutputPass at the end of the post-processing chain reads and applies it — see
 * the Step 1 findings in PostProcessing.ts.
 */

import * as THREE from 'three';
import type { GameState } from '../game/GameState';
import { normalizedSpeed } from '../game/Vehicle';
import { smoothFollow } from '../utils/math';
import { BLOOM, CAMERA, FOG, PALETTE, RENDER } from '../utils/constants';

export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly isTouch: boolean;

  /** Transient camera shake offset (set by the juice layer on crash). */
  readonly shake = new THREE.Vector3();

  constructor(parent: HTMLElement, isTouch: boolean) {
    this.isTouch = isTouch;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.deepPurple);
    // Exponential fog hides the segment spawn horizon — road never pops in.
    this.scene.fog = new THREE.FogExp2(PALETTE.deepPurple, FOG.density);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fov,
      window.innerWidth / window.innerHeight,
      CAMERA.near,
      CAMERA.far,
    );
    this.camera.position.set(0, CAMERA.offsetUp, CAMERA.offsetBehind);
    this.camera.lookAt(0, 0, -CAMERA.lookAhead);

    this.renderer = new THREE.WebGLRenderer({ antialias: !isTouch, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, isTouch ? RENDER.maxPixelRatioTouch : RENDER.maxPixelRatio),
    );
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Read by OutputPass to apply tone mapping at the end of the bloom chain.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = BLOOM.exposure;
    parent.appendChild(this.renderer.domElement);
  }

  /**
   * Follow the car: lerp the camera laterally toward the player, widen FOV with
   * speed, and apply any transient shake. The car sits at world z = 0; objects
   * ahead are rendered at negative z (see the renderers).
   */
  updateCamera(game: GameState, dt: number): void {
    const follow = smoothFollow(CAMERA.followLerp, dt);
    const targetX = game.vehicle.lateral;
    this.camera.position.x += (targetX - this.camera.position.x) * follow;
    this.camera.position.y = CAMERA.offsetUp + this.shake.y;
    this.camera.position.z = CAMERA.offsetBehind;

    const targetFov = CAMERA.fov + CAMERA.fovSpeedBoost * normalizedSpeed(game.vehicle.speed);
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * follow;
      this.camera.updateProjectionMatrix();
    }

    this.camera.lookAt(targetX + this.shake.x, this.shake.y, -CAMERA.lookAhead);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
