import { describe, expect, it } from 'vitest';
import { aabbOverlap, clamp, decay, intervalsOverlap, lerp } from '../../utils/math';

describe('math helpers', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it('lerps', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it('decay returns full quantity at dt=0 and shrinks over time', () => {
    expect(decay(0.5, 0)).toBe(1);
    expect(decay(0.5, 1)).toBeCloseTo(0.5);
    expect(decay(0.5, 2)).toBeCloseTo(0.25);
  });

  it('interval + aabb overlap', () => {
    expect(intervalsOverlap(0, 1, 1.5, 1)).toBe(true);
    expect(intervalsOverlap(0, 1, 2.5, 1)).toBe(false);
    expect(aabbOverlap(0, 0, 1, 1, 0.5, 0.5, 1, 1)).toBe(true);
    expect(aabbOverlap(0, 0, 1, 1, 5, 5, 1, 1)).toBe(false);
  });
});
