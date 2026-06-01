/**
 * Daily challenge date→seed mapping (OPP-09). Pins the contract the daily relies
 * on: a date maps to ONE stable seed (replays match), consecutive days differ
 * strongly (different courses), and the seed is a 32-bit uint like a random run.
 * Uses LOCAL date components (new Date(y, m, d) is local), matching dailyDateKey.
 */
import { describe, expect, it } from 'vitest';
import { dailyDateKey, dailySeed } from '../../utils/daily';

describe('dailyDateKey — local YYYYMMDD', () => {
  it('packs local year/month/day (month is 1-based in the key)', () => {
    expect(dailyDateKey(new Date(2026, 4, 31))).toBe(20260531); // May = month index 4
    expect(dailyDateKey(new Date(2026, 0, 1))).toBe(20260101); // Jan 1
    expect(dailyDateKey(new Date(2026, 11, 25))).toBe(20261225); // Dec 25
  });

  it('increments across consecutive days', () => {
    expect(dailyDateKey(new Date(2026, 5, 1))).toBe(20260601);
    expect(dailyDateKey(new Date(2026, 5, 2))).toBe(20260602);
  });
});

describe('dailySeed — stable per date, well-spread across days', () => {
  it('same date always yields the same seed (replays match)', () => {
    const a = dailySeed(new Date(2026, 4, 31));
    const b = dailySeed(new Date(2026, 4, 31, 23, 59, 59)); // same local day, later time
    expect(a).toBe(b);
  });

  it('a known date yields a pinned seed (guards accidental formula drift)', () => {
    expect(dailySeed(new Date(2026, 4, 31))).toBe(2392771152);
  });

  it('consecutive days produce very different seeds (different courses)', () => {
    const d0 = dailySeed(new Date(2026, 4, 31)); // 20260531
    const d1 = dailySeed(new Date(2026, 5, 1)); //  20260601
    expect(d0).not.toBe(d1);
    // The avalanche means a 1-day key delta scatters wildly, not a ±1 neighbour.
    expect(Math.abs(d0 - d1)).toBeGreaterThan(1000);
  });

  it('is a finite 32-bit unsigned integer (same range as a random run seed)', () => {
    for (const d of [new Date(2024, 0, 1), new Date(2026, 4, 31), new Date(2030, 11, 31)]) {
      const s = dailySeed(d);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(0x1_0000_0000);
    }
  });
});
