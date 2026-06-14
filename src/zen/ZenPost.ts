/**
 * ZEN POST — the bloom pass that makes Zen's neon GLOW (the fix for "the reward never showed":
 * everything was 1px unlit lines, so the landmark flash + structures + grid rendered but read as
 * thin dim lines). Reuses the racing post recipe (rendering/PostProcessing.ts) but BLOOM-ONLY —
 * no cinematic grade — because Zen is about calm/serenity, not the racing adrenaline FX.
 *
 * Chain (order matters, verified against the racing pass): RenderPass → UnrealBloomPass → OutputPass.
 * OutputPass is LAST and applies the renderer's tone mapping + sRGB (set on the shared renderer by
 * SceneManager), so colours match a direct render, plus the glow.
 *
 * MOBILE-SAFE PERF (the hard gate): the bloom blur target runs at HALF resolution on ALL devices —
 * racing #95-98 measured half-res bloom ≈ free while full-res is the GPU killer. The LOW quality
 * tier (setQuality(false)) BYPASSES the composer entirely (a plain renderer.render) — a guaranteed-
 * cheap escape hatch identical to the racing LOW path. (A WebGL frame can't be profiled headlessly,
 * so this inherits racing's on-device measurement rather than fabricating a number.)
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ZEN_BLOOM } from '../utils/constants';

export class ZenPost {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  /** HIGH = bloom via the composer; LOW = direct render (no composer, no bloom — the cheap path). */
  private highQuality = true;

  constructor(scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);

    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(
      this.bloomResolution(size.x, size.y),
      ZEN_BLOOM.strength,
      ZEN_BLOOM.radius,
      ZEN_BLOOM.threshold,
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  /** Quality lever: HIGH = bloom; LOW = direct render (bypass the composer entirely). */
  setQuality(high: boolean): void {
    this.highQuality = high;
    this.bloom.enabled = high;
  }

  /** Draw the Zen scene — through the bloom composer on HIGH, direct on LOW. */
  render(): void {
    if (this.highQuality) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Re-sync the composer + bloom buffer on a drawing-buffer size change. */
  setSize(width: number, height: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    const res = this.bloomResolution(width, height);
    this.bloom.setSize(res.x, res.y);
  }

  /** Bloom internal-buffer size: device pixels (CSS × pixelRatio) × the half-res scale. */
  private bloomResolution(width: number, height: number): THREE.Vector2 {
    const pr = this.renderer.getPixelRatio();
    return new THREE.Vector2(
      Math.max(1, Math.round(width * pr * ZEN_BLOOM.resolutionScale)),
      Math.max(1, Math.round(height * pr * ZEN_BLOOM.resolutionScale)),
    );
  }

  dispose(): void {
    this.composer.dispose();
  }
}
