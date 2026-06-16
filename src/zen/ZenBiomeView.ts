/**
 * ZEN FREE-ROAM biome APPLY — pushes the pure ZenBiomeState (from ZenBiome.biomeAt) to
 * the scene's LOOK: scene fog, the backdrop (sky + sun + mountains), the star dome, and
 * the prop tint. Three.js layer — READS the pure state, never mutates it. The free-roam
 * analogue of rendering/BiomeView.ts, reimplemented against Zen's own surfaces (Zen's sky
 * is a repainted CanvasTexture, not a flat background Color; stars are a dome; there is no
 * traffic) — so it's a sibling, not a reuse, of the racing view.
 *
 * Cost control mirrors the racing view: the blended palette is re-applied only when the
 * biome meaningfully changes (a from/to switch, or blend advancing past
 * ZEN_BIOME.repaintBlendStep), so the sky+sun canvas repaints fire a bounded number of
 * times per transition and ZERO at rest. All colour work blends via the pure mixHex into
 * reused scratch — no per-apply allocation (a step allocates only the two CanvasGradients
 * inside the backdrop repaint).
 *
 * NOTE: the TERRAIN grid floor is NOT driven here — it samples biomeAt PER VERTEX itself
 * (ZenTerrain) so the grid colour varies across space (you see the next region's colour
 * approaching), whereas this view sets the AMBIENT look from the biome at the CAR.
 */

import * as THREE from 'three';
import { ZEN_BIOMES, ZEN_BIOME, ZEN_SECRET_BIOME, ZEN_TUNNEL_SECRET_BIOME, cssHex, type BiomeDef } from '../utils/constants';
import { lerp, mixHex } from '../utils/math';
import type { ZenBiomeState } from './ZenBiome';
import type { ZenBackdrop } from './ZenBackdrop';
import type { ZenStarfield } from './ZenStarfield';
import type { ZenScenery } from './ZenScenery';

/** Sentinel `lastFrom` marking that the SECRET palette is currently applied — distinct from any
 *  real biome index (0..n) and the initial -1, so the next normal apply() detects the change. */
const SECRET_APPLIED = -2;
/** Sentinel for the TUNNEL-PAYOFF palette (distinct from SECRET_APPLIED so switching between the two
 *  forced palettes — or back to a real biome — always repaints). */
const TUNNEL_SECRET_APPLIED = -3;

export class ZenBiomeView {
  private readonly scene: THREE.Scene;
  private readonly backdrop: ZenBackdrop;
  private readonly stars: ZenStarfield;
  private readonly scenery: ZenScenery;

  /** Per-biome sun gradient colours pre-parsed to ints once (strings → numbers). */
  private readonly gradHex: number[][];
  /** Secret-area sun gradient pre-parsed to ints (the forced secret palette). */
  private readonly secretGrad: number[];
  /** Tunnel-payoff sun gradient pre-parsed to ints (the forced deep-amber palette). */
  private readonly tunnelGrad: number[];

  // Reused scratch — no per-apply allocation.
  private readonly stops: { at: number; color: string }[];
  private readonly cFog = new THREE.Color();
  private readonly cTint = new THREE.Color();

  // Last applied biome, to throttle re-application.
  private lastFrom = -1;
  private lastTo = -1;
  private lastBlend = -1;

  constructor(scene: THREE.Scene, backdrop: ZenBackdrop, stars: ZenStarfield, scenery: ZenScenery) {
    this.scene = scene;
    this.backdrop = backdrop;
    this.stars = stars;
    this.scenery = scenery;
    this.gradHex = ZEN_BIOMES.map((b) => b.gradient.map((s) => parseInt(s.color.slice(1), 16)));
    this.secretGrad = ZEN_SECRET_BIOME.gradient.map((s) => parseInt(s.color.slice(1), 16));
    this.tunnelGrad = ZEN_TUNNEL_SECRET_BIOME.gradient.map((s) => parseInt(s.color.slice(1), 16));
    // Scratch stops mirror biome 0's `at` positions (shared across all biomes).
    this.stops = ZEN_BIOMES[0].gradient.map((s) => ({ at: s.at, color: s.color }));
  }

  /** Blend + apply the palette for the given biome state (throttled). */
  apply(biome: ZenBiomeState): void {
    const changed =
      biome.from !== this.lastFrom ||
      biome.to !== this.lastTo ||
      Math.abs(biome.blend - this.lastBlend) >= ZEN_BIOME.repaintBlendStep;
    if (!changed) return;
    this.paint(ZEN_BIOMES[biome.from], ZEN_BIOMES[biome.to], biome.blend, this.gradHex[biome.from], this.gradHex[biome.to]);
    this.lastFrom = biome.from;
    this.lastTo = biome.to;
    this.lastBlend = biome.blend;
  }

  /** Force the SECRET-area palette (a single def, no blend) while inside a secret area. Throttled:
   *  repaints once on entering secret; the next normal apply() detects the change and resumes. */
  applySecret(): void {
    if (this.lastFrom === SECRET_APPLIED) return;
    this.paint(ZEN_SECRET_BIOME, ZEN_SECRET_BIOME, 0, this.secretGrad, this.secretGrad);
    this.lastFrom = SECRET_APPLIED;
    this.lastTo = SECRET_APPLIED;
    this.lastBlend = 0;
  }

  /** Force the TUNNEL-PAYOFF palette (the deep-amber void) while inside the tunnel bottom space.
   *  Throttled like applySecret: repaints once on entering; the next apply()/applySecret() resumes. */
  applyTunnelSecret(): void {
    if (this.lastFrom === TUNNEL_SECRET_APPLIED) return;
    this.paint(ZEN_TUNNEL_SECRET_BIOME, ZEN_TUNNEL_SECRET_BIOME, 0, this.tunnelGrad, this.tunnelGrad);
    this.lastFrom = TUNNEL_SECRET_APPLIED;
    this.lastTo = TUNNEL_SECRET_APPLIED;
    this.lastBlend = 0;
  }

  /** Paint the scene to a blended palette (a → b by t): sun gradient, fog/sky, star dome, prop tint. */
  private paint(a: BiomeDef, b: BiomeDef, t: number, ga: number[], gb: number[]): void {
    // Blended sun gradient (top → base) for the retrosun repaint.
    for (let i = 0; i < this.stops.length; i++) {
      this.stops[i].color = cssHex(mixHex(ga[i], gb[i], t));
    }
    // Fog/horizon = blended biome fog; the sky's top is a darker shade of it, so each
    // biome gets a natural overhead-dark → horizon-lit sky derived from one colour.
    const fog = mixHex(a.fog, b.fog, t);
    const skyTop = mixHex(fog, 0x000000, ZEN_BIOME.skyTopDarken);
    const mountain = mixHex(a.mountain, b.mountain, t);

    this.cFog.setHex(fog);
    if (this.scene.fog) this.scene.fog.color.copy(this.cFog);

    this.backdrop.setPalette(this.stops, skyTop, fog, mountain);

    // Star dome brightness (Midnight full → Sunset none).
    this.stars.setIntensity(lerp(a.starIntensity, b.starIntensity, t));

    // Faint biome cast on the props: near-white nudged toward the biome accent.
    const accent = mixHex(a.accent, b.accent, t);
    this.cTint.setHex(mixHex(0xffffff, accent, ZEN_BIOME.accentTintStrength));
    this.scenery.setTint(this.cTint);
  }
}
