import { describe, expect, it } from 'vitest';
import {
  commitRun,
  createProgressionState,
  isStartBiomeUnlocked,
  missionProgress,
  rankForCompleted,
  startBiomeUnlockRank,
  type RunContribution,
} from '../Missions';
import { MISSION_ACTIVE_COUNT, RANKS } from '../../utils/constants';

function noRun(): RunContribution {
  return { nearMisses: 0, powerups: 0, shields: 0, slowMosDeployed: 0, distance: 0, score: 0, reachedMidnight: false };
}

describe('Missions — fresh progression', () => {
  it('starts at Rookie with the first 3 missions active', () => {
    const s = createProgressionState();
    expect(s.active).toHaveLength(MISSION_ACTIVE_COUNT);
    expect(s.active.map((m) => m.defId)).toEqual(['nm25', 'pu15', 'sh5']);
    expect(s.completed).toBe(0);
    expect(s.rank).toBe(0);
    expect(s.startBiome).toBe(0);
  });
});

describe('Missions — completion fires once + replaces the mission', () => {
  it('completes a mission exactly at its threshold and rotates a fresh one in', () => {
    const s = createProgressionState();
    // 24 near-misses: not yet (threshold 25).
    const r0 = commitRun(s, { ...noRun(), nearMisses: 24 });
    expect(r0.completedMissions).toEqual([]);
    expect(s.active[0].defId).toBe('nm25');

    // One more crosses 25 → completes once, replaced by the next pool entry.
    const r1 = commitRun(s, { ...noRun(), nearMisses: 1 });
    expect(r1.completedMissions).toEqual(['Thread 25 near-misses']);
    expect(s.completed).toBe(1);
    expect(s.active[0].defId).toBe('sm5'); // pool[3]

    // Further near-misses do NOT re-complete the (now replaced) mission.
    const r2 = commitRun(s, { ...noRun(), nearMisses: 100 });
    expect(r2.completedMissions).toEqual([]);
  });

  it('a cumulative mission tracks from its activation baseline ("do N more")', () => {
    const s = createProgressionState();
    commitRun(s, { ...noRun(), nearMisses: 25 }); // nm25 done → sm5 active (baseline 0)
    // sm5 needs 5 MORE slow-mo deploys from now.
    const prog = missionProgress(s.active[0], s.stats);
    expect(prog.label).toBe('Deploy 5 slow-mos');
    expect(prog.have).toBe(0);
    expect(prog.need).toBe(5);
  });
});

describe('Missions — rank advances across mission-set boundaries (rewards once)', () => {
  it('completing 3 missions in one run reaches Cruiser and grants its reward once', () => {
    const s = createProgressionState();
    // The 3 active missions are nm25 / pu15 / sh5 — satisfy all in one run.
    const r = commitRun(s, { ...noRun(), nearMisses: 25, powerups: 15, shields: 5 });
    expect(r.completedMissions).toHaveLength(3);
    expect(s.completed).toBe(3);
    expect(s.rank).toBe(1);
    expect(r.rankUps).toEqual(['Cruiser']);
    expect(r.unlocked).toEqual(['Start in Midnight']);

    // A subsequent run that completes nothing does NOT re-grant the rank/reward.
    const r2 = commitRun(s, noRun());
    expect(r2.rankUps).toEqual([]);
    expect(r2.unlocked).toEqual([]);
  });

  it('rankForCompleted maps mission counts to the ladder', () => {
    expect(rankForCompleted(0)).toBe(0);
    expect(rankForCompleted(2)).toBe(0);
    expect(rankForCompleted(3)).toBe(1);
    expect(rankForCompleted(8)).toBe(2);
    expect(rankForCompleted(12)).toBe(RANKS.length - 1);
    expect(rankForCompleted(999)).toBe(RANKS.length - 1); // capped at Legend
  });
});

describe('Missions — per-run missions complete on a single run value', () => {
  it('a "score N in one run" mission completes when a run hits the mark', () => {
    const s = createProgressionState();
    // Clear the first 3 → active becomes [sm5, mid3, run6k].
    commitRun(s, { ...noRun(), nearMisses: 25, powerups: 15, shields: 5 });
    expect(s.active.map((m) => m.defId)).toEqual(['sm5', 'mid3', 'run6k']);

    // A run scoring 6,000 completes the per-run mission; a 5,999 run would not.
    const r = commitRun(s, { ...noRun(), score: 6000 });
    expect(r.completedMissions).toContain('Score 6,000 in one run');
  });
});

describe('Missions — starting-biome unlock (cosmetic gating only)', () => {
  it('Sunset is always unlocked; later biomes need their rank', () => {
    expect(isStartBiomeUnlocked(0, 0)).toBe(true);
    expect(isStartBiomeUnlocked(1, 0)).toBe(false); // Midnight needs Cruiser
    expect(isStartBiomeUnlocked(1, 1)).toBe(true);
    expect(isStartBiomeUnlocked(2, 1)).toBe(false); // Toxic needs Time Bender
    expect(isStartBiomeUnlocked(2, 2)).toBe(true);
    expect(startBiomeUnlockRank(1)).toBe(1);
    expect(startBiomeUnlockRank(0)).toBeNull();
  });
});

describe('Missions — no NaN / negative inputs are clamped', () => {
  it('negative or garbage run contributions never corrupt the stats', () => {
    const s = createProgressionState();
    commitRun(s, { ...noRun(), nearMisses: -50, powerups: -10, distance: -100 });
    expect(s.stats.nearMisses).toBe(0);
    expect(s.stats.powerups).toBe(0);
    expect(s.stats.distance).toBe(0);
    expect(Number.isFinite(s.stats.slowMosDeployed)).toBe(true);
  });
});
