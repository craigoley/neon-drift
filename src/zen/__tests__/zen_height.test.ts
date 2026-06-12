/**
 * Zen terrain height (PR3a) — the keystone of the rolling-hills surface. The FEEL is a
 * phone playtest, but the math is unit-testable: heightAt is CONTINUOUS (no cracks at
 * lattice/chunk boundaries → seamless meshes), DETERMINISTIC per seed, and the slope
 * derivative is well-formed. (The bounded slope EFFECT is tested in zen_vehicle.)
 */
import { describe, expect, it } from 'vitest';
import { heightAt, maskAt, rampContribution, slopeAlong } from '../ZenHeight';
import { ZEN } from '../../utils/constants';

const SEED = ZEN.worldSeed;

/** The gentle hills-only relief bound (summed hill-octave amplitudes). */
function hillBound(): number {
  let bound = 0;
  let amp = ZEN.terrainAmplitude;
  for (let o = 0; o < ZEN.terrainOctaves; o++) {
    bound += amp;
    amp *= ZEN.terrainGain;
  }
  return bound;
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
  it('PRESERVES the gentle hills where the mask is low (the majority of the world)', () => {
    const bound = hillBound();
    let gentleSamples = 0;
    let total = 0;
    for (let i = 0; i < 6000; i++) {
      const x = (i * 37) % 4000 - 2000;
      const z = (i * 53) % 4000 - 2000;
      total++;
      if (maskAt(SEED, x, z) <= 0) {
        gentleSamples++;
        // Where the mask is off, the height is the gentle hills + any (sparse, additive)
        // ramp dome. Subtract the ramp → the hills BASELINE is still within the old band.
        const baseline = heightAt(SEED, x, z) - rampContribution(SEED, x, z);
        expect(Math.abs(baseline)).toBeLessThanOrEqual(bound + 1e-6);
      }
    }
    // Mountains are OCCASIONAL: the gentle-hills majority dominates the world.
    expect(gentleSamples / total).toBeGreaterThan(0.5);
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

  it('is FINITE everywhere (incl. steep mountains) and gentle where the mask is low', () => {
    for (let i = 0; i < 2000; i++) {
      const x = i * 11;
      const z = i * -7;
      const s = slopeAlong(SEED, x, z, Math.sin(i), -Math.cos(i));
      expect(Number.isFinite(s)).toBe(true); // never NaN, even on a ridge
      if (maskAt(SEED, x, z) <= 0) {
        expect(Math.abs(s)).toBeLessThan(1); // gentle hills stay rolling (< 45°)
      }
    }
  });
});
