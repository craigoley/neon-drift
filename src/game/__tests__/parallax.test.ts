import { describe, expect, it } from 'vitest';
import { parallaxRenderZ, parallaxZRange } from '../../utils/parallax';

describe('parallax scenery — bounded streaming window', () => {
  const gap = 26;
  const count = 14;
  const behind = 1;

  it('every slot stays inside the fixed z-window for ANY travelled distance', () => {
    const { min, max } = parallaxZRange(gap, count, behind);
    // Aggregate the observed extremes across a wide distance sweep and assert
    // ONCE (not per-iteration) so the test is fast — ~766k expect() calls here
    // tripped vitest's 5s per-test timeout. A coarse step still exercises the
    // wrap boundary thoroughly because gap (26) and step (3.1) are incommensurate.
    let lo = Infinity;
    let hi = -Infinity;
    for (let distance = 0; distance <= 200000; distance += 3.1) {
      for (let i = 0; i < count; i++) {
        const z = parallaxRenderZ(distance, 1, gap, i, behind);
        if (z < lo) lo = z;
        if (z > hi) hi = z;
      }
    }
    expect(lo).toBeGreaterThanOrEqual(min - 1e-6);
    expect(hi).toBeLessThanOrEqual(max + 1e-6);
  });

  it('the window width equals count*gap — a fixed-size pool, never growing', () => {
    const { min, max } = parallaxZRange(gap, count, behind);
    expect(max - min).toBeCloseTo(count * gap);
  });

  it('slots are evenly spaced by `gap` within a frame', () => {
    const z0 = parallaxRenderZ(1000, 1, gap, 0, behind);
    const z1 = parallaxRenderZ(1000, 1, gap, 1, behind);
    expect(z0 - z1).toBeCloseTo(gap);
  });

  it('a nearer layer (parallax 1) sweeps faster than a far layer (parallax 0.35)', () => {
    // Over a small travel step away from a wrap boundary, the camera-relative z
    // shifts by ~parallax*Δdistance, so the near layer moves more.
    const d = 1000.0;
    const dd = 0.5;
    const near0 = parallaxRenderZ(d, 1.0, gap, 0, behind);
    const near1 = parallaxRenderZ(d + dd, 1.0, gap, 0, behind);
    const far0 = parallaxRenderZ(d, 0.35, gap, 0, behind);
    const far1 = parallaxRenderZ(d + dd, 0.35, gap, 0, behind);
    expect(Math.abs(near1 - near0)).toBeGreaterThan(Math.abs(far1 - far0));
  });

  it('produces finite values for extreme inputs (no NaN/Infinity)', () => {
    for (const distance of [0, 1, 1e6, 1e9]) {
      for (const parallax of [1, 0.35, 0.05]) {
        const z = parallaxRenderZ(distance, parallax, gap, 3, behind);
        expect(Number.isFinite(z)).toBe(true);
      }
    }
  });
});
