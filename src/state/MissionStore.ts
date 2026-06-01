/**
 * Persistence for the mission + rank progression. Plain TS — NO three import.
 *
 * Mirrors the Settings/Progress stores' resilience: every storage access is
 * wrapped, so Safari Private Mode / disabled storage / a corrupt blob can NEVER
 * crash the game — it falls back to a fresh Rookie progression (fresh missions)
 * and runs from memory for the session. Storage is injectable for Node tests.
 *
 * The rules live in the pure Missions module; this only loads/validates/persists
 * and delegates `commitRun`.
 */

import {
  MISSIONS_STORAGE_KEY,
  MISSION_ACTIVE_COUNT,
  MISSION_POOL,
  type MissionStats,
} from '../utils/constants';
import {
  commitRun as pureCommitRun,
  createProgressionState,
  isStartBiomeUnlocked,
  rankForCompleted,
  type CommitResult,
  type ProgressionState,
  type RunContribution,
} from './Missions';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function resolveStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function poolHas(id: unknown): id is string {
  return typeof id === 'string' && MISSION_POOL.some((m) => m.id === id);
}

export class MissionStore {
  private data: ProgressionState;
  private readonly storage: StorageLike | null;

  constructor(storage: StorageLike | null = resolveStorage()) {
    this.storage = storage;
    this.data = this.load();
  }

  /** Read-only snapshot of the progression state. */
  state(): Readonly<ProgressionState> {
    return this.data;
  }

  /** Fold a finished run in, persist, and return what completed / ranked up. */
  commitRun(run: RunContribution): CommitResult {
    const result = pureCommitRun(this.data, run);
    this.persist();
    return result;
  }

  /** The selected starting-biome index (cosmetic). */
  startBiome(): number {
    return this.data.startBiome;
  }

  /** Is starting biome `b` unlocked at the current rank? */
  startBiomeUnlocked(b: number): boolean {
    return isStartBiomeUnlocked(b, this.data.rank);
  }

  /** Choose a starting biome — only takes effect (and persists) if unlocked. */
  setStartBiome(b: number): void {
    if (!this.startBiomeUnlocked(b)) return;
    this.data.startBiome = b;
    this.persist();
  }

  private load(): ProgressionState {
    if (!this.storage) return createProgressionState();
    try {
      const raw = this.storage.getItem(MISSIONS_STORAGE_KEY);
      if (!raw) return createProgressionState();
      const parsed = JSON.parse(raw) as Partial<ProgressionState> | null;
      if (!parsed || typeof parsed !== 'object') return createProgressionState();

      const ps = (parsed.stats ?? {}) as Partial<MissionStats>;
      const stats: MissionStats = {
        nearMisses: num(ps.nearMisses),
        powerups: num(ps.powerups),
        shields: num(ps.shields),
        driftSeconds: num(ps.driftSeconds),
        midnightReaches: num(ps.midnightReaches),
        distance: num(ps.distance),
      };

      // Active missions must be a well-formed, correctly-sized list of known
      // pool ids; anything off → fall back to a fresh progression (Rookie).
      const active = parsed.active;
      if (!Array.isArray(active) || active.length !== MISSION_ACTIVE_COUNT) return createProgressionState();
      const validActive = active.map((m) =>
        m && poolHas(m.defId) ? { defId: m.defId, baseline: num(m.baseline), best: num(m.best) } : null,
      );
      if (validActive.some((m) => m === null)) return createProgressionState();

      const completed = num(parsed.completed);
      const poolCursor = num(parsed.poolCursor);
      const rank = rankForCompleted(completed); // never trust a stored rank
      let startBiome = num(parsed.startBiome);
      if (!isStartBiomeUnlocked(startBiome, rank)) startBiome = 0; // locked → default

      return {
        stats,
        active: validActive as ProgressionState['active'],
        completed,
        poolCursor: Math.max(poolCursor, MISSION_ACTIVE_COUNT),
        rank,
        startBiome,
      };
    } catch {
      return createProgressionState();
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(MISSIONS_STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Private mode / quota / blocked — keep the in-memory value only.
    }
  }
}
