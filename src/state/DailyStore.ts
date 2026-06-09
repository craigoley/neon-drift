/**
 * Daily challenge results (OPP-09), persisted to localStorage. Plain TS — NO
 * three import. Tracks, per calendar day, the player's BEST score/distance on
 * that day's fixed seed plus how many times they replayed it, keeping a rolling
 * history of the most-recent DAILY_HISTORY_SIZE days.
 *
 * SEPARATE from the OPP-15 leaderboard by design: a daily run is on a fixed
 * per-date seed and is not comparable to random-seed runs, so daily results
 * never touch the main board (and vice versa) — they live in their own key.
 *
 * Resilience mirrors the Leaderboard/Progress stores: every storage access is
 * wrapped, so blocked/disabled/corrupt storage can NEVER crash the game — it
 * falls back to an empty history and runs from memory for the session. Storage
 * is injectable for deterministic Node tests. The current date is NOT read here
 * — the caller passes today's `dateKey` (from dailyDateKey, local) — so the
 * store stays pure-ish and trivially testable.
 */

import { DAILY_HISTORY_SIZE, DAILY_STORAGE_KEY, SIM_MATH_VERSION } from '../utils/constants';
import { isConsecutiveDay } from '../utils/daily';

/** One day's daily-challenge record (best run on that date's seed + replay count). */
export interface DailyEntry {
  /** Local YYYYMMDD key (see dailyDateKey). */
  dateKey: number;
  bestScore: number;
  bestDistance: number;
  /** Car the best run was driven in ('' if none yet). */
  bestCarId: string;
  /** How many times the player has run this day's challenge. */
  runs: number;
  /** SIM-MATH version the BEST run was produced with (SIM_MATH_VERSION); absent on
   *  pre-versioning entries. The same daily seed produces a DIFFERENT course across
   *  math versions, so an old-version best isn't a like-for-like comparison. */
  mathVersion?: number;
}

/** Returned by submitDaily — drives the game-over daily callout. */
export interface DailyResult {
  /** True if this run set or beat today's best. */
  isBest: boolean;
  /** Today's run count INCLUDING this run. */
  runs: number;
  /** Today's best after this run. */
  bestScore: number;
  bestDistance: number;
  /** True if this is the FIRST run of today (the daily-completion moment — the
   *  credit award fires once per day, not on replays). */
  firstOfDay: boolean;
  /** Consecutive-days streak AFTER this run (≥1 on the first run of a day; on
   *  replays it's the streak already standing for today). PROG-1 credit bonus. */
  streak: number;
}

interface DailyData {
  history: DailyEntry[];
  /** Consecutive-days streak (PROG-1). Advanced on the first run of each new day. */
  streak: number;
  /** The dateKey the streak was last advanced for (to detect the next day). */
  streakDateKey: number;
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

export class DailyStore {
  private data: DailyData;
  private readonly storage: StorageLike | null;

  constructor(storage: StorageLike | null = resolveStorage()) {
    this.storage = storage;
    this.data = this.load();
  }

  /** Today's entry (by dateKey), or null if today hasn't been played yet. */
  today(dateKey: number): DailyEntry | null {
    return this.data.history.find((e) => e.dateKey === dateKey) ?? null;
  }

  /** The rolling history, most-recent day first (defensive copy). */
  history(): DailyEntry[] {
    return this.data.history.map((e) => ({ ...e }));
  }

  /**
   * Record a finished DAILY run for `dateKey`: create today's entry if needed,
   * bump the run count, update the best if this run beat it, prune to the
   * DAILY_HISTORY_SIZE most-recent days, persist, and return the day's result.
   * Never throws.
   */
  submitDaily(dateKey: number, score: number, distance: number, carId: string): DailyResult {
    const s = num(score);
    const d = num(distance);
    let entry = this.data.history.find((e) => e.dateKey === dateKey);
    const firstOfDay = !entry;
    if (!entry) {
      entry = { dateKey, bestScore: 0, bestDistance: 0, bestCarId: '', runs: 0 };
      this.data.history.push(entry);
      // First run of a NEW day → advance the streak (consecutive) or reset to 1.
      this.data.streak = isConsecutiveDay(this.data.streakDateKey, dateKey) ? this.data.streak + 1 : 1;
      this.data.streakDateKey = dateKey;
    }
    entry.runs += 1;
    const isBest = s > entry.bestScore;
    if (isBest) {
      entry.bestScore = s;
      entry.bestDistance = d;
      entry.bestCarId = carId;
      entry.mathVersion = SIM_MATH_VERSION; // stamp the math the best was set under
    }
    // Rolling window: keep the most-recent days by dateKey (prunes older entries).
    this.data.history.sort((a, b) => b.dateKey - a.dateKey);
    this.data.history = this.data.history.slice(0, DAILY_HISTORY_SIZE);
    this.persist();
    return { isBest, runs: entry.runs, bestScore: entry.bestScore, bestDistance: entry.bestDistance, firstOfDay, streak: this.data.streak };
  }

  private load(): DailyData {
    const fresh = (): DailyData => ({ history: [], streak: 0, streakDateKey: 0 });
    if (!this.storage) return fresh();
    try {
      const raw = this.storage.getItem(DAILY_STORAGE_KEY);
      if (!raw) return fresh();
      const parsed = JSON.parse(raw) as Partial<DailyData> | null;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.history)) return fresh();
      const history = parsed.history
        .map((e) => this.coerceEntry(e))
        .filter((e): e is DailyEntry => e !== null)
        .sort((a, b) => b.dateKey - a.dateKey)
        .slice(0, DAILY_HISTORY_SIZE);
      // Streak fields absent on pre-PROG-1 blobs → 0 (next daily starts a fresh streak).
      return { history, streak: num(parsed.streak), streakDateKey: num(parsed.streakDateKey) };
    } catch {
      // Corrupt / blocked — fall back to a clean, empty history.
      return fresh();
    }
  }

  /** Coerce one persisted entry, dropping anything without a usable date key. */
  private coerceEntry(e: unknown): DailyEntry | null {
    if (!e || typeof e !== 'object') return null;
    const p = e as Partial<DailyEntry>;
    const dateKey = num(p.dateKey);
    if (dateKey <= 0) return null;
    return {
      dateKey,
      bestScore: num(p.bestScore),
      bestDistance: num(p.bestDistance),
      bestCarId: typeof p.bestCarId === 'string' ? p.bestCarId : '',
      runs: num(p.runs),
    };
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(DAILY_STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Private mode / quota / blocked — keep the in-memory value only.
    }
  }
}
