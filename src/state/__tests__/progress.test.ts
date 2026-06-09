import { describe, expect, it } from 'vitest';
import { ProgressStore, type RunResult } from '../Progress';
import { CARS, CAR_UNLOCKS, CREDITS, PROGRESS_STORAGE_KEY, STARTER_CAR_ID, STARTING_CAR_IDS } from '../../utils/constants';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Shared in-memory storage so two stores can round-trip the same backing. */
function memStorage(seed?: string): StorageLike & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  if (seed !== undefined) raw.set(PROGRESS_STORAGE_KEY, seed);
  return {
    raw,
    getItem: (k: string) => raw.get(k) ?? null,
    setItem: (k: string, v: string) => void raw.set(k, v),
  };
}

/** A RunResult with a 0 score by default (so unlock tests ignore credits). */
function run(partial: Partial<RunResult>): RunResult {
  return { score: 0, distance: 0, bestCombo: 0, powerupsCollected: 0, biomesSeen: 0, ...partial };
}

describe('ProgressStore — fresh player (widened starting set)', () => {
  it('starts with the whole STARTING SET unlocked, tier-2 cars locked, zeroed stats + 0 credits', () => {
    const p = new ProgressStore(memStorage());
    for (const id of STARTING_CAR_IDS) expect(p.isUnlocked(id)).toBe(true);
    expect(p.isUnlocked(STARTER_CAR_ID)).toBe(true);
    // The deeper-achievement cars stay locked (they gain a purchase path in PR2).
    expect(p.isUnlocked('onyx')).toBe(false);
    expect(p.isUnlocked('nova')).toBe(false);
    expect(p.isUnlocked('slipstream')).toBe(false);
    expect(p.getStats()).toEqual({ totalDistance: 0, bestCombo: 0, powerupsCollected: 0, biomesSeen: 0 });
    expect(p.getCredits()).toBe(0);
  });
});

describe('ProgressStore — recordRun accumulates + unlocks a stat-gated car once', () => {
  it('sums distance/powerups, maxes combo/biomes, and flips Onyx exactly once at 75 powerups', () => {
    const p = new ProgressStore(memStorage());
    expect(p.recordRun(run({ powerupsCollected: 70, distance: 1500, bestCombo: 4, biomesSeen: 1 })).newlyUnlocked).toEqual([]);
    expect(p.isUnlocked('onyx')).toBe(false);

    const second = p.recordRun(run({ powerupsCollected: 5, distance: 1500, bestCombo: 3, biomesSeen: 2 }));
    expect(second.newlyUnlocked).toContain('onyx'); // crossed 75
    expect(p.isUnlocked('onyx')).toBe(true);
    expect(p.getStats()).toEqual({ totalDistance: 3000, bestCombo: 4, powerupsCollected: 75, biomesSeen: 2 });

    // A further run does NOT re-announce the already-earned car.
    expect(p.recordRun(run({ distance: 100, bestCombo: 1, biomesSeen: 1 })).newlyUnlocked).toEqual([]);
  });

  it('every car has exactly one unlock entry (table stays in sync with CARS)', () => {
    expect([...CAR_UNLOCKS].map((u) => u.carId).sort()).toEqual(CARS.map((c) => c.id).sort());
  });

  it('Nova unlocks at an ×10 combo; Slipstream at all 4 biomes', () => {
    const p = new ProgressStore(memStorage());
    expect(p.recordRun(run({ bestCombo: 9 })).newlyUnlocked).not.toContain('nova');
    expect(p.recordRun(run({ bestCombo: 10 })).newlyUnlocked).toContain('nova');
    expect(p.recordRun(run({ biomesSeen: 3 })).newlyUnlocked).not.toContain('slipstream');
    expect(p.recordRun(run({ biomesSeen: 4 })).newlyUnlocked).toContain('slipstream');
  });
});

