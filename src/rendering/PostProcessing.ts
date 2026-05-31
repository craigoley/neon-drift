/**
 * Bloom post-processing for the synthwave neon glow.
 *
 * Step 1 findings (verified against three 0.184.0 source):
 *   - Chain order MUST be RenderPass -> UnrealBloomPass -> OutputPass.
 *   - OutputPass is LAST; it reads renderer.toneMapping / outputColorSpace /
 *     toneMappingExposure (set in SceneManager) and applies tone mapping + the
 *     sRGB transfer. Omitting it writes the linear composer result straight to
 *     the sRGB framebuffer -> washed-out colours.
 *   - Render via composer.render(), NEVER renderer.render().
 * On touch devices the bloom pass runs at a reduced internal resolution for GPU
 * headroom (the composer itself stays at full resolution).
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BLOOM } from '../utils/constants';

export class PostProcessing {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly resScale: number;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    isTouch: boolean,
  ) {
    this.renderer = renderer;
    this.resScale = isTouch ? BLOOM.mobileResolutionScale : 1;
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(w, h);

    this.composer.addPass(new RenderPass(scene, camera));

    // Size the bloom from the DEVICE resolution (CSS px * pixelRatio), not raw
    // CSS px. The composer renders at device resolution, so a CSS-px-sized bloom
    // buffer is undersized on any DPR>1 screen — its coarse blur then smears
    // bright neon along the screen edges/corners (the cyan edge glow + orange
    // corner wedge). mobileResolutionScale still trims it for GPU headroom, but
    // proportionally to the actual framebuffer so the kernel stays aligned.
    this.bloom = new UnrealBloomPass(
      this.bloomResolution(w, h),
      BLOOM.strength,
      BLOOM.radius,
      BLOOM.threshold,
    );
    this.composer.addPass(this.bloom);

    // OutputPass must be last (tone mapping + sRGB conversion).
    this.composer.addPass(new OutputPass());
  }

  /** Bloom internal-buffer size: device pixels (CSS * pixelRatio) * resScale. */
  private bloomResolution(width: number, height: number): THREE.Vector2 {
    const pr = this.renderer.getPixelRatio();
    return new THREE.Vector2(
      Math.max(1, Math.round(width * pr * this.resScale)),
      Math.max(1, Math.round(height * pr * this.resScale)),
    );
  }

  render(): void {
    this.composer.render();
  }

  setSize(width: number, height: number): void {
    // Re-sync ALL three on resize (and on DPR changes): renderer (done by the
    // caller via SceneManager.resize), composer pixel ratio + size, and the
    // bloom resolution — kept proportional to the device framebuffer.
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    const res = this.bloomResolution(width, height);
    this.bloom.setSize(res.x, res.y);
  }
}
