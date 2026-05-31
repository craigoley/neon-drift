/**
 * Applies the pure BiomeState to the scene: lerps the current → next biome
 * palette by `blend` and pushes it to the environment (sun gradient, grid,
 * mountains) + scene fog/background. Three.js layer — READS game state, never
 * mutates it.
 *
 * Cost control: the blended palette is re-applied only when the biome
 * meaningfully changes (a `from`/`to` switch, or `blend` advancing past
 * BIOME_CYCLE.repaintBlendStep), so the sun-texture repaint fires a bounded
 * number of times per transition and ZERO times at rest. All colour work uses
 * the pure `mixHex` blend into reused scratch objects — no per-frame allocation
 * (a transition step allocates only a CanvasGradient inside Environment).
 */

import * as THREE from 'three';
import type { BiomeState } from '../game/Biome';
import type { Environment } from './Environment';
import type { Starfield } from './Starfield';
import type { TrafficRenderer } from './TrafficRenderer';
import { BIOMES, BIOME_CYCLE, cssHex } from '../utils/constants';
import { lerp, mixHex } from '../utils/math';

export class BiomeView {
  private readonly scene: THREE.Scene;
  private readonly env: Environment;
  private readonly stars: Starfield;
  private readonly traffic: TrafficRenderer;

  // Per-biome colours pre-parsed to integers once (gradient strings → numbers).
  private readonly gradHex: number[][];

  // Reused scratch — no per-apply allocation.
  private readonly stops: { at: number; color: string }[];
  private readonly cGridCenter = new THREE.Color();
  private readonly cGridLine = new THREE.Color();
  private readonly cMountain = new THREE.Color();
  private readonly cFog = new THREE.Color();
  private readonly cTrafficTint = new THREE.Color();

  // Last applied biome, to throttle re-application.
  private lastFrom = -1;
  private lastTo = -1;
  private lastBlend = -1;

  constructor(scene: THREE.Scene, env: Environment, stars: Starfield, traffic: TrafficRenderer) {
    this.scene = scene;
    this.env = env;
    this.stars = stars;
    this.traffic = traffic;
    this.gradHex = BIOMES.map((b) => b.gradient.map((s) => parseInt(s.color.slice(1), 16)));
    // Scratch stops mirror biome 0's `at` positions (shared across all biomes).
    this.stops = BIOMES[0].gradient.map((s) => ({ at: s.at, color: s.color }));
  }

  /** Blend + apply the palette for the given biome state (throttled). */
  apply(biome: BiomeState): void {
    const changed =
      biome.from !== this.lastFrom ||
      biome.to !== this.lastTo ||
      Math.abs(biome.blend - this.lastBlend) >= BIOME_CYCLE.repaintBlendStep;
    if (!changed) return;

    const a = BIOMES[biome.from];
    const b = BIOMES[biome.to];
    const t = biome.blend;
    const ga = this.gradHex[biome.from];
    const gb = this.gradHex[biome.to];

    for (let i = 0; i < this.stops.length; i++) {
      this.stops[i].color = cssHex(mixHex(ga[i], gb[i], t));
    }
    this.cGridCenter.setHex(mixHex(a.gridCenter, b.gridCenter, t));
    this.cGridLine.setHex(mixHex(a.gridLine, b.gridLine, t));
    this.cMountain.setHex(mixHex(a.mountain, b.mountain, t));
    this.cFog.setHex(mixHex(a.fog, b.fog, t));

    this.env.setPalette(this.stops, this.cGridCenter, this.cGridLine, this.cMountain);
    if (this.scene.fog) this.scene.fog.color.copy(this.cFog);
    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(this.cFog);

    // Star-field brightness (Midnight full → Sunset none).
    this.stars.setIntensity(lerp(a.starIntensity, b.starIntensity, t));

    // Faint biome cast on the traffic: mostly white, nudged toward the biome
    // accent by accentTintStrength — threats stay orange/red, ramps green.
    const accent = mixHex(a.accent, b.accent, t);
    this.cTrafficTint.setHex(mixHex(0xffffff, accent, BIOME_CYCLE.accentTintStrength));
    this.traffic.setTint(this.cTrafficTint);

    this.lastFrom = biome.from;
    this.lastTo = biome.to;
    this.lastBlend = biome.blend;
  }
}
