/**
 * Car-picker 3D preview: a single rotating car mesh in its own LIGHT renderer +
 * scene, mounted in a canvas inside the picker overlay. Deliberately NOT the
 * full game pipeline — no EffectComposer/bloom (wasteful + fragile for a menu).
 * Just renderer.render(scene, camera) with the same unlit body + neon edge look
 * as the in-game car (MeshBasicMaterial needs no lights).
 *
 * Owns a private rAF loop that runs ONLY while the picker is open; dispose()
 * cancels it and frees the GL context + geometry/materials so nothing leaks or
 * keeps rendering behind the game.
 */

import * as THREE from 'three';
import { CAR_VIS, PALETTE, RENDER, UI, type CarDef } from '../utils/constants';

export class CarPreview {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly carGroup = new THREE.Group();
  private readonly bodyGeo: THREE.BoxGeometry;
  private readonly edgesGeo: THREE.EdgesGeometry;
  private readonly bodyMat: THREE.MeshBasicMaterial;
  private readonly edgesMat: THREE.LineBasicMaterial;
  private readonly clock = new THREE.Clock();
  private raf = 0;
  private readonly onResize = () => this.resize();

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(UI.carPreviewFov, 1, UI.carPreviewNear, UI.carPreviewFar);
    this.camera.position.set(0, CAR_VIS.height * UI.carPreviewCamHeightMul, UI.carPreviewCamZ);
    this.camera.lookAt(0, CAR_VIS.height * UI.carPreviewLookAtMul, 0);

    const { width, height, length } = CAR_VIS;
    this.bodyGeo = new THREE.BoxGeometry(width, height, length);
    this.bodyMat = new THREE.MeshBasicMaterial({ color: PALETTE.deepPurple });
    const body = new THREE.Mesh(this.bodyGeo, this.bodyMat);
    body.position.y = height / 2;

    const tmp = new THREE.BoxGeometry(width, height, length);
    this.edgesGeo = new THREE.EdgesGeometry(tmp);
    tmp.dispose();
    this.edgesMat = new THREE.LineBasicMaterial({ color: PALETTE.cyan });
    const edges = new THREE.LineSegments(this.edgesGeo, this.edgesMat);
    edges.position.y = height / 2;

    this.carGroup.add(body, edges);
    // A slight fixed tilt so the rotation reads as 3D (see top + side + front).
    this.carGroup.rotation.x = UI.carPreviewTilt;
    this.scene.add(this.carGroup);

    this.resize();
    window.addEventListener('resize', this.onResize);
    this.loop();
  }

  /** Show a car's cosmetic colours (body + neon glow). */
  setCar(car: CarDef): void {
    this.bodyMat.color.setHex(car.cosmetic.body);
    this.edgesMat.color.setHex(car.cosmetic.glow);
  }

  private loop = (): void => {
    this.carGroup.rotation.y += UI.carPreviewSpinPerSec * this.clock.getDelta();
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
    this.bodyGeo.dispose();
    this.edgesGeo.dispose();
    this.bodyMat.dispose();
    this.edgesMat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
