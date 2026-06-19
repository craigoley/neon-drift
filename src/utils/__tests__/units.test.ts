/**
 * DISPLAY-ONLY US unit formatters (audit #174). These format the numbers a player READS; they must NOT
 * be coupled to the sim (the sim's internal speed/distance are unchanged — no SIM_MATH impact).
 */
import { describe, expect, it } from 'vitest';
import { mph, usDistance } from '../units';
import { UNITS } from '../constants';

describe('units — speed → mph (display-only)', () => {
  it('shows a whole mph number that reads like a plausible fast car (not absurd km/s)', () => {
    expect(mph(70)).toBe(70); // cruise
    expect(mph(235)).toBe(235); // top — a believable hypercar mph, not 226,000 "km/s"
    expect(Number.isInteger(mph(123.7))).toBe(true); // rounded whole number
  });
});

describe('units — distance → US miles/feet (display-only)', () => {
  it('shows FEET for short distances (close gaps / early run stay legible)', () => {
    expect(usDistance(50)).toBe(`${Math.round(50 * UNITS.feetPerMeter)} ft`); // ~164 ft
    expect(usDistance(0)).toBe('0 ft');
  });
  it('shows MILES (one decimal) for longer distances', () => {
    expect(usDistance(1609.34)).toBe('1.0 mi');
    expect(usDistance(10000)).toBe('6.2 mi'); // a 10k-unit run reads as a ~6 mile race
  });
  it('switches feet→miles at the threshold, by magnitude (sign is the caller’s)', () => {
    expect(usDistance(UNITS.feetThresholdMeters - 1)).toMatch(/ft$/);
    expect(usDistance(UNITS.feetThresholdMeters + 1)).toMatch(/mi$/);
    expect(usDistance(-707)).toBe(usDistance(707)); // magnitude (RaceHud prepends ahead/behind)
  });
});
