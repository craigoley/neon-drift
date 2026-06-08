/**
 * Deterministic math (MP fix PR-B). These replace Math.sin/exp/pow in the sim so it's
 * bit-identical cross-engine (the actual cross-engine proof is the e2e:cross-engine
 * harness). Here we just lock that the approximations are accurate enough to preserve
 * feel and behave sanely at the edges.
 */
import { describe, expect, it } from 'vitest';
import { detExp, detPow, detSin } from '../detmath';

describe('detSin — approximates Math.sin (~0.2% error), the de-floated sine', () => {
  it('tracks Math.sin across several periods', () => {
    let maxErr = 0;
    for (let x = -20; x <= 20; x += 0.013) maxErr = Math.max(maxErr, Math.abs(detSin(x) - Math.sin(x)));
    expect(maxErr, `max |detSin - sin| = ${maxErr}`).toBeLessThan(0.005);
  });
  it('is odd-ish and bounded in [-1, 1]', () => {
    for (let x = -10; x <= 10; x += 0.1) {
      expect(Math.abs(detSin(x))).toBeLessThanOrEqual(1.001);
    }
    expect(detSin(0)).toBeCloseTo(0, 6);
  });
});

describe('detExp — approximates Math.exp (speed-cap curve)', () => {
  it('tracks Math.exp on the sim domain (negative args, speed-cap ramp)', () => {
    for (let x = 0; x <= 6; x += 0.05) {
      const approx = detExp(-x);
      expect(approx).toBeCloseTo(Math.exp(-x), 3); // ~1e-3 — speed cap is visually identical
    }
  });
  it('saturates safely at the edges (no runaway loop for huge args)', () => {
    expect(detExp(-200000)).toBe(0); // exp underflows; bounded — no 277k-iteration loop
    expect(detExp(-1)).toBeCloseTo(Math.exp(-1), 3);
    expect(detExp(0)).toBeCloseTo(1, 6);
  });
});

describe('detPow — approximates Math.pow (lateral-friction decay)', () => {
  it('matches Math.pow for the friction regime (small base, exponent 1/60)', () => {
    for (const base of [0.0066, 0.02, 0.04, 0.5, 0.95]) {
      const e = 1 / 60;
      expect(detPow(base, e)).toBeCloseTo(Math.pow(base, e), 3);
    }
  });
  it('exact-ish on integer powers of 2', () => {
    expect(detPow(0.5, 1)).toBeCloseTo(0.5, 6);
    expect(detPow(0.5, 2)).toBeCloseTo(0.25, 6);
    expect(detPow(2, 10)).toBeCloseTo(1024, 2);
  });
  it('guards base<=0', () => {
    expect(detPow(0, 0.5)).toBe(0);
    expect(detPow(-1, 0.5)).toBe(0);
  });
});
