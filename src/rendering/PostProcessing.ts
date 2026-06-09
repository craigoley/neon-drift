/**
 * Post-processing: synthwave bloom + a cinematic finishing pass.
 *
 * Verified chain (against three 0.184.0 source) — order MUST be:
 *   RenderPass -> UnrealBloomPass -> [cinematic ShaderPass] -> OutputPass.
 *   - Bloom comes BEFORE grading/FX.
 *   - The cinematic pass (chromatic aberration + scanlines + grain + vignette) is
 *     ONE custom ShaderPass, inserted after bloom and before OutputPass.
 *   - OutputPass is LAST; it reads renderer.toneMapping / outputColorSpace /
 *     toneMappingExposure (set in SceneManager) and applies tone mapping + the
 *     sRGB transfer, so the cinematic pass must NOT do gamma itself.
 *   - HIGH quality: render via composer.render() (bloom + cinematic + tone map).
 *   - LOW quality: bypass the composer entirely and render via renderer.render()
 *     (tone mapping + sRGB still apply from SceneManager; bloom/cinematic skipped).
 *
 * Performance: the four cinematic effects are combined into ONE fullscreen pass
 * (many separate passes tank mobile FPS). On touch, the bloom runs at reduced
 * internal resolution AND the aberration/scanline/grain intensities scale down.
 * The whole cinematic pass can also be disabled at runtime (the "Retro FX"
 * setting) for a guaranteed-cheap fallback.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BLOOM, POSTFX } from '../utils/constants';

/** The combined cinematic shader (aberration + scanlines + grain + vignette). */
const CINEMATIC_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAberration: { value: POSTFX.aberration },
    uScanlineIntensity: { value: POSTFX.scanlineIntensity },
    uScanlineCount: { value: POSTFX.scanlineCount },
    uScanlineDrift: { value: POSTFX.scanlineDrift },
    uGrain: { value: POSTFX.grain },
    uVignette: { value: POSTFX.vignette },
    uVignetteStart: { value: POSTFX.vignetteStart },
    uVignetteEnd: { value: POSTFX.vignetteEnd },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uAberration, uScanlineIntensity, uScanlineCount, uScanlineDrift;
    uniform float uGrain, uVignette, uVignetteStart, uVignetteEnd;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

    void main() {
      vec2 center = vUv - 0.5;
      float dist = length(center);

      // Chromatic aberration: split R/B outward, growing with dist² — 0 at the
      // centre, strongest at the edges, so the playfield middle stays crisp.
      vec2 off = center * (uAberration * dist * dist);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;

      // Scanlines: a subtle, slowly-drifting darkening of alternate rows.
      float line = vUv.y * uScanlineCount - uTime * uScanlineDrift;
      float sl = 0.5 + 0.5 * sin(line * 6.2831853);
      col *= 1.0 - uScanlineIntensity * (1.0 - sl);

      // Film/VHS grain: per-pixel time-varying noise, ±uGrain/2 (additive).
      float g = hash(vUv * uResolution + fract(uTime) * 137.0);
      col += (g - 0.5) * uGrain;

      // Vignette: darken the corners (also focuses the centre for readability).
      col *= 1.0 - uVignette * smoothstep(uVignetteStart, uVignetteEnd, dist);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostProcessing {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly cinematic: ShaderPass;
  private readonly resScale: number;
  /** HIGH = full pipeline (bloom + cinematic via the composer). LOW = render direct
   *  (skip the composer entirely → no bloom, no cinematic, no render-target round-trip)
   *  — the real perf escape hatch for weak GPUs. */
  private highQuality = true;
  private elapsed = 0;
  /** Baseline chromatic-aberration (after any touch scaling) + a transient pulse
   *  added on top by a tier-3 near-miss, decaying back to the baseline. */
  private aberrationBase = 0;
  private aberrationPulse = 0;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    isTouch: boolean,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    // Half-resolution BLOOM target on ALL devices (was touch-only). Bloom is the #1
    // GPU cost and it's a blur, so a half-res blur buffer is visually ~identical at
    // ~¼ the cost — making HIGH itself cheaper. The scene + HUD stay full-resolution
    // (composer.setSize/setPixelRatio below); only the bloom pass's buffer is scaled.
    this.resScale = BLOOM.resolutionScale;
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
    // corner wedge). resolutionScale still trims it for GPU headroom, but
    // proportionally to the actual framebuffer so the kernel stays aligned.
    this.bloom = new UnrealBloomPass(
      this.bloomResolution(w, h),
      BLOOM.strength,
      BLOOM.radius,
      BLOOM.threshold,
    );
    this.composer.addPass(this.bloom);

    // Cinematic FX — ONE pass, after bloom, before OutputPass. On touch the
    // aberration/scanline/grain are dialled down (vignette stays — cheap + helps
    // readability).
    this.cinematic = new ShaderPass(CINEMATIC_SHADER);
    if (isTouch) {
      const u = this.cinematic.uniforms;
      u.uAberration.value *= POSTFX.touchScale;
      u.uScanlineIntensity.value *= POSTFX.touchScale;
      u.uGrain.value *= POSTFX.touchScale;
    }
    this.setResolutionUniform(w, h);
    this.composer.addPass(this.cinematic);

    // OutputPass must be last (tone mapping + sRGB conversion).
    this.composer.addPass(new OutputPass());

    // Capture the effective baseline AFTER any touch scaling — the near-miss
    // pulse is added on top of this and decays back to it.
    this.aberrationBase = this.cinematic.uniforms.uAberration.value as number;
  }

  /** NEAR-MISS CRESCENDO (tier-3 only): add a brief chromatic-aberration pulse on
   *  top of the baseline; it decays back in render(). Conservative by design —
   *  see POSTFX.aberrationPulsePeak. No-op while the cinematic pass is disabled. */
  pulseAberration(peak: number): void {
    this.aberrationPulse = Math.max(this.aberrationPulse, peak);
  }

  /** Bloom internal-buffer size: device pixels (CSS * pixelRatio) * resScale. */
  private bloomResolution(width: number, height: number): THREE.Vector2 {
    const pr = this.renderer.getPixelRatio();
    return new THREE.Vector2(
      Math.max(1, Math.round(width * pr * this.resScale)),
      Math.max(1, Math.round(height * pr * this.resScale)),
    );
  }

  private setResolutionUniform(width: number, height: number): void {
    const pr = this.renderer.getPixelRatio();
    (this.cinematic.uniforms.uResolution.value as THREE.Vector2).set(width * pr, height * pr);
  }

  /**
   * Graphics quality — the "Retro FX" HIGH/LOW lever.
   *   HIGH: the full composer pipeline (bloom glow + cinematic grade).
   *   LOW:  render DIRECT — bypass the composer entirely, so the expensive bloom
   *         (5 down/up blur passes) AND the cinematic pass AND the render-target
   *         round-trip are all skipped. The renderer still applies ACES tone mapping
   *         + sRGB (set in SceneManager), so colour matches HIGH minus the glow.
   * This is the genuine perf escape hatch: LOW is a much cheaper frame, not a dimmed
   * one. (Disabling the passes too keeps state consistent if anything re-enters HIGH.)
   */
  setQuality(high: boolean): void {
    this.highQuality = high;
    this.bloom.enabled = high;
    this.cinematic.enabled = high;
  }

  /** `dt` (seconds) advances the grain/scanline animation. The clock WRAPS at
   *  POSTFX.timeWrap so it never grows large enough to lose float precision in
   *  the shader (which would make the grain/scanlines shimmer or freeze in a
   *  long session); the wrap is seamless for the periodic sin/fract terms. */
  render(dt = 0): void {
    if (!this.highQuality) {
      // LOW: direct render — no composer, no bloom, no cinematic, no render target.
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.cinematic.enabled) {
      this.elapsed = (this.elapsed + dt) % POSTFX.timeWrap;
      this.cinematic.uniforms.uTime.value = this.elapsed;
      // Decay the near-miss aberration pulse and lay it over the baseline.
      if (this.aberrationPulse > 0) {
        this.aberrationPulse = Math.max(0, this.aberrationPulse - POSTFX.aberrationPulseDecay * dt * this.aberrationPulse);
      }
      this.cinematic.uniforms.uAberration.value = this.aberrationBase + this.aberrationPulse;
    }
    this.composer.render();
  }

  setSize(width: number, height: number): void {
    // Re-sync ALL passes on resize (and on DPR changes): renderer (done by the
    // caller via SceneManager.resize), composer pixel ratio + size, the bloom
    // resolution, and the cinematic shader's pixel resolution.
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    const res = this.bloomResolution(width, height);
    this.bloom.setSize(res.x, res.y);
    this.setResolutionUniform(width, height);
  }
}
