/**
 * Persists the RIVAL GHOST recordings — one best run per mode (a classic ghost and
 * a daily/slalom ghost are independent). Mirrors LeaderboardStore/DailyStore:
 * resilient localStorage with an in-memory fallback when storage is blocked
 * (private mode / quota), and defensive parsing that rejects malformed or old-schema
 * blobs rather than throwing. The "win" metric is SCORE — a run replaces the stored
 * ghost only if it out-scores it.
 *
 * Plain TS — no three, no DOM beyond localStorage. The recording shape lives in
 * game/Replay.ts (the pure replay core); this is just storage.
 */

import { GHOST, GHOST_STORAGE_KEY, SIM_MATH_VERSION } from '../utils/constants';
import { GameMode } from '../game/GameState';
import type { GhostRecording } from '../game/Replay';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function resolveStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Per-mode ghost slots. Absent key = no ghost recorded for that mode yet. */
interface GhostData {
  classic?: GhostRecording;
  dailySlalom?: GhostRecording;
}

const MODE_KEYS: Record<GameMode, keyof GhostData> = {
  [GameMode.Classic]: 'classic',
  [GameMode.DailySlalom]: 'dailySlalom',
};

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export class GhostStore {
  private data: GhostData;
  private readonly storage: StorageLike | null;

  constructor(storage: StorageLike | null = resolveStorage()) {
    this.storage = storage;
    this.data = this.load();
  }

  /** The stored ghost for a mode, or null if none. Returns the live reference
   *  (callers only read it); a defensive copy isn't needed since replay never
   *  mutates the recording. */
  get(mode: GameMode): GhostRecording | null {
    return this.data[MODE_KEYS[mode]] ?? null;
  }

  /**
   * Submit a finished run's recording. Stores it as the mode's ghost ONLY if it
   * out-scores the existing one (or there is none). Returns true if it became the
   * new ghost. Never throws.
   */
  submit(rec: GhostRecording): boolean {
    if (!this.valid(rec)) return false;
    const key = MODE_KEYS[rec.mode];
    const current = this.data[key];
    if (current && rec.score <= current.score) return false; // didn't beat the ghost
    this.data[key] = rec;
    this.persist();
    return true;
  }

  /** Structural + range validation of a recording (also used on load). */
  private valid(rec: unknown): rec is GhostRecording {
    if (!rec || typeof rec !== 'object') return false;
    const r = rec as Partial<GhostRecording>;
    return (
      r.v === 1 &&
      // Refuse a ghost from a DIFFERENT sim-math version: it's replayed in lockstep
      // with the live sim, so old math would diverge from its own recorded path. An
      // invalid ghost is simply not raced (graceful — the run just has no rival).
      r.mathVersion === SIM_MATH_VERSION &&
      isFiniteNum(r.seed) &&
      (r.mode === GameMode.Classic || r.mode === GameMode.DailySlalom) &&
      typeof r.carId === 'string' &&
      Array.isArray(r.steers) &&
      r.steers.length <= GHOST.maxFrames &&
      r.steers.every(isFiniteNum) &&
      Array.isArray(r.deployFrames) &&
      r.deployFrames.every(isFiniteNum) &&
      isFiniteNum(r.score) &&
      isFiniteNum(r.distance)
    );
  }

  private load(): GhostData {
    if (!this.storage) return {};
    try {
      const raw = this.storage.getItem(GHOST_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Partial<GhostData> | null;
      if (!parsed || typeof parsed !== 'object') return {};
      const out: GhostData = {};
      if (this.valid(parsed.classic)) out.classic = parsed.classic;
      if (this.valid(parsed.dailySlalom)) out.dailySlalom = parsed.dailySlalom;
      return out;
    } catch {
      return {};
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(GHOST_STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Private mode / quota / blocked — keep the in-memory value only.
    }
  }
}
