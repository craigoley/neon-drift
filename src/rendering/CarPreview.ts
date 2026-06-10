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
import { CAR_VIS, JUICE, RENDER, UI, type CarDef } from '../utils/constants';
import { CarMesh } from './CarMesh';

export class CarPreview {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly car: CarMesh;
  /** A static glowing streak behind the car standing in for the TRAIL cosmetic (the
   *  car doesn't move in the menu, so the trail is shown as a colour streak). */
  private readonly trailStreak: THREE.Mesh;
  private readonly trailMat: THREE.MeshBasicMaterial;
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

    // TRAIL streak: a flat additive plane behind the car, coloured by the trail
    // cosmetic (default cyan = the in-game default, so it's WYSIWYG). Added to the
    // car group so it shares the preview tilt but does NOT spin (only the chassis
    // spins). Defaults to the in-game trail colour.
    this.trailMat = new THREE.MeshBasicMaterial({
      color: JUICE.trailColor,
      transparent: true,
      opacity: UI.storeTrailOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const tw = CAR_VIS.width * UI.storeTrailWidthMul;
    const tl = CAR_VIS.length * UI.storeTrailLengthMul;
    this.trailStreak = new THREE.Mesh(new THREE.PlaneGeometry(tw, tl), this.trailMat);
    this.trailStreak.rotation.x = -Math.PI / 2; // lie flat on the ground
    this.trailStreak.position.z = CAR_VIS.length * UI.storeTrailOffsetMul; // behind the car
    this.trailStreak.position.y = 0.02;
    this.car.group.add(this.trailStreak);

    this.resize();
    window.addEventListener('resize', this.onResize);
    this.loop();
  }

  /** Show a car's cosmetic colours (body + neon glow + accent). */
  setCar(car: CarDef): void {
    this.car.applyCar(car);
  }

  /** Apply a GLOW cosmetic override to the previewed car (null = the car's own glow).
   *  Drives the SAME CarMesh override the in-game car uses — WYSIWYG. */
  setGlow(hex: number | null): void {
    this.car.setGlowOverride(hex);
  }

  /** Colour the TRAIL streak (null = the in-game default cyan). */
  setTrail(hex: number | null): void {
    this.trailMat.color.setHex(hex ?? JUICE.trailColor);
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
    this.trailStreak.geometry.dispose();
    this.trailMat.dispose();
    this.car.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
