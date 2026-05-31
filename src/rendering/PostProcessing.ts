/**
 * Post-processing seam for the synthwave bloom/glow look.
 *
 * SCAFFOLD STUB: this establishes the architectural seam without committing to
 * an effect chain yet. Today it renders straight through the SceneManager. When
 * gameplay lands, this is where an EffectComposer + UnrealBloomPass
 * (`three/addons/postprocessing/...`) will be wired so the neon geometry glows.
 */

import type { SceneManager } from './SceneManager';

export class PostProcessing {
  private readonly sceneManager: SceneManager;

  constructor(sceneManager: SceneManager) {
    this.sceneManager = sceneManager;
  }

  /** Render one frame. Currently a straight passthrough; bloom comes later. */
  render(): void {
    this.sceneManager.render();
  }

  /** Keep effect buffers in sync with the viewport. No-op until bloom exists. */
  resize(_width: number, _height: number): void {
    // Intentionally empty until the EffectComposer is added.
  }
}
