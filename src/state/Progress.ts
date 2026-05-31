/**
 * Cross-run progression: lifetime stats + unlocked car ids, persisted to
 * localStorage. Plain TS — NO three import.
 *
 * Resilience mirrors the Settings store: every storage access is wrapped, so
 * Safari Private Mode / disabled storage / a corrupt blob can NEVER crash the
 * game — it falls back to "only the starter unlocked, zero stats" and runs from
 * memory for the session. Storage is injectable for Node tests.
 *
 * Unlocks are MONOTONIC: the persisted unlocked set is unioned with a fresh
 * evaluation of the (possibly migrated) stats on load, and `recordRun` only ever
 * adds ids — a player never loses a car they earned, even if thresholds change.
 */

import {
  EMPTY_LIFETIME_STATS,
  PROGRESS_STORAGE_KEY,
  STARTER_CAR_ID,
  type LifetimeStats,
} from '../utils/constants';
import { evaluateUnlockedIds, isCarUnlocked } from './Unlocks';

/** The numbers a finished run contributes to the lifetime totals. */
export interface RunResult {
  /** Distance driven this run (added to the cumulative total). */
  distance: number;
  /** Peak combo this run (raises the lifetime best). */
  bestCombo: number;
  /** Powerups collected this run (added to the lifetime total). */
  powerupsCollected: number;
  /** Distinct biomes seen this run (raises the lifetime best). */
  biomesSeen: number;
}

interface ProgressData {
  stats: LifetimeStats;
  unlocked: string[];
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function resolveStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Coerce an unknown value to a finite, non-negative number (else 0). */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

export class ProgressStore {
  private data: ProgressData;
  private readonly storage: StorageLike | null;

  constructor(storage: StorageLike | null = resolveStorage()) {
    this.storage = storage;
    this.data = this.load();
  }

  /** Read-only snapshot of the lifetime stats. */
  getStats(): Readonly<LifetimeStats> {
    return this.data.stats;
  }

  /** Is a car currently unlocked (from the persisted set)? */
  isUnlocked(carId: string): boolean {
    return this.data.unlocked.includes(carId);
  }

  /** The full set of unlocked car ids (defensive copy). */
  unlockedIds(): string[] {
    return [...this.data.unlocked];
  }

  /**
   * Fold a finished run into the lifetime totals, re-evaluate unlocks, persist,
   * and return the ids unlocked FOR THE FIRST TIME by this run (so a celebration
   * fires exactly once). Never throws.
   */
  recordRun(run: RunResult): { newlyUnlocked: string[] } {
    const prev = new Set(this.data.unlocked);
    const s = this.data.stats;
    s.totalDistance += num(run.distance);
    s.bestCombo = Math.max(s.bestCombo, num(run.bestCombo));
    s.powerupsCollected += num(run.powerupsCollected);
    s.biomesSeen = Math.max(s.biomesSeen, num(run.biomesSeen));

    const nowUnlocked = evaluateUnlockedIds(s);
    const newlyUnlocked = nowUnlocked.filter((id) => !prev.has(id));
    // Monotonic union — never drop an already-earned id.
    this.data.unlocked = Array.from(new Set([...this.data.unlocked, ...nowUnlocked]));
    this.persist();
    return { newlyUnlocked };
  }

  private load(): ProgressData {
    const fresh = (): ProgressData => ({
      stats: { ...EMPTY_LIFETIME_STATS },
      unlocked: [STARTER_CAR_ID],
    });
    if (!this.storage) return this.reconcile(fresh());
    try {
      const raw = this.storage.getItem(PROGRESS_STORAGE_KEY);
      if (!raw) return this.reconcile(fresh());
      const parsed = JSON.parse(raw) as Partial<ProgressData> | null;
      if (!parsed || typeof parsed !== 'object') return this.reconcile(fresh());
      const ps = (parsed.stats ?? {}) as Partial<LifetimeStats>;
      const stats: LifetimeStats = {
        totalDistance: num(ps.totalDistance),
        bestCombo: num(ps.bestCombo),
        powerupsCollected: num(ps.powerupsCollected),
        biomesSeen: num(ps.biomesSeen),
      };
      const unlocked = Array.isArray(parsed.unlocked)
        ? parsed.unlocked.filter((id): id is string => typeof id === 'string')
        : [];
      return this.reconcile({ stats, unlocked });
    } catch {
      // Corrupt / blocked — fall back to a clean starter-only record.
      return this.reconcile(fresh());
    }
  }

  /** Guarantee the starter is present and fold in any unlocks the stats already
   *  satisfy (self-heals after a threshold change or a partial blob). */
  private reconcile(data: ProgressData): ProgressData {
    const union = new Set<string>(data.unlocked);
    union.add(STARTER_CAR_ID);
    for (const id of evaluateUnlockedIds(data.stats)) union.add(id);
    // Drop any id that isn't actually unlockable-by-stats AND isn't the starter?
    // No — keep unknown/earned ids (monotonic); only ensure starter + earned.
    data.unlocked = [...union];
    return data;
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Private mode / quota / blocked — keep the in-memory value only.
    }
  }
}

/** Convenience re-export so callers can ask "is this unlocked" without a store
 *  (e.g. against a stats snapshot). */
export { isCarUnlocked };
