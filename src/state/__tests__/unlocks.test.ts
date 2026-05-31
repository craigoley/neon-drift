import { describe, expect, it } from 'vitest';
import {
  evaluateUnlockedIds,
  isCarUnlocked,
  unlockProgress,
  unlockRequirementLabel,
} from '../Unlocks';
import { EMPTY_LIFETIME_STATS, STARTER_CAR_ID, type LifetimeStats } from '../../utils/constants';

function stats(partial: Partial<LifetimeStats>): LifetimeStats {
  return { ...EMPTY_LIFETIME_STATS, ...partial };
}

describe('Unlocks — the starter is always available', () => {
  it('the starter unlocks with a completely empty record', () => {
    expect(isCarUnlocked(STARTER_CAR_ID, EMPTY_LIFETIME_STATS)).toBe(true);
    expect(evaluateUnlockedIds(EMPTY_LIFETIME_STATS)).toContain(STARTER_CAR_ID);
  });

  it('an unknown car id is treated as unlocked (never strands the player)', () => {
    expect(isCarUnlocked('does-not-exist', EMPTY_LIFETIME_STATS)).toBe(true);
    expect(unlockRequirementLabel('does-not-exist')).toBeNull();
  });
});

describe('Unlocks — evaluation is correct at the boundary', () => {
  it('vapor needs 2,500m total — locked just below, unlocked at the threshold', () => {
    expect(isCarUnlocked('vapor', stats({ totalDistance: 2499 }))).toBe(false);
    expect(isCarUnlocked('vapor', stats({ totalDistance: 2500 }))).toBe(true);
    expect(isCarUnlocked('vapor', stats({ totalDistance: 9999 }))).toBe(true);
  });

  it('ember needs 30 powerups — boundary exact', () => {
    expect(isCarUnlocked('ember', stats({ powerupsCollected: 29 }))).toBe(false);
    expect(isCarUnlocked('ember', stats({ powerupsCollected: 30 }))).toBe(true);
  });

  it('ghost needs an ×6 combo — boundary exact', () => {
    expect(isCarUnlocked('ghost', stats({ bestCombo: 5.99 }))).toBe(false);
    expect(isCarUnlocked('ghost', stats({ bestCombo: 6 }))).toBe(true);
  });

  it('unlock conditions are independent (one stat does not unlock another car)', () => {
    const onlyDistance = stats({ totalDistance: 10000 });
    expect(isCarUnlocked('vapor', onlyDistance)).toBe(true);
    expect(isCarUnlocked('ember', onlyDistance)).toBe(false);
    expect(isCarUnlocked('ghost', onlyDistance)).toBe(false);
  });

  it('evaluateUnlockedIds returns exactly the met set', () => {
    expect(evaluateUnlockedIds(EMPTY_LIFETIME_STATS)).toEqual([STARTER_CAR_ID]);
    const all = stats({ totalDistance: 3000, powerupsCollected: 50, bestCombo: 8 });
    expect(new Set(evaluateUnlockedIds(all))).toEqual(new Set(['pulse', 'vapor', 'ember', 'ghost']));
  });
});

describe('Unlocks — progress descriptor for the picker', () => {
  it('reports have/need/label for a locked car, clamped to need', () => {
    const p = unlockProgress('vapor', stats({ totalDistance: 1800 }));
    expect(p).toEqual({ have: 1800, need: 2500, label: 'Drive 2,500m total' });
  });

  it('returns null once the car is unlocked', () => {
    expect(unlockProgress('vapor', stats({ totalDistance: 2500 }))).toBeNull();
    expect(unlockProgress(STARTER_CAR_ID, EMPTY_LIFETIME_STATS)).toBeNull();
  });
});
