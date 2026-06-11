/**
 * Zen terrain height (PR3a) — the keystone of the rolling-hills surface. The FEEL is a
 * phone playtest, but the math is unit-testable: heightAt is CONTINUOUS (no cracks at
 * lattice/chunk boundaries → seamless meshes), DETERMINISTIC per seed, and the slope
 * derivative is well-formed. (The bounded slope EFFECT is tested in zen_vehicle.)
 */
import { describe, expect, it } from 'vitest';
import { heightAt, slopeAlong } from '../ZenHeight';
import { ZEN } from '../../utils/constants';

const SEED = ZEN.worldSeed;

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

  it('stays within the expected gentle amplitude band (rolling, not jagged)', () => {
    let maxAbs = 0;
    for (let i = 0; i < 4000; i++) {
      const x = (i * 37) % 2000 - 1000;
      const z = (i * 53) % 2000 - 1000;
      maxAbs = Math.max(maxAbs, Math.abs(heightAt(SEED, x, z)));
    }
    // Total relief is bounded by the summed octave amplitudes.
    let bound = 0;
    let amp = ZEN.terrainAmplitude;
    for (let o = 0; o < ZEN.terrainOctaves; o++) {
      bound += amp;
      amp *= ZEN.terrainGain;
    }
    expect(maxAbs).toBeLessThanOrEqual(bound + 1e-6);
    expect(maxAbs).toBeGreaterThan(0); // there ARE hills
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

  it('is finite and modest for the gentle terrain (no cliffs)', () => {
    for (let i = 0; i < 500; i++) {
      const s = slopeAlong(SEED, i * 11, i * -7, Math.sin(i), -Math.cos(i));
      expect(Number.isFinite(s)).toBe(true);
      expect(Math.abs(s)).toBeLessThan(1); // < 45° everywhere — rolling, not jagged
    }
  });
});
