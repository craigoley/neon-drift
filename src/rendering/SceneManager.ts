/**
 * Owns the three.js scene, camera and WebGL renderer. This is the only place
 * that constructs the renderer; every other rendering module is handed the
 * scene to add objects to.
 *
 * Part of the rendering layer: it may read game state but must never mutate it.
 */

import * as THREE from 'three';
import { CAMERA, PALETTE } from '../utils/constants';

export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  constructor(canvasParent: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.deepPurple);
    this.scene.fog = new THREE.Fog(PALETTE.deepPurple, 40, 200);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fov,
      window.innerWidth / window.innerHeight,
      CAMERA.near,
      CAMERA.far,
    );
    this.camera.position.set(CAMERA.position.x, CAMERA.position.y, CAMERA.position.z);
    this.camera.lookAt(CAMERA.lookAt.x, CAMERA.lookAt.y, CAMERA.lookAt.z);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    canvasParent.appendChild(this.renderer.domElement);
  }

  /** Render one frame of the current scene. */
  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Keep the camera aspect and drawing buffer in sync with the viewport. */
  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /** Release GPU resources. */
  dispose(): void {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
