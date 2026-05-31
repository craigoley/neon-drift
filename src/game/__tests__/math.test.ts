import { describe, expect, it } from 'vitest';
import { clamp, inverseLerp, laneCenter, lerp, wrap } from '../../utils/math';

describe('math helpers', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it('lerps and inverse-lerps consistently', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(inverseLerp(0, 10, 5)).toBe(0.5);
  });

  it('wraps into [0, range)', () => {
    expect(wrap(12, 10)).toBe(2);
    expect(wrap(-1, 10)).toBe(9);
  });

  it('places the centre lane at x = 0 for an odd lane count', () => {
    expect(laneCenter(1, 3, 12)).toBe(0);
  });
});
