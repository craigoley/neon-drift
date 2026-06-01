/**
 * Top-runs leaderboard + per-car bests (OPP-15), persisted to localStorage.
 * Plain TS — NO three import. Replaces the single-best BestStore: the start
 * screen / HUD "BEST" is now derived from the #1 run (`bestRun()`), and the
 * game-over screen gets a PLACEMENT (did this run make the board, and what's the
 * nearest score to chase) to turn "beat one distant best" into "beat your own
 * 2nd / 3rd / best-in-this-car" — closer, more beatable targets.
 *
 * Resilience mirrors the Progress/Settings stores: every storage access is
 * wrapped, so Safari Private Mode / disabled storage / a corrupt blob can NEVER
 * crash the game — it falls back to an empty board and runs from memory for the
 * session. Storage + clock are injectable for deterministic Node tests.
 *
 * MIGRATION: on first load (no leaderboard blob yet), the legacy single-best
 * 'neon-drift.best' value is read and seeded as the first leaderboard entry, so
 * an existing record (e.g. a 56142) survives the upgrade.
 */

import { LEADERBOARD_SIZE, LEADERBOARD_STORAGE_KEY, STORAGE_KEY } from '../utils/constants';

/** A single recorded run on the top-runs board. */
export interface LeaderboardEntry {
  score: number;
  distance: number;
  /** Car the run was driven in. '' for a migrated legacy best (car unknown). */
  carId: string;
  /** Epoch ms the run was recorded; 0 for a migrated legacy best (date unknown). */
  date: number;
}

/** A car's personal best (the score side of the per-car tracking). */
export interface CarBest {
  score: number;
  distance: number;
  date: number;
}

/** Minimal {distance, score} shape the BEST display consumes (was BestStore's
 *  BestRun) — kept so the start screen + HUD readouts are unchanged. */
export interface BestRun {
  distance: number;
  score: number;
}

/** The result of recording a run — drives the game-over placement callouts. */
export interface RunPlacement {
  /** 1-based rank on the board if the run made the top LEADERBOARD_SIZE, else null. */
  rank: number | null;
  /** True if this run set or beat the per-car best for its car. */
  isCarBest: boolean;
  /** The car the run was in (echoed for the "BEST IN <car>" callout). */
  carId: string;
  /** The next-higher run to chase ("just N from #R"). Null if this run is #1. */
  target: { rank: number; score: number; gap: number } | null;
}

/** A finished run handed to submit(). */
export interface RunRecord {
  score: number;
  distance: number;
  carId: string;
}

interface LeaderboardData {
  topRuns: LeaderboardEntry[];
  perCarBest: Record<string, CarBest>;
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

export class LeaderboardStore {
  private data: LeaderboardData;
  private readonly storage: StorageLike | null;
  private readonly now: () => number;

  constructor(
    storage: StorageLike | null = resolveStorage(),
    now: () => number = () => Date.now(),
  ) {
    this.storage = storage;
    this.now = now;
    this.data = this.load();
  }

  /** The #1 run as a {distance, score} for the legacy "BEST" readout (zeros if
   *  the board is empty). */
  bestRun(): BestRun {
    const top = this.data.topRuns[0];
    return top ? { distance: top.distance, score: top.score } : { distance: 0, score: 0 };
  }

  /** The top runs (defensive copy), already sorted by score desc, capped. */
  top(): LeaderboardEntry[] {
    return this.data.topRuns.map((e) => ({ ...e }));
  }

