/**
 * Car-picker 3D preview: a single rotating car mesh in its own LIGHT renderer +
 * scene, mounted in a canvas inside the picker overlay. Deliberately NOT the
 * full game pipeline — no EffectComposer/bloom (wasteful + fragile for a menu).
 * Just renderer.render(scene, camera) showing the SAME procedural car as in-game
 * (CarMesh; its MeshBasicMaterials need no lights).
 *
 * Owns a private rAF loop that runs ONLY while the picker is open; dispose()
 * cancels it and frees the GL context + the CarMesh geometry/materials so
 * nothing leaks or keeps rendering behind the game.
 */

import * as THREE from 'three';
import { CAR_VIS, RENDER, UI, type CarDef } from '../utils/constants';
import { CarMesh } from './CarMesh';

export class CarPreview {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly car: CarMesh;
  // Timer (replaces the deprecated Clock). Unlike Clock, Timer must be update()'d
  // once per frame BEFORE getDelta() — an un-updated Timer returns 0. No-arg
  // update() uses performance.now() internally, exactly as Clock.getDelta() did,
  // so the spin speed is unchanged. (We deliberately don't call connect(document):
  // that would add Page-Visibility delta-clamping, a behaviour change beyond this
  // Clock→Timer swap.)
  private readonly timer = new THREE.Timer();
  private raf = 0;
  private readonly onResize = () => this.resize();

  constructor(container: HTMLElement, car?: CarDef) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(UI.carPreviewFov, 1, UI.carPreviewNear, UI.carPreviewFar);
    this.camera.position.set(0, CAR_VIS.height * UI.carPreviewCamHeightMul, UI.carPreviewCamZ);
    this.camera.lookAt(0, CAR_VIS.height * UI.carPreviewLookAtMul, 0);

    this.car = new CarMesh(car);
    // A slight fixed tilt so the rotation reads as 3D (see top + side + front).
    this.car.group.rotation.x = UI.carPreviewTilt;
    this.scene.add(this.car.group);

    this.resize();
    window.addEventListener('resize', this.onResize);
    this.loop();
  }

  /** Show a car's cosmetic colours (body + neon glow + accent). */
  setCar(car: CarDef): void {
    this.car.applyCar(car);
  }

  private loop = (): void => {
    // Advance the timer once this frame, then read the delta (Timer requires the
    // update() before getDelta(), unlike the old Clock).
    this.timer.update();
    // Spin the chassis only, so the ground-glow blob stays flat under the car.
    this.car.chassis.rotation.y += UI.carPreviewSpinPerSec * this.timer.getDelta();
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  };

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Stop the loop and free everything — call when leaving the picker. */
  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.car.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
