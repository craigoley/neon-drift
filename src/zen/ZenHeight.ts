/**
 * ZEN FREE-ROAM terrain height (PR3a) — the PURE, CONTINUOUS height function the world
 * is built on. No three, no DOM → Node-testable. Builds on PR2's chunk streaming.
 *
 * Why continuous (not the per-chunk value hash used for prop placement): terrain must
 * SEAM across chunk boundaries. heightAt(x, z) is a function of WORLD coordinates only —
 * two chunk meshes sharing an edge sample the SAME height at the SAME coords, so the
 * surface lines up perfectly with no cracks (the same seamless-determinism as PR2's
 * placement, but C2-smooth instead of discrete). Cheap: a couple of interpolated value-
 * noise octaves (cost scales with octave count — the phone-perf killer, so we keep it low).
 */

import { hashNoise } from '../utils/rng';
import { clamp, lerp } from '../utils/math';
import { ZEN } from '../utils/constants';

/** Value at an integer lattice point in [-1, 1] — a pure positional hash (2D key). */
function latticeHash(seed: number, ix: number, iz: number): number {
  const k = (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) | 0;
  return hashNoise(seed, k);
}

/** Perlin "fade" (smootherstep) — C2-continuous, so interpolation has no creases. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** One octave of interpolated value noise in [-1, 1], continuous in (x, z). */
function valueNoise(seed: number, x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = fade(x - x0);
  const fz = fade(z - z0);
  const n00 = latticeHash(seed, x0, z0);
  const n10 = latticeHash(seed, x0 + 1, z0);
  const n01 = latticeHash(seed, x0, z0 + 1);
  const n11 = latticeHash(seed, x0 + 1, z0 + 1);
  return lerp(lerp(n00, n10, fx), lerp(n01, n11, fx), fz);
}

/** smoothstep(a, b, t): 0 below a, 1 above b, a C1 ease-in between (clamped). */
function smoothstep(a: number, b: number, t: number): number {
  if (a === b) return t < a ? 0 : 1;
  const u = clamp((t - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
}

/** The gentle rolling-hills baseline (the original heightAt) — kept EVERYWHERE. */
function hillsAt(seed: number, x: number, z: number): number {
  let h = 0;
  let amp = ZEN.terrainAmplitude;
  let freq = ZEN.terrainFrequency;
  for (let o = 0; o < ZEN.terrainOctaves; o++) {
    // Per-octave seed offset so the octaves are decorrelated (no self-similar stacking).
    h += amp * valueNoise(seed + o * 1013, x * freq, z * freq);
    amp *= ZEN.terrainGain;
    freq *= ZEN.terrainLacunarity;
  }
  return h;
}

/**
 * MOUNTAIN MASK in [0, 1] (PR4): a single LOW-frequency value-noise octave → big regions.
 * 0 below the threshold (gentle hills); ramps smoothly 0→1 across the blend band above it
 * (so hills LEAD UP to mountains, no cliff); 1 in the heart of a mountain region.
 */
export function maskAt(seed: number, x: number, z: number): number {
  const n = valueNoise(seed + 4242, x * ZEN.maskFrequency, z * ZEN.maskFrequency); // [-1,1]
  const m01 = (n + 1) * 0.5; // [0,1]
  return smoothstep(ZEN.maskThreshold, ZEN.maskThreshold + ZEN.maskBlend, m01);
}

/** RIDGED peaky height in ~[0, 1]: a couple octaves of inverted-abs noise (1 − |n|) →
 *  sharp ridgelines at the noise's zero-crossings, so it reads as MOUNTAINS, not lumps. */
function ridgedAt(seed: number, x: number, z: number): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = ZEN.mountainFrequency;
  for (let o = 0; o < ZEN.mountainOctaves; o++) {
    const r = 1 - Math.abs(valueNoise(seed + 7000 + o * 1013, x * freq, z * freq));
    sum += amp * r;
    norm += amp;
    amp *= ZEN.mountainGain;
    freq *= ZEN.mountainLacunarity;
  }
  return sum / norm;
}

/**
 * Continuous terrain height at world (x, z) — keyed to world coords → seamless across
 * chunks and deterministic per seed.
 *   height = gentle_hills + mask_ramp × mountain_amplitude × ridged_peaks
 * Gentle ROLLING hills everywhere; OCCASIONAL mountains rise where the low-frequency mask
 * is high, leading up smoothly. The hills baseline is untouched where the mask is low —
 * which is the majority of the world (Craig keeps the gradual hills he loves).
 */
export function heightAt(seed: number, x: number, z: number): number {
  const hills = hillsAt(seed, x, z);
  const mask = maskAt(seed, x, z);
  // Majority of the world: pure gentle hills — and we skip the ridged octaves (cheap).
  if (mask <= 0) return hills;
  return hills + mask * ZEN.mountainAmplitude * ridgedAt(seed, x, z);
}

/**
 * Slope (rise / run) along a UNIT direction (dirX, dirZ) at world (x, z), via a central
 * finite difference. Positive = uphill ahead, negative = downhill. Drives both the gentle
 * speed nudge and the visual pitch tilt.
 */
export function slopeAlong(seed: number, x: number, z: number, dirX: number, dirZ: number): number {
  const eps = ZEN.terrainSlopeEps;
  const ahead = heightAt(seed, x + dirX * eps, z + dirZ * eps);
  const behind = heightAt(seed, x - dirX * eps, z - dirZ * eps);
  return (ahead - behind) / (2 * eps);
}
