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

/** One octave of interpolated value noise in [-1, 1], continuous in (x, z). Exported so
 *  the Zen BIOME-region selection (ZenBiome.ts) reuses the SAME seamless, world-keyed
 *  noise the terrain is built on — no second noise implementation to keep in sync. */
export function valueNoise(seed: number, x: number, z: number): number {
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

/** smoothstep(a, b, t): 0 below a, 1 above b, a C1 ease-in between (clamped). Exported
 *  for the Zen BIOME-region cross-fade (ZenBiome.ts) — the same C1 ease used here. */
export function smoothstep(a: number, b: number, t: number): number {
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
 * RAMP / DUNE contribution at (x, z) — a smooth raised dome where a SPARSE low-frequency
 * cell hash has placed a designed launch spot. 0 almost everywhere (a delight you stumble
 * on, not litter). At most one ramp per `rampCellSize` cell; its centre is jittered but kept
 * ≥ rampRadius from the cell edges so the dome lives WHOLLY inside its cell — a point need
 * only check its OWN cell (cheap) and the contribution is CONTINUOUS (the raised-cosine dome
 * blends to 0 with 0 slope at its rim, and is 0 across cell boundaries → seams like the rest
 * of heightAt). Gated to GENTLE terrain (mask ≤ rampMaxMask) so you launch UP-AND-OUT into
 * landable space, never into a mountain. Exported for the renderer tint + tests.
 */
export function rampContribution(seed: number, x: number, z: number): number {
  const cs = ZEN.rampCellSize;
  const cx = Math.floor(x / cs);
  const cz = Math.floor(z / cs);
  const key = (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) | 0;
  const rseed = (seed + 91331) | 0; // decorrelate ramp placement from hills/mask/mountains
  // Sparse: does this cell carry a ramp at all?
  if ((hashNoise(rseed, key) + 1) * 0.5 > ZEN.rampChance) return 0;
  // Ramp centre, jittered but kept a rampRadius margin off the cell edges.
  const m = ZEN.rampRadius;
  const jx = (hashNoise(rseed, (key * 2 + 1) | 0) + 1) * 0.5;
  const jz = (hashNoise(rseed, (key * 2 + 2) | 0) + 1) * 0.5;
  const centerX = cx * cs + lerp(m, cs - m, jx);
  const centerZ = cz * cs + lerp(m, cs - m, jz);
  const dx = x - centerX;
  const dz = z - centerZ;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= m) return 0; // outside the dome → nothing (the common case in a ramp cell)
  // GENTLE terrain only — gate on the mask at the CENTRE (constant for the whole dome, so it
  // is present-or-absent as a unit; no per-point clipping that would crack continuity).
  if (maskAt(seed, centerX, centerZ) > ZEN.rampMaxMask) return 0;
  // Raised-cosine dome: 1 at the centre → 0 at the rim, 0 slope at the rim (smooth blend).
  return ZEN.rampHeight * 0.5 * (1 + Math.cos((Math.PI * d) / m));
}

/**
 * Continuous terrain height at world (x, z) — keyed to world coords → seamless across
 * chunks and deterministic per seed.
 *   height = gentle_hills + ramp_dome + mask_ramp × mountain_amplitude × ridged_peaks
 * Gentle ROLLING hills everywhere; OCCASIONAL mountains rise where the low-frequency mask
 * is high, leading up smoothly; SPARSE ramps/dunes add designed launch spots in the gentle
 * majority. The hills baseline is untouched where the mask is low (Craig keeps his hills).
 */
export function heightAt(seed: number, x: number, z: number): number {
  const hills = hillsAt(seed, x, z);
  const ramp = rampContribution(seed, x, z);
  const mask = maskAt(seed, x, z);
  // Majority of the world: gentle hills (+ any ramp) — skip the ridged octaves (cheap).
  if (mask <= 0) return hills + ramp;
  return hills + ramp + mask * ZEN.mountainAmplitude * ridgedAt(seed, x, z);
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
