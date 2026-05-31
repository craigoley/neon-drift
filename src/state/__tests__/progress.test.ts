import { describe, expect, it } from 'vitest';
import { ProgressStore } from '../Progress';
import { PROGRESS_STORAGE_KEY, STARTER_CAR_ID } from '../../utils/constants';

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

describe('ProgressStore — fresh player', () => {
  it('starts with only the starter unlocked and zeroed stats', () => {
    const p = new ProgressStore(memStorage());
    expect(p.isUnlocked(STARTER_CAR_ID)).toBe(true);
    expect(p.isUnlocked('vapor')).toBe(false);
    expect(p.getStats()).toEqual({ totalDistance: 0, bestCombo: 0, powerupsCollected: 0, biomesSeen: 0 });
  });
});

describe('ProgressStore — recordRun accumulates + unlocks once', () => {
  it('sums distance/powerups, maxes combo/biomes, and flips an unlock exactly once', () => {
    const p = new ProgressStore(memStorage());

    // Two short runs accumulate toward the 2,500m vapor gate.
    expect(p.recordRun({ distance: 1500, bestCombo: 4, powerupsCollected: 10, biomesSeen: 1 }).newlyUnlocked).toEqual(
      [],
    );
    expect(p.isUnlocked('vapor')).toBe(false);

    const second = p.recordRun({ distance: 1500, bestCombo: 3, powerupsCollected: 5, biomesSeen: 2 });
    expect(second.newlyUnlocked).toContain('vapor'); // crossed 3000 ≥ 2500
    expect(p.isUnlocked('vapor')).toBe(true);

    // Stats: distance summed, combo is the MAX (4, not 3), powerups summed, biomes max.
    expect(p.getStats()).toEqual({ totalDistance: 3000, bestCombo: 4, powerupsCollected: 15, biomesSeen: 2 });

    // A further run does NOT re-announce the already-earned car.
    expect(p.recordRun({ distance: 100, bestCombo: 1, powerupsCollected: 0, biomesSeen: 1 }).newlyUnlocked).toEqual(
      [],
    );
  });

  it('best combo unlocks ghost the moment it is reached', () => {
    const p = new ProgressStore(memStorage());
    expect(p.recordRun({ distance: 100, bestCombo: 6, powerupsCollected: 0, biomesSeen: 1 }).newlyUnlocked).toContain(
      'ghost',
    );
    expect(p.isUnlocked('ghost')).toBe(true);
  });
});

describe('ProgressStore — persistence round-trips across sessions', () => {
  it('an unlock earned in one store is present in a fresh store on the same storage', () => {
    const storage = memStorage();
    const a = new ProgressStore(storage);
    a.recordRun({ distance: 2600, bestCombo: 2, powerupsCollected: 0, biomesSeen: 1 });
    expect(a.isUnlocked('vapor')).toBe(true);

    const b = new ProgressStore(storage); // "next session"
    expect(b.isUnlocked('vapor')).toBe(true);
    expect(b.getStats().totalDistance).toBe(2600);
  });

  it('unlocks are MONOTONIC — a persisted earned car survives even if stats no longer meet it', () => {
    // Hand-craft a blob: ghost in the unlocked set, but zero stats (e.g. thresholds raised later).
    const storage = memStorage(JSON.stringify({ stats: {}, unlocked: ['pulse', 'ghost'] }));
    const p = new ProgressStore(storage);
    expect(p.isUnlocked('ghost')).toBe(true);
    expect(p.isUnlocked(STARTER_CAR_ID)).toBe(true);
  });
});

describe('ProgressStore — corruption + storage failure never crash', () => {
  it('a corrupt blob falls back to starter-only', () => {
    const p = new ProgressStore(memStorage('}{ not json'));
    expect(p.isUnlocked(STARTER_CAR_ID)).toBe(true);
    expect(p.isUnlocked('vapor')).toBe(false);
    expect(p.getStats().totalDistance).toBe(0);
  });

  it('a partial / wrong-typed blob is coerced safely', () => {
    const storage = memStorage(JSON.stringify({ stats: { totalDistance: 'lots', bestCombo: null }, unlocked: 'nope' }));
    const p = new ProgressStore(storage);
    expect(p.getStats().totalDistance).toBe(0); // bad type → 0
    expect(p.isUnlocked(STARTER_CAR_ID)).toBe(true); // unlocked coerced to [starter]
  });

  it('a null storage (private mode) works in memory and never throws', () => {
    const p = new ProgressStore(null);
    expect(() => p.recordRun({ distance: 3000, bestCombo: 7, powerupsCollected: 40, biomesSeen: 3 })).not.toThrow();
    expect(p.isUnlocked('vapor')).toBe(true);
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
    expect(() => p.recordRun({ distance: 5000, bestCombo: 9, powerupsCollected: 99, biomesSeen: 4 })).not.toThrow();
    expect(p.isUnlocked('vapor')).toBe(true); // still reflected in memory
  });
});
