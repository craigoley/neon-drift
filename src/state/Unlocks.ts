/**
 * Unlock evaluation. PURE — no three, no DOM, fully Node-testable. Given the
 * player's lifetime stats, decides which cars are unlocked. The single source of
 * truth for "is this car available" + the requirement text the picker shows.
 *
 * Kept separate from persistence (Progress.ts) so the rule is trivial to test in
 * isolation against boundary stats.
 */

import { CAR_UNLOCKS, STARTER_CAR_ID, type CarUnlock, type LifetimeStats } from '../utils/constants';

/** The unlock entry for a car id, if any. */
export function carUnlockFor(carId: string): CarUnlock | undefined {
  return CAR_UNLOCKS.find((u) => u.carId === carId);
}

/**
 * Is `carId` unlocked under `stats`? The starter (null condition) and any
 * unknown id are always unlocked, so the picker can never strand the player with
 * nothing to drive.
 */
export function isCarUnlocked(carId: string, stats: LifetimeStats): boolean {
  const u = carUnlockFor(carId);
  if (!u || u.condition === null) return true;
  return stats[u.condition.stat] >= u.condition.atLeast;
}

/** All car ids unlocked under `stats` (always includes the starter). */
export function evaluateUnlockedIds(stats: LifetimeStats): string[] {
  return CAR_UNLOCKS.filter((u) => isCarUnlocked(u.carId, stats)).map((u) => u.carId);
}

/** The requirement label for a locked car (null if it has no condition). */
export function unlockRequirementLabel(carId: string): string | null {
  return carUnlockFor(carId)?.condition?.label ?? null;
}

/** Progress toward a car's unlock for the picker: `{ have, need, label }`, or
 *  null if the car is already unlocked / has no condition. `have` is clamped to
 *  `need` so the readout never shows e.g. 3200/2500. */
export function unlockProgress(
  carId: string,
  stats: LifetimeStats,
): { have: number; need: number; label: string } | null {
  if (isCarUnlocked(carId, stats)) return null;
  const cond = carUnlockFor(carId)?.condition;
  if (!cond) return null;
  return { have: Math.min(stats[cond.stat], cond.atLeast), need: cond.atLeast, label: cond.label };
}

/** Sanity helper: the starter is unlocked even with a completely empty record. */
export function starterId(): string {
  return STARTER_CAR_ID;
}
