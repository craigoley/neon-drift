/**
 * ZEN FREE-ROAM noise primitives — the PURE, leaf-level value-noise the whole free-roam
 * world is built on (terrain height AND biome-region selection). No three, no DOM, no
 * intra-zen imports → Node-testable + dependency-free, so BOTH ZenHeight (terrain) and
 * ZenBiome (region selection) can share the SAME seamless, world-keyed noise without a
 * circular import. Continuous in (x, z): two chunk meshes sampling a shared edge get the
 * SAME value, so surfaces + region borders line up with no cracks.
 */

import { hashNoise } from '../utils/rng';
import { clamp, lerp } from '../utils/math';

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

/** smoothstep(a, b, t): 0 below a, 1 above b, a C1 ease-in between (clamped). */
export function smoothstep(a: number, b: number, t: number): number {
  if (a === b) return t < a ? 0 : 1;
  const u = clamp((t - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
}
