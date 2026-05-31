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
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly resScale: number;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    isTouch: boolean,
  ) {
    this.resScale = isTouch ? BLOOM.mobileResolutionScale : 1;
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(w, h);

    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(w * this.resScale, h * this.resScale),
      BLOOM.strength,
      BLOOM.radius,
      BLOOM.threshold,
    );
    this.composer.addPass(this.bloom);

    // OutputPass must be last (tone mapping + sRGB conversion).
    this.composer.addPass(new OutputPass());
  }

  render(): void {
    this.composer.render();
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.bloom.setSize(width * this.resScale, height * this.resScale);
  }
}
