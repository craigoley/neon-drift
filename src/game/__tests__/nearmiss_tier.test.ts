/**
 * Near-miss feedback tier bands (OPP-13+04). Pins the band boundaries so the
 * crescendo can't silently shift tiers. Pure — display/feel only, no scoring.
 */
import { describe, expect, it } from 'vitest';
import { nearMissTier } from '../Scoring';
import { JUICE } from '../../utils/constants';

describe('nearMissTier — combo band boundaries', () => {
  it('maps combo to the documented 4 bands (<3 / 3-5 / 6-9 / >=10)', () => {
    expect(nearMissTier(0)).toBe(0);
    expect(nearMissTier(2.9)).toBe(0);
    expect(nearMissTier(3)).toBe(1);
    expect(nearMissTier(5)).toBe(1);
    expect(nearMissTier(5.9)).toBe(1);
    expect(nearMissTier(6)).toBe(2);
    expect(nearMissTier(9)).toBe(2);
    expect(nearMissTier(9.9)).toBe(2);
    expect(nearMissTier(10)).toBe(3);
    expect(nearMissTier(99)).toBe(3);
  });

  it('every tier 0..3 indexes a value in each per-tier crescendo array', () => {
    // The dispatch indexes these arrays by tier — guard they cover 0..3.
    for (let tier = 0; tier <= 3; tier++) {
      expect(JUICE.nearMissShake[tier]).toBeTypeOf('number');
      expect(JUICE.nearMissEdge[tier]).toBeTypeOf('number');
      expect(JUICE.nearMissPitch[tier]).toBeTypeOf('number');
      expect(JUICE.nearMissCalloutText[tier]).toBeTypeOf('string');
    }
  });

  it('tier 0 is restrained: no shake, no callout (stays slick at low combo)', () => {
    expect(JUICE.nearMissShake[0]).toBe(0);
    expect(JUICE.nearMissCalloutText[0]).toBe('');
    expect(0).toBeLessThan(JUICE.nearMissCalloutTier); // tier 0 below the callout gate
  });

  it('shake escalates monotonically and stays below the crash shake', () => {
    for (let t = 1; t <= 3; t++) expect(JUICE.nearMissShake[t]).toBeGreaterThan(JUICE.nearMissShake[t - 1]);
    expect(JUICE.nearMissShake[3]).toBeLessThan(JUICE.shakeMagnitude); // crash still hits hardest
  });
});
