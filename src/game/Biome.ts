/**
 * Biome selection by distance. PURE — no three, no DOM. The pure layer decides
 * WHICH biome is active (and how far a transition has progressed); it knows only
 * indices + a blend scalar, never colours — the rendering layer owns the palette
 * (see rendering/BiomeView.ts).
 *
 * Biomes hold for a fixed `span` of distance, then the set CYCLES (0→1→2→3→0…).
 * The last `transitionFraction` of each span blends smoothly into the next biome
 * so long runs feel like continuous environmental progress, with no hard pop.
 */

import { clamp } from '../utils/math';
import { BIOMES, BIOME_CYCLE } from '../utils/constants';

export interface BiomeState {
  /** Index of the biome currently in effect (0 .. BIOMES.length-1). */
  from: number;
  /** Index being blended toward (== `from` outside a transition zone). */
  to: number;
  /** Transition progress from `from` to `to`, in [0, 1] (0 outside a zone). */
  blend: number;
}

export function createBiomeState(): BiomeState {
  return { from: 0, to: 0, blend: 0 };
}

/** Number of biomes in the cycle. */
export function biomeCount(): number {
  return BIOMES.length;
}

/**
 * Resolve the biome state for a given forward distance. Deterministic + pure;
 * mutates and returns `state` (no allocation). Within a span's leading portion
 * the biome holds (blend 0); within its trailing `transitionFraction` it blends
 * into the next biome, reaching it exactly at the span boundary, then cycles.
 */
export function updateBiome(state: BiomeState, distance: number): BiomeState {
  const n = BIOMES.length;
  const span = BIOME_CYCLE.span;
  // Guard against a non-positive span (misconfig) — never divide by zero.
  if (span <= 0 || n <= 1) {
    state.from = 0;
    state.to = 0;
    state.blend = 0;
    return state;
  }

  const slot = Math.floor(distance / span);
  const frac = distance / span - slot; // 0..1 within the current span
  const from = ((slot % n) + n) % n; // wrap (and stay non-negative)
  const tStart = 1 - BIOME_CYCLE.transitionFraction;

  state.from = from;
  if (frac < tStart) {
    state.to = from;
    state.blend = 0;
  } else {
    state.to = (from + 1) % n;
    state.blend = clamp((frac - tStart) / BIOME_CYCLE.transitionFraction, 0, 1);
  }
  return state;
}