  /** Per-car bests as a list (one row per car with a recorded best), sorted by
   *  score desc — for the leaderboard view's per-car section. */
  perCarBests(): Array<CarBest & { carId: string }> {
    return Object.entries(this.data.perCarBest)
      .map(([carId, b]) => ({ carId, ...b }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Record a finished run: insert it into the top runs (re-sort by score, cap at
   * LEADERBOARD_SIZE), update the per-car best if beaten, persist, and return the
   * run's PLACEMENT (board rank if any, whether it's a car best, and the nearest
   * higher score to chase). Never throws.
   */
  submit(run: RunRecord): RunPlacement {
    const entry: LeaderboardEntry = {
      score: num(run.score),
      distance: num(run.distance),
      carId: run.carId,
      date: this.now(),
    };

    // Insert + sort the full list (desc by score) BEFORE capping, so the entry's
    // true position — and the run directly above it — are known for the callouts.
    const full = [...this.data.topRuns, entry].sort((a, b) => b.score - a.score);
    const idx = full.indexOf(entry);
    const rank = idx < LEADERBOARD_SIZE ? idx + 1 : null;
    const above = idx > 0 ? full[idx - 1] : null;
    const target = above ? { rank: idx, score: above.score, gap: above.score - entry.score } : null;

    this.data.topRuns = full.slice(0, LEADERBOARD_SIZE);

    // Per-car best — only for a real car id (a migrated legacy entry has none).
    let isCarBest = false;
    if (run.carId) {
      const prev = this.data.perCarBest[run.carId];
      if (!prev || entry.score > prev.score) {
        this.data.perCarBest[run.carId] = {
          score: entry.score,
          distance: entry.distance,
          date: entry.date,
        };
        isCarBest = true;
      }
    }

    this.persist();
    return { rank, isCarBest, carId: run.carId, target };
  }

  private load(): LeaderboardData {
    const fresh = (): LeaderboardData => ({ topRuns: [], perCarBest: {} });
    if (!this.storage) return fresh();
    try {
      const raw = this.storage.getItem(LEADERBOARD_STORAGE_KEY);
      // First load after the upgrade: no leaderboard yet → migrate the legacy best.
      if (!raw) return this.migrateLegacyBest(fresh());
      const parsed = JSON.parse(raw) as Partial<LeaderboardData> | null;
      if (!parsed || typeof parsed !== 'object') return this.migrateLegacyBest(fresh());
      const topRuns = Array.isArray(parsed.topRuns)
        ? parsed.topRuns
            .map((e) => this.coerceEntry(e))
            .filter((e): e is LeaderboardEntry => e !== null)
            .sort((a, b) => b.score - a.score)
            .slice(0, LEADERBOARD_SIZE)
        : [];
      const perCarBest: Record<string, CarBest> = {};
      const pcb = (parsed.perCarBest ?? {}) as Record<string, unknown>;
      for (const [carId, v] of Object.entries(pcb)) {
        const b = v as Partial<CarBest>;
        if (carId) perCarBest[carId] = { score: num(b.score), distance: num(b.distance), date: num(b.date) };
      }
      return { topRuns, perCarBest };
    } catch {
      // Corrupt / blocked — fall back to a clean (migrated) board.
      return this.migrateLegacyBest(fresh());
    }
  }

  /** Coerce one persisted entry, dropping anything unusable (returns null). */
  private coerceEntry(e: unknown): LeaderboardEntry | null {
    if (!e || typeof e !== 'object') return null;
    const p = e as Partial<LeaderboardEntry>;
    const score = num(p.score);
    const distance = num(p.distance);
    if (score <= 0 && distance <= 0) return null;
    return { score, distance, carId: typeof p.carId === 'string' ? p.carId : '', date: num(p.date) };
  }

  /** Seed the board from the legacy single-best key ('neon-drift.best') if it
   *  holds a real run, so the existing record survives the OPP-15 upgrade. The
   *  legacy value carries no car id or date (carId '', date 0). */
  private migrateLegacyBest(base: LeaderboardData): LeaderboardData {
    if (!this.storage) return base;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return base;
      const old = JSON.parse(raw) as { score?: unknown; distance?: unknown } | null;
      const score = num(old?.score);
      const distance = num(old?.distance);
      if (score > 0 || distance > 0) {
        base.topRuns = [{ score, distance, carId: '', date: 0 }];
        this.persist(base); // write the migrated board so we don't re-migrate next load
      }
    } catch {
      // Legacy blob missing/corrupt — nothing to migrate.
    }
    return base;
  }

  private persist(data: LeaderboardData = this.data): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Private mode / quota / blocked — keep the in-memory value only.
    }
  }
}
