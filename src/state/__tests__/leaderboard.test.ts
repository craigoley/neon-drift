import { describe, expect, it } from 'vitest';
import { LeaderboardStore } from '../Leaderboard';
import { LEADERBOARD_SIZE, LEADERBOARD_STORAGE_KEY, STORAGE_KEY } from '../../utils/constants';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** In-memory storage; optionally pre-seed any key (legacy best or leaderboard). */
function memStorage(seed?: Record<string, string>): StorageLike & { raw: Map<string, string> } {
  const raw = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    raw,
    getItem: (k: string) => raw.get(k) ?? null,
    setItem: (k: string, v: string) => void raw.set(k, v),
  };
}

/** A deterministic clock so recorded dates are stable in tests. */
const fixedClock = (t = 1_000) => () => t;

const run = (score: number, distance: number, carId = 'pulse') => ({ score, distance, carId });

describe('LeaderboardStore — insert / sort / cap', () => {
  it('keeps runs sorted by score desc', () => {
    const lb = new LeaderboardStore(memStorage(), fixedClock());
    lb.submit(run(100, 10));
    lb.submit(run(300, 30));
    lb.submit(run(200, 20));
    expect(lb.top().map((e) => e.score)).toEqual([300, 200, 100]);
    expect(lb.bestRun()).toEqual({ score: 300, distance: 30 });
  });

  it(`caps the board at LEADERBOARD_SIZE (${LEADERBOARD_SIZE}), dropping the lowest`, () => {
    const lb = new LeaderboardStore(memStorage(), fixedClock());
    // Submit 15 ascending scores; only the top 10 survive.
    for (let i = 1; i <= 15; i++) lb.submit(run(i * 100, i * 10, 'pulse'));
    const scores = lb.top().map((e) => e.score);
    expect(scores.length).toBe(LEADERBOARD_SIZE);
    expect(scores[0]).toBe(1500); // highest
    expect(scores[scores.length - 1]).toBe(600); // 15..6 kept; 5..1 dropped
    expect(scores).toEqual([...scores].sort((a, b) => b - a)); // still sorted
  });

  it('persists across instances sharing the same storage', () => {
    const store = memStorage();
    const a = new LeaderboardStore(store, fixedClock());
    a.submit(run(500, 50, 'nova'));
    const b = new LeaderboardStore(store, fixedClock());
    expect(b.top().map((e) => e.score)).toEqual([500]);
    expect(b.bestRun()).toEqual({ score: 500, distance: 50 });
  });
});

describe('LeaderboardStore — placement + nearest target', () => {
  it('reports the 1-based board rank, or null when off the board', () => {
    const lb = new LeaderboardStore(memStorage(), fixedClock());
    for (let i = 1; i <= LEADERBOARD_SIZE; i++) lb.submit(run(i * 100, i)); // fill the board (100..1000)
    expect(lb.submit(run(1050, 5)).rank).toBe(1); // new top
    const off = lb.submit(run(10, 1)); // below the current #10
    expect(off.rank).toBe(null);
  });

  it('a new #1 has no target; a lower placement chases the run just above it', () => {
    const lb = new LeaderboardStore(memStorage(), fixedClock());
    lb.submit(run(1000, 100));
    const top = lb.submit(run(2000, 200));
    expect(top.rank).toBe(1);
    expect(top.target).toBe(null); // nothing higher to chase

    const mid = lb.submit(run(1500, 150)); // lands at #2, chasing the 2000 at #1
    expect(mid.rank).toBe(2);
    expect(mid.target).toEqual({ rank: 1, score: 2000, gap: 500 });
  });
});

describe('LeaderboardStore — per-car best', () => {
  it('sets a car best on first run and only updates when beaten', () => {
    const lb = new LeaderboardStore(memStorage(), fixedClock());
    expect(lb.submit(run(400, 40, 'nova')).isCarBest).toBe(true);
    expect(lb.submit(run(300, 30, 'nova')).isCarBest).toBe(false); // didn't beat 400
    expect(lb.submit(run(500, 50, 'nova')).isCarBest).toBe(true); // beat it

    const cars = lb.perCarBests();
    const nova = cars.find((c) => c.carId === 'nova');
    expect(nova).toMatchObject({ score: 500, distance: 50 });
  });

  it('tracks bests per car independently', () => {
    const lb = new LeaderboardStore(memStorage(), fixedClock());
    lb.submit(run(400, 40, 'nova'));
    lb.submit(run(900, 90, 'ghost'));
    const byCar = Object.fromEntries(lb.perCarBests().map((c) => [c.carId, c.score]));
    expect(byCar).toEqual({ nova: 400, ghost: 900 });
  });
});

describe('LeaderboardStore — MIGRATION of the legacy single best', () => {
  it('seeds the board from the old neon-drift.best on first load (no value lost)', () => {
    const store = memStorage({ [STORAGE_KEY]: JSON.stringify({ score: 56142, distance: 3200 }) });
    const lb = new LeaderboardStore(store, fixedClock());
    expect(lb.top()).toHaveLength(1);
    expect(lb.bestRun()).toEqual({ score: 56142, distance: 3200 });
    // Migrated entry has no car id / date (unknown for a legacy best).
    const migrated = lb.top()[0];
    expect(migrated.carId).toBe('');
    expect(migrated.date).toBe(0);
    // The migrated board is written back, so a second load doesn't re-migrate
    // (and a real run can out-rank the legacy best).
    expect(store.raw.has(LEADERBOARD_STORAGE_KEY)).toBe(true);
  });

  it('does NOT migrate when a leaderboard already exists', () => {
    const store = memStorage({
      [STORAGE_KEY]: JSON.stringify({ score: 56142, distance: 3200 }),
      [LEADERBOARD_STORAGE_KEY]: JSON.stringify({ topRuns: [{ score: 10, distance: 1, carId: 'pulse', date: 5 }], perCarBest: {} }),
    });
    const lb = new LeaderboardStore(store, fixedClock());
    expect(lb.top().map((e) => e.score)).toEqual([10]); // legacy 56142 ignored — board wins
  });

  it('ignores an empty/zero legacy best', () => {
    const store = memStorage({ [STORAGE_KEY]: JSON.stringify({ score: 0, distance: 0 }) });
    const lb = new LeaderboardStore(store, fixedClock());
    expect(lb.top()).toHaveLength(0);
    expect(lb.bestRun()).toEqual({ score: 0, distance: 0 });
  });
});

describe('LeaderboardStore — resilience', () => {
  it('degrades to in-memory with no storage and never throws', () => {
    const lb = new LeaderboardStore(null, fixedClock());
    expect(() => lb.submit(run(123, 12, 'pulse'))).not.toThrow();
    expect(lb.bestRun()).toEqual({ score: 123, distance: 12 });
  });

  it('falls back to an empty board on a corrupt blob', () => {
    const store = memStorage({ [LEADERBOARD_STORAGE_KEY]: '{not json' });
    const lb = new LeaderboardStore(store, fixedClock());
    expect(lb.top()).toHaveLength(0);
  });
});
