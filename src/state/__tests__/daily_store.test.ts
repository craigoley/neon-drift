import { describe, expect, it } from 'vitest';
import { DailyStore } from '../DailyStore';
import { DAILY_HISTORY_SIZE, DAILY_STORAGE_KEY } from '../../utils/constants';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function memStorage(seed?: string): StorageLike & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  if (seed !== undefined) raw.set(DAILY_STORAGE_KEY, seed);
  return {
    raw,
    getItem: (k: string) => raw.get(k) ?? null,
    setItem: (k: string, v: string) => void raw.set(k, v),
  };
}

const TODAY = 20260531;

describe('DailyStore — new-day creation + run counting', () => {
  it("creates today's entry on first run and counts runs", () => {
    const s = new DailyStore(memStorage());
    expect(s.today(TODAY)).toBe(null);
    const r1 = s.submitDaily(TODAY, 1000, 100, 'pulse');
    expect(r1.runs).toBe(1);
    expect(r1.isBest).toBe(true); // first scoring run is a best
    const r2 = s.submitDaily(TODAY, 500, 50, 'pulse');
    expect(r2.runs).toBe(2);
    expect(s.today(TODAY)?.runs).toBe(2);
  });
});

describe('DailyStore — best update', () => {
  it('only raises the best when beaten, recording its distance + car', () => {
    const s = new DailyStore(memStorage());
    s.submitDaily(TODAY, 1000, 100, 'pulse');
    const worse = s.submitDaily(TODAY, 600, 200, 'nova'); // higher distance, lower score
    expect(worse.isBest).toBe(false);
    expect(worse.bestScore).toBe(1000);
    const better = s.submitDaily(TODAY, 1500, 150, 'ghost');
    expect(better.isBest).toBe(true);
    const entry = s.today(TODAY)!;
    expect(entry.bestScore).toBe(1500);
    expect(entry.bestDistance).toBe(150);
    expect(entry.bestCarId).toBe('ghost');
    expect(entry.runs).toBe(3);
  });
});

describe('DailyStore — 7-day rolling prune', () => {
  it(`keeps only the ${DAILY_HISTORY_SIZE} most-recent days, newest first`, () => {
    const s = new DailyStore(memStorage());
    // Submit 10 consecutive days (20260525..20260603); only the 7 newest survive.
    for (let day = 25; day <= 31; day++) s.submitDaily(20260500 + day, day * 100, day, 'pulse');
    for (let day = 1; day <= 3; day++) s.submitDaily(20260600 + day, (30 + day) * 100, day, 'pulse');

    const hist = s.history();
    expect(hist).toHaveLength(DAILY_HISTORY_SIZE);
    // Newest first.
    expect(hist[0].dateKey).toBe(20260603);
    expect(hist[hist.length - 1].dateKey).toBe(20260528);
    // The oldest days were pruned.
    expect(hist.some((e) => e.dateKey === 20260525)).toBe(false);
    expect(hist.some((e) => e.dateKey === 20260527)).toBe(false);
    // Sorted descending.
    const keys = hist.map((e) => e.dateKey);
    expect(keys).toEqual([...keys].sort((a, b) => b - a));
  });
});

describe('DailyStore — persistence + resilience', () => {
  it('round-trips across instances sharing the same storage', () => {
    const store = memStorage();
    const a = new DailyStore(store);
    a.submitDaily(TODAY, 1234, 120, 'nova');
    const b = new DailyStore(store);
    expect(b.today(TODAY)).toMatchObject({ bestScore: 1234, bestDistance: 120, bestCarId: 'nova', runs: 1 });
  });

  it('degrades to in-memory with no storage and never throws', () => {
    const s = new DailyStore(null);
    expect(() => s.submitDaily(TODAY, 999, 99, 'pulse')).not.toThrow();
    expect(s.today(TODAY)?.bestScore).toBe(999);
  });

  it('falls back to an empty history on a corrupt blob', () => {
    const s = new DailyStore(memStorage('{not json'));
    expect(s.history()).toHaveLength(0);
  });
});