describe('ProgressStore — credits (PROG-1 earn)', () => {
  it('awards per-run credits = floor(score/divisor) + floor(distance/divisor)', () => {
    const p = new ProgressStore(memStorage());
    const r = p.recordRun(run({ score: 5000, distance: 2500 }));
    const expected = Math.floor(5000 / CREDITS.runScoreDivisor) + Math.floor(2500 / CREDITS.runDistanceDivisor);
    expect(r.creditsAwarded).toBe(expected);
    expect(p.getCredits()).toBe(expected);
  });

  it('caps the per-run award (anti-farm)', () => {
    const p = new ProgressStore(memStorage());
    const r = p.recordRun(run({ score: 9_999_999, distance: 9_999_999 }));
    expect(r.creditsAwarded).toBe(CREDITS.runCap);
  });

  it('addCredits accumulates and never drives the balance below 0', () => {
    const p = new ProgressStore(memStorage());
    expect(p.addCredits(CREDITS.raceWin)).toBe(CREDITS.raceWin);
    expect(p.addCredits(40)).toBe(CREDITS.raceWin + 40);
    expect(p.addCredits(-1_000_000)).toBe(0); // clamped, never negative
  });

  it('credits persist across sessions on the same storage', () => {
    const storage = memStorage();
    const a = new ProgressStore(storage);
    a.recordRun(run({ score: 3000, distance: 1000 })); // 30 + 4 = 34
    a.addCredits(50);
    const balance = a.getCredits();
    const b = new ProgressStore(storage); // "next session"
    expect(b.getCredits()).toBe(balance);
  });
});

describe('ProgressStore — persistence + migration', () => {
  it('an unlock earned in one store is present in a fresh store on the same storage', () => {
    const storage = memStorage();
    const a = new ProgressStore(storage);
    a.recordRun(run({ powerupsCollected: 75 }));
    expect(a.isUnlocked('onyx')).toBe(true);
    const b = new ProgressStore(storage);
    expect(b.isUnlocked('onyx')).toBe(true);
  });

  it('a PRE-credits blob migrates: credits 0, starting set present, earned cars + stats kept', () => {
    // Old-format blob: no `version`, no `credits`, ghost earned, some distance.
    const storage = memStorage(JSON.stringify({ stats: { totalDistance: 2600 }, unlocked: ['pulse', 'onyx'] }));
    const p = new ProgressStore(storage);
    expect(p.getCredits()).toBe(0); // not gifted a balance never earned
    expect(p.isUnlocked('onyx')).toBe(true); // earned car kept (monotonic)
    for (const id of STARTING_CAR_IDS) expect(p.isUnlocked(id)).toBe(true); // widened set folded in
    expect(p.getStats().totalDistance).toBe(2600);
  });

  it('unlocks are MONOTONIC — a persisted earned car survives even if stats no longer meet it', () => {
    const storage = memStorage(JSON.stringify({ stats: {}, unlocked: ['pulse', 'nova'] }));
    const p = new ProgressStore(storage);
    expect(p.isUnlocked('nova')).toBe(true);
    expect(p.isUnlocked(STARTER_CAR_ID)).toBe(true);
  });
});

describe('ProgressStore — corruption + storage failure never crash', () => {
  it('a corrupt blob falls back to the starting set + 0 credits', () => {
    const p = new ProgressStore(memStorage('}{ not json'));
    expect(p.isUnlocked(STARTER_CAR_ID)).toBe(true);
    expect(p.isUnlocked('onyx')).toBe(false); // tier-2 still locked
    expect(p.getStats().totalDistance).toBe(0);
    expect(p.getCredits()).toBe(0);
  });

  it('a partial / wrong-typed blob is coerced safely (bad credits → 0)', () => {
    const storage = memStorage(JSON.stringify({ stats: { totalDistance: 'lots' }, unlocked: 'nope', credits: 'rich' }));
    const p = new ProgressStore(storage);
    expect(p.getStats().totalDistance).toBe(0);
    expect(p.getCredits()).toBe(0);
    expect(p.isUnlocked(STARTER_CAR_ID)).toBe(true);
  });

  it('a null storage (private mode) works in memory and never throws', () => {
    const p = new ProgressStore(null);
    expect(() => p.recordRun(run({ score: 3000, distance: 3000, powerupsCollected: 75 }))).not.toThrow();
    expect(p.isUnlocked('onyx')).toBe(true);
    expect(p.getCredits()).toBeGreaterThan(0);
  });

  it('a throwing storage (blocked) is swallowed on both read and write', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    let p!: ProgressStore;
    expect(() => (p = new ProgressStore(throwing))).not.toThrow();
    expect(p.isUnlocked(STARTER_CAR_ID)).toBe(true);
    expect(() => p.recordRun(run({ score: 5000, powerupsCollected: 99 }))).not.toThrow();
    expect(p.getCredits()).toBeGreaterThan(0); // reflected in memory
  });
});
