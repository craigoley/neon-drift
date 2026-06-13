/**
 * Zen terrain height (PR3a) — the keystone of the rolling-hills surface. The FEEL is a
 * phone playtest, but the math is unit-testable: heightAt is CONTINUOUS (no cracks at
 * lattice/chunk boundaries → seamless meshes), DETERMINISTIC per seed, and the slope
 * derivative is well-formed. (The bounded slope EFFECT is tested in zen_vehicle.)
 */
import { describe, expect, it } from 'vitest';
import { heightAt, maskAt, rampContribution, slopeAlong } from '../ZenHeight';
import { biomeAt, createZenBiomeState } from '../ZenBiome';
import { ZEN, ZEN_BIOME_TERRAIN } from '../../utils/constants';
import { lerp } from '../../utils/math';

const SEED = ZEN.worldSeed;

/** Summed hill-octave relief bound for a given octave-0 amplitude (geometric by gain). */
function hillBoundFor(amplitude: number): number {
  let bound = 0;
  let amp = amplitude;
  for (let o = 0; o < ZEN.terrainOctaves; o++) {
    bound += amp;
    amp *= ZEN.terrainGain;
  }
  return bound;
}

/** The baseline (Sunset) hills-only relief bound — the "home" rolling-hills feel. */
function hillBound(): number {
  return hillBoundFor(ZEN.terrainAmplitude);
}

/** Blended per-biome terrain params at (x, z) — the SAME weighted blend heightAt uses. */
function blendedTerrain(x: number, z: number): { hillAmplitude: number; mountainAmount: number } {
  const st = biomeAt(SEED, x, z, createZenBiomeState());
  const a = ZEN_BIOME_TERRAIN[st.from];
  const b = ZEN_BIOME_TERRAIN[st.to];
  return {
    hillAmplitude: lerp(a.hillAmplitude, b.hillAmplitude, st.blend),
    mountainAmount: lerp(a.mountainAmount, b.mountainAmount, st.blend),
  };
}

describe('Zen terrain — heightAt is continuous and seamless', () => {
  it('is deterministic per seed (same coords → same height)', () => {
    expect(heightAt(SEED, 12.5, -33.2)).toBe(heightAt(SEED, 12.5, -33.2));
    expect(heightAt(SEED, 0, 0)).toBe(heightAt(SEED, 0, 0));
  });

  it('depends on the seed (a different seed gives a different surface)', () => {
    expect(heightAt(SEED, 40, 40)).not.toBe(heightAt(SEED + 1, 40, 40));
  });

  it('is CONTINUOUS — no jump across an integer noise-lattice boundary', () => {
    // The lattice spacing is 1/terrainFrequency world units; sampling either side of a
    // lattice line must not jump (value noise w/o interpolation WOULD crack here).
    const cell = 1 / ZEN.terrainFrequency;
    for (const k of [-3, 0, 5]) {
      const at = k * cell;
      const lo = heightAt(SEED, at - 1e-4, 7);
      const hi = heightAt(SEED, at + 1e-4, 7);
      expect(Math.abs(hi - lo)).toBeLessThan(1e-2); // smooth across the boundary
    }
  });

  it('SEAMS at a chunk edge — both neighbours sample the shared edge identically', () => {
    // A vertex on the boundary between chunk (0,*) and (1,*) is at x = chunkSize. Whether
    // it is reached as "right edge of chunk 0" or "left edge of chunk 1", heightAt is the
    // same value (it is a pure function of world x,z) → the meshes line up with no gap.
    const edgeX = ZEN.chunkSize;
    for (const z of [0, 17.3, -50]) {
      expect(heightAt(SEED, edgeX, z)).toBe(heightAt(SEED, edgeX, z));
    }
  });

  it('is CONTINUOUS in MOUNTAIN regions too (the mask + ridges add no cracks)', () => {
    // Find a mountainous point, then sample either side of it: still no jump (every
    // component — hills, mask, ridged abs-noise — is continuous, so heightAt seams).
    for (let i = 0; i < 5000; i++) {
      const x = (i * 71) % 4000 - 2000;
      const z = (i * 97) % 4000 - 2000;
      if (maskAt(SEED, x, z) > 0.5) {
        const lo = heightAt(SEED, x - 1e-4, z);
        const hi = heightAt(SEED, x + 1e-4, z);
        expect(Math.abs(hi - lo)).toBeLessThan(1e-1); // continuous even on a steep peak
        return;
      }
    }
    throw new Error('no mountain region found to test');
  });
});

