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
 *
 * BIOME-VARIED CHARACTER: the terrain's FEEL now varies by biome — flat Midnight plains,
 * gentle Aurora dunes, rolling Sunset hills, peaky Dawn mountains. The trick is WEIGHTED
 * BLENDING, never a discrete switch: each biome defines terrain PARAMS (ZEN_BIOME_TERRAIN),
 * and heightAt cross-fades the two active biomes' STATIONARY height fields by the SAME
 * {from, to, blend} weight the LOOK uses (ZenBiome.biomeAt). We blend the two fields' HEIGHTS
 * (each computed at its biome's CONSTANT frequency), never the frequency scalar — a spatially
 * varying frequency would inject a position-dependent phase `x·freq(x)` whose gradient grows
 * with |x| (artificial steepness far from origin). Blending bounded-slope stationary fields by
 * a gently varying weight stays continuous + seamless BY CONSTRUCTION — near a region border
 * you drive over a smooth MIX of both biomes' terrain (plains easing up into mountains over
 * the ~2800u transition band, no cliff).
 */

import { hashNoise } from '../utils/rng';
import { lerp } from '../utils/math';
import { ZEN, ZEN_BIOME_TERRAIN, type ZenBiomeTerrain } from '../utils/constants';
import { valueNoise, smoothstep } from './ZenNoise';
import { biomeAt, createZenBiomeState } from './ZenBiome';

/** Reused scratch for the per-sample biome weight (no hot-loop allocation — heightAt is
 *  called per terrain vertex on a rebuild). Single-threaded + non-reentrant use (each
 *  heightAt call writes then reads it before returning). */
const _biome = createZenBiomeState();

/** The rolling-hills baseline, with per-biome amplitude + frequency so the SAME octave
 *  structure reads as flat plains (low amp), gentle dunes (high amp + low freq), or rolling
 *  hills (baseline) depending on the blended biome. */
function hillsAt(seed: number, x: number, z: number, amplitude: number, frequencyMul: number): number {
  let h = 0;
  let amp = amplitude;
  let freq = ZEN.terrainFrequency * frequencyMul;
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
 * (so hills LEAD UP to mountains, no cliff); 1 in the heart of a mountain region. `bias` is
 * added to the raw mask value before thresholding (biome-driven — a peaky biome like Dawn
 * biases it up so mountains appear MORE often there); 0 = the baseline coverage.
 */
function maskWithBias(seed: number, x: number, z: number, bias: number): number {
  const n = valueNoise(seed + 4242, x * ZEN.maskFrequency, z * ZEN.maskFrequency); // [-1,1]
  const m01 = (n + 1) * 0.5 + bias; // [0,1] (+ biome bias)
  return smoothstep(ZEN.maskThreshold, ZEN.maskThreshold + ZEN.maskBlend, m01);
}

/** Mountain mask at the BASELINE coverage (no biome bias) — the gentle-terrain gate the
 *  ramps + the terrain tint use (a biome-independent "is this raw terrain gentle" test). */
export function maskAt(seed: number, x: number, z: number): number {
  return maskWithBias(seed, x, z, 0);
}

/** RIDGED peaky height in ~[0, 1]: a couple octaves of inverted-abs noise (1 − |n|) →
 *  sharp ridgelines at the noise's zero-crossings, so it reads as MOUNTAINS, not lumps. */
function ridgedAt(seed: number, x: number, z: number, frequencyMul: number): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = ZEN.mountainFrequency * frequencyMul;
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
  // Resolve THIS cell's gated ramp centre into a reused scratch (no hot-loop allocation).
  if (!rampCellCenter(seed, Math.floor(x / cs), Math.floor(z / cs), _rampScratch)) return 0;
  const m = ZEN.rampRadius;
  const dx = x - _rampScratch.x;
  const dz = z - _rampScratch.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= m) return 0; // outside the dome → nothing (the common case in a ramp cell)
  // Raised-cosine dome: 1 at the centre → 0 at the rim, 0 slope at the rim (smooth blend).
  return ZEN.rampHeight * 0.5 * (1 + Math.cos((Math.PI * d) / m));
}

/** Reused scratch for the per-vertex ramp-centre resolve (no hot-loop allocation). */
const _rampScratch = { x: 0, z: 0 };

/**
 * Resolve a ramp CELL's gated centre into `out`, returning whether the cell carries a ramp.
 * The placement contract (shared by rampContribution + the minimap's marker scan): SPARSE
 * (a low-freq cell hash), jittered a rampRadius margin off the cell edges (so the dome lives
 * wholly inside its cell), and gated to GENTLE terrain (mask ≤ rampMaxMask). Pure + no
 * allocation (writes `out`).
 */
