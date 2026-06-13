/**
 * ZEN FREE-ROAM biome regions — PURE selection of WHICH themed look is active at a
 * world position. No three, no DOM → Node-testable. The free-roam analogue of the
 * racing game's distance-based biome cycle (game/Biome.ts): the racing layer cycles
 * by FORWARD DISTANCE (a 1-D scalar), but Zen roams in 2-D, so the "distance" here is
 * a low-frequency value-noise FIELD sampled at (x, z). Same {from, to, blend} shape +
 * the same slot/from/to/blend transition math — only the input differs (noise, not
 * odometer). Reimplemented here (not imported from game/) to keep the layer boundary.
 *
 * Determinism + seamlessness come for free: the field is a function of WORLD coords
 * only (and the seed), so two adjacent terrain chunks sample the SAME biome at a shared
 * point — biome regions line up exactly across chunk edges, every session.
 *
 * The noise AMPLITUDE is banded into the 4 ZEN_BIOMES (valley → slot 0 … peak → slot 3),
 * so a biome region is a broad noise "blob" ~ one wavelength across (ZEN_BIOME tuning
 * sizes that to ~2500u — a place, not a flicker). Within a band the biome HOLDS (blend 0);
 * across the top edge of a band it cross-fades smoothly into the next, wrapping 3→0.
 */

import { ZEN_BIOMES, ZEN_BIOME } from '../utils/constants';
import { valueNoise, smoothstep } from './ZenNoise';

export interface ZenBiomeState {
  /** Index of the biome currently in effect (0 .. ZEN_BIOMES.length-1). */
  from: number;
  /** Index being blended toward (== `from` outside a transition zone). */
  to: number;
  /** Transition progress from `from` to `to`, in [0, 1] (0 outside a zone). */
  blend: number;
}

export function createZenBiomeState(): ZenBiomeState {
  return { from: 0, to: 0, blend: 0 };
}

/**
 * Resolve the biome state at world (x, z). Deterministic + pure; mutates and returns
 * `out` (no allocation — caller reuses one scratch state). The low-frequency noise is
 * remapped [-1,1] → [0, count) as the "biome coordinate"; its integer part picks the
 * band (biome), its fractional part drives the hold-then-blend exactly like the racing
 * updateBiome (with `transitionFraction` of each band spent blending into the next).
 */
export function biomeAt(seed: number, x: number, z: number, out: ZenBiomeState): ZenBiomeState {
  const count = ZEN_BIOMES.length;
  if (count <= 1) {
    out.from = 0;
    out.to = 0;
    out.blend = 0;
    return out;
  }

  const f = ZEN_BIOME.noiseFrequency;
  const n = valueNoise(seed + ZEN_BIOME.seedOffset, x * f, z * f); // [-1, 1], continuous
  // Map amplitude → biome coordinate in [0, count]. `s` is the Zen analogue of the racing
  // "distance / span": its floor selects the band, its fraction is the within-band progress.
  const s = (n + 1) * 0.5 * count; // [0, count]
  const slot = Math.floor(s);
  const frac = s - slot; // [0, 1) within the current band
  const from = ((slot % count) + count) % count; // wrap (and stay non-negative)
  const tStart = 1 - ZEN_BIOME.transitionFraction;

  out.from = from;
  if (frac < tStart) {
    out.to = from;
    out.blend = 0;
  } else {
    out.to = (from + 1) % count;
    // smoothstep across the band edge → a C1 cross-fade (no kink at the transition start).
    out.blend = smoothstep(0, 1, (frac - tStart) / ZEN_BIOME.transitionFraction);
  }
  return out;
}