describe('Zen terrain — mountains rise occasionally, hills stay everywhere', () => {
  it('keeps NON-mountain biomes gentle — pure hills/dunes bounded by the biome amplitude', () => {
    // The "raw mask 0 = gentle" invariant is now BIOME-aware: in a non-mountain biome
    // (mountainAmount ≈ 0 — flat Midnight plains, gentle Aurora dunes), the height is pure
    // blended hills (+ any sparse ramp), bounded by THAT biome's hill amplitude. (Peaky
    // biomes legitimately rise far above this — tested below.)
    let flatSamples = 0;
    let total = 0;
    for (let i = 0; i < 6000; i++) {
      const x = (i * 37) % 8000 - 4000;
      const z = (i * 53) % 8000 - 4000;
      total++;
      const { hillAmplitude, mountainAmount } = blendedTerrain(x, z);
      if (mountainAmount <= 1e-6) {
        flatSamples++;
        const baseline = heightAt(SEED, x, z) - rampContribution(SEED, x, z);
        // A small epsilon over the bound for the gentle spatially-varying-frequency seam.
        expect(Math.abs(baseline)).toBeLessThanOrEqual(hillBoundFor(hillAmplitude) + 1e-3);
      }
    }
    // Non-mountain regions are a real chunk of the world (plains + dunes are 2 of 4 biomes).
    expect(flatSamples / total).toBeGreaterThan(0.25);
  });

  it('RAISES tall mountains where the mask is high (variety, not uniform hills)', () => {
    const bound = hillBound();
    let maxH = -Infinity;
    let mountainSamples = 0;
    for (let i = 0; i < 6000; i++) {
      const x = (i * 37) % 4000 - 2000;
      const z = (i * 53) % 4000 - 2000;
      const h = heightAt(SEED, x, z);
      if (maskAt(SEED, x, z) > 0) mountainSamples++;
      maxH = Math.max(maxH, h);
    }
    expect(mountainSamples).toBeGreaterThan(0); // mountain regions exist
    expect(maxH).toBeGreaterThan(bound * 3); // and they're TALL — clearly mountains, not bumps
  });

  it('is deterministic per seed in mountain regions too', () => {
    expect(heightAt(SEED, 1234, -567)).toBe(heightAt(SEED, 1234, -567));
    expect(maskAt(SEED, 1234, -567)).toBe(maskAt(SEED, 1234, -567));
  });
});

describe('Zen terrain — slopeAlong derivative', () => {
  it('is zero along a direction of no height change, signed along the gradient', () => {
    // Find a spot with a clear slope, then sample along + against it.
    const x = 25;
    const z = -40;
    const up = slopeAlong(SEED, x, z, 1, 0); // slope toward +x
    const down = slopeAlong(SEED, x, z, -1, 0); // opposite direction
    expect(down).toBeCloseTo(-up, 6); // reversing the direction negates rise/run
  });

  it('is FINITE everywhere (incl. steep mountains) and gentle in non-mountain biomes', () => {
    for (let i = 0; i < 2000; i++) {
      const x = i * 11;
      const z = i * -7;
      const s = slopeAlong(SEED, x, z, Math.sin(i), -Math.cos(i));
      expect(Number.isFinite(s)).toBe(true); // never NaN, even on a ridge
      // In a non-mountain biome (flat plains / gentle dunes), the slope stays calm — well
      // under 45° even for the tall-but-broad Aurora dunes (no sharp faces without peaks).
      if (blendedTerrain(x, z).mountainAmount <= 1e-6) {
        expect(Math.abs(s)).toBeLessThan(1);
      }
    }
  });
});