function rampCellCenter(seed: number, cellX: number, cellZ: number, out: { x: number; z: number }): boolean {
  const cs = ZEN.rampCellSize;
  const key = (Math.imul(cellX, 73856093) ^ Math.imul(cellZ, 19349663)) | 0;
  const rseed = (seed + 91331) | 0; // decorrelate ramp placement from hills/mask/mountains
  // Sparse: does this cell carry a ramp at all?
  if ((hashNoise(rseed, key) + 1) * 0.5 > ZEN.rampChance) return false;
  // Ramp centre, jittered but kept a rampRadius margin off the cell edges.
  const m = ZEN.rampRadius;
  const jx = (hashNoise(rseed, (key * 2 + 1) | 0) + 1) * 0.5;
  const jz = (hashNoise(rseed, (key * 2 + 2) | 0) + 1) * 0.5;
  const centerX = cellX * cs + lerp(m, cs - m, jx);
  const centerZ = cellZ * cs + lerp(m, cs - m, jz);
  // GENTLE terrain only — gate on the mask at the CENTRE (constant for the whole dome, so the
  // ramp is present-or-absent as a unit; no per-point clipping that would crack continuity).
  if (maskAt(seed, centerX, centerZ) > ZEN.rampMaxMask) return false;
  out.x = centerX;
  out.z = centerZ;
  return true;
}

/**
 * The gated ramp centre for a cell index, or null if the cell carries no ramp — the public
 * (allocating) form for the minimap's marker scan (called off the hot path, on resample).
 */
export function rampCenterForCell(seed: number, cellX: number, cellZ: number): { x: number; z: number } | null {
  const out = { x: 0, z: 0 };
  return rampCellCenter(seed, cellX, cellZ, out) ? out : null;
}

/**
 * One biome's terrain height at (x, z) with that biome's CONSTANT params — a STATIONARY
 * field (fixed frequency), so its slope is bounded everywhere. (Blending the frequency
 * SCALAR spatially instead would put a position-dependent phase `x·freq(x)` into the noise,
 * whose gradient grows with |x| → artificial steepness far from origin. So we blend the two
 * biomes' stationary HEIGHTS, never their frequency.)
 */
function biomeHeightAt(seed: number, x: number, z: number, t: ZenBiomeTerrain): number {
  const hills = hillsAt(seed, x, z, t.hillAmplitude, t.hillFrequencyMul);
  // Non-mountain biome: gentle hills/dunes only — skip the mask + ridged octaves (cheap).
  if (t.mountainAmount <= 0) return hills;
  const mask = maskWithBias(seed, x, z, t.mountainBias);
  if (mask <= 0) return hills;
  return hills + t.mountainAmount * mask * ZEN.mountainAmplitude * ridgedAt(seed, x, z, t.ridgeFrequencyMul);
}

/**
 * Continuous terrain height at world (x, z) — keyed to world coords → seamless across chunks
 * and deterministic per seed. The terrain CHARACTER varies by region (flat → dune → rolling →
 * peaky) via WEIGHTED BLENDING of the two active biomes' STATIONARY height fields by the SAME
 * biomeAt {from,to,blend} weight that drives the look:
 *   height = lerp(fromBiome_terrain, toBiome_terrain, blend) + ramp_dome
 * Each field is a stationary noise (bounded slope); the blend weight varies gently over the
 * ~2800u transition band → near a border you drive over a smooth MIX of both biomes' terrain
 * (plains easing up into mountains, no cliff). Continuous + seamless by construction. SPARSE
 * ramps stay a global gentle-terrain feature (placed in raw-mask-zero spots in every biome).
 */
export function heightAt(seed: number, x: number, z: number): number {
  biomeAt(seed, x, z, _biome);
  const ramp = rampContribution(seed, x, z);
  const from = ZEN_BIOME_TERRAIN[_biome.from];
  // Outside a transition (the common case): a single stationary biome field + ramp.
  if (_biome.blend <= 0) return biomeHeightAt(seed, x, z, from) + ramp;
  // In a transition: cross-fade the two biomes' stationary fields by the blend weight.
  const to = ZEN_BIOME_TERRAIN[_biome.to];
  const hFrom = biomeHeightAt(seed, x, z, from);
  const hTo = biomeHeightAt(seed, x, z, to);
  return lerp(hFrom, hTo, _biome.blend) + ramp;
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
