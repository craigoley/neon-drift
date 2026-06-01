/**
 * Across-run mission + rank progression. PURE — no three, no DOM, fully
 * Node-testable. Owns the rules; persistence (MissionStore) is a thin wrapper.
 *
 * LAYERED, NEVER GATED: nothing here can block the core run. Rewards are
 * cosmetic/optional only (titles + an optional starting-biome visual). Missions
 * accrue across runs; a finished run's contribution is folded in by `commitRun`,
 * which completes any met missions (exactly once), rotates fresh ones in from the
 * pool (wrapping → endless), and advances the rank.
 */

import {
  EMPTY_MISSION_STATS,
  MISSION_ACTIVE_COUNT,
  MISSION_POOL,
  RANKS,
  type MissionDef,
  type MissionStats,
} from '../utils/constants';

/** One active mission instance: which def, the counter baseline when it became
 *  active (cumulative missions), and the best single-run value seen (perRun). */
export interface ActiveMission {
  defId: string;
  baseline: number;
  best: number;
}

export interface ProgressionState {
  stats: MissionStats;
  active: ActiveMission[];
  /** Total missions completed across all time (drives rank). */
  completed: number;
  /** Next index into MISSION_POOL to draw (wraps). */
  poolCursor: number;
  /** Current rank index (derived from `completed`, cached for the UI). */
  rank: number;
  /** Selected starting biome (cosmetic visual; 0 = default/Sunset). */
  startBiome: number;
}

/** The numbers a finished run contributes. */
export interface RunContribution {
  nearMisses: number;
  powerups: number;
  shields: number;
  driftSeconds: number;
  distance: number;
  score: number;
  /** True if the run drove far enough to reveal the Midnight biome. */
  reachedMidnight: boolean;
}

export interface CommitResult {
  /** Labels of missions completed this commit (for the wipeout celebration). */
  completedMissions: string[];
  /** Names of ranks newly reached this commit. */
  rankUps: string[];
  /** Reward titles/biome-unlock labels earned this commit. */
  unlocked: string[];
}

function defById(id: string): MissionDef | undefined {
  return MISSION_POOL.find((m) => m.id === id);
}

/** Highest rank whose mission requirement is met by `completed`. */
export function rankForCompleted(completed: number): number {
  let rank = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (completed >= RANKS[i].missionsRequired) rank = i;
  }
  return rank;
}

/** Snapshot the baseline for a freshly-activated mission (the current counter for
 *  a cumulative metric; perRun missions don't use it). */
function baselineFor(def: MissionDef, stats: MissionStats): number {
  return def.kind === 'cumulative' ? stats[def.metric] : 0;
}

/** Make the active mission instance for a pool index. */
function activate(poolIndex: number, stats: MissionStats): ActiveMission {
  const def = MISSION_POOL[poolIndex % MISSION_POOL.length];
  return { defId: def.id, baseline: baselineFor(def, stats), best: 0 };
}

/** Fresh progression: zeroed stats, the first MISSION_ACTIVE_COUNT missions, Rookie. */
export function createProgressionState(): ProgressionState {
  const stats = { ...EMPTY_MISSION_STATS };
  const active: ActiveMission[] = [];
  for (let i = 0; i < MISSION_ACTIVE_COUNT; i++) active.push(activate(i, stats));
  return { stats, active, completed: 0, poolCursor: MISSION_ACTIVE_COUNT, rank: 0, startBiome: 0 };
}

/** Current progress toward an active mission, clamped to its target. */
export function missionProgress(
  m: ActiveMission,
  stats: MissionStats,
): { label: string; have: number; need: number; done: boolean } {
  const def = defById(m.defId);
  if (!def) return { label: '—', have: 0, need: 1, done: false };
  const raw = def.kind === 'cumulative' ? stats[def.metric] - m.baseline : m.best;
  const have = Math.max(0, Math.min(raw, def.target));
  return { label: def.label, have, need: def.target, done: have >= def.target };
}

/** Is a mission complete given the run + updated stats? */
function isComplete(m: ActiveMission, stats: MissionStats): boolean {
  const def = defById(m.defId);
  if (!def) return false;
  const value = def.kind === 'cumulative' ? stats[def.metric] - m.baseline : m.best;
  return value >= def.target;
}

/**
 * Fold a finished run into the progression: accumulate stats, complete any met
 * missions (replacing each with a fresh one from the pool), and advance rank.
 * Mutates and returns events. Pure (given the state); deterministic.
 */
export function commitRun(state: ProgressionState, run: RunContribution): CommitResult {
  const prevRank = state.rank;
  const s = state.stats;
  s.nearMisses += Math.max(0, run.nearMisses);
  s.powerups += Math.max(0, run.powerups);
  s.shields += Math.max(0, run.shields);
  s.driftSeconds += Math.max(0, run.driftSeconds);
  s.distance += Math.max(0, run.distance);
  if (run.reachedMidnight) s.midnightReaches += 1;

  // Update perRun "best" for the active missions from THIS run's value.
  for (const m of state.active) {
    const def = defById(m.defId);
    if (def && def.kind === 'perRun') {
      const v = def.metric === 'score' ? run.score : run.distance;
      m.best = Math.max(m.best, v);
    }
  }

  // Evaluate the (pre-refill) slots once, then refill the completed ones, so a
  // single run completes at most MISSION_ACTIVE_COUNT missions (no cascade).
  const completedMissions: string[] = [];
  for (let i = 0; i < state.active.length; i++) {
    if (isComplete(state.active[i], s)) {
      const def = defById(state.active[i].defId);
      if (def) completedMissions.push(def.label);
      state.completed += 1;
      state.active[i] = activate(state.poolCursor, s);
      state.poolCursor += 1;
    }
  }

  // Advance rank + collect the rewards crossed this commit.
  state.rank = rankForCompleted(state.completed);
  const rankUps: string[] = [];
  const unlocked: string[] = [];
  for (let r = prevRank + 1; r <= state.rank; r++) {
    rankUps.push(RANKS[r].name);
    if (RANKS[r].reward.startBiome !== undefined) {
      unlocked.push(`Start in ${biomeRewardName(r)}`);
    }
  }

  return { completedMissions, rankUps, unlocked };
}

/** Human label for a rank's starting-biome reward (index → name lives in the UI
 *  layer's biome list; here we just describe by rank). */
function biomeRewardName(rank: number): string {
  // The biome index → display name is owned by the rendering/UI layer; for the
  // celebration we use a stable rank-keyed label.
  const byRank: Record<number, string> = { 1: 'Midnight', 2: 'Toxic', 3: 'Dawn' };
  return byRank[rank] ?? 'a new biome';
}

/** Is starting in biome index `b` unlocked at `rank`? Sunset (0) is always on. */
export function isStartBiomeUnlocked(b: number, rank: number): boolean {
  if (b === 0) return true;
  for (let r = 0; r <= rank && r < RANKS.length; r++) {
    if (RANKS[r].reward.startBiome === b) return true;
  }
  return false;
}

/** The rank index that unlocks starting biome `b` (for the picker's "Rank: …"
 *  requirement), or null if it's always available / never offered. */
export function startBiomeUnlockRank(b: number): number | null {
  if (b === 0) return null;
  for (let r = 0; r < RANKS.length; r++) if (RANKS[r].reward.startBiome === b) return r;
  return null;
}
