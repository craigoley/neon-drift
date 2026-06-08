/**
 * Pure 2P-race decision logic (MP-1 PR3-pt2). No DOM, no WebRTC — fully unit-testable.
 *
 * The winner is decided in SHARED SIM TIME: both peers simulate both cars in lockstep,
 * so each computes the identical "finish frame per car" and feeds it here. The result
 * is therefore agreed BY CONSTRUCTION — it is never a local UI check or a network race.
 */

export type RaceRole = 'host' | 'join';
export type RaceWinner = RaceRole | 'draw';
export type RaceResult = 'win' | 'lose' | 'draw';

/**
 * Decide the winner from each car's finish frame (the lowest sim frame at which its
 * distance reached the finish; -1 = not yet finished) plus their distances at the
 * deciding frame for the tiebreak. Deterministic: identical inputs → identical winner
 * on both peers.
 *
 * - Lower finish frame wins (crossed first in shared sim time).
 * - Same frame (a dead heat): the car FURTHER past the line wins; exact tie → host
 *   (a fixed, arbitrary-but-deterministic rule). Both peers compute this identically.
 */
export function decideWinner(hostFinishFrame: number, joinFinishFrame: number, hostDistance: number, joinDistance: number): RaceWinner {
  const hostDone = hostFinishFrame >= 0;
  const joinDone = joinFinishFrame >= 0;
  if (!hostDone && !joinDone) return 'draw'; // shouldn't be asked, but safe
  if (hostDone && !joinDone) return 'host';
  if (joinDone && !hostDone) return 'join';
  // Both finished — compare frames, then distance, then the fixed rule.
  if (hostFinishFrame < joinFinishFrame) return 'host';
  if (joinFinishFrame < hostFinishFrame) return 'join';
  if (hostDistance > joinDistance) return 'host';
  if (joinDistance > hostDistance) return 'join';
  return 'host'; // exact dead heat → fixed deterministic tiebreak
}

/** Map the (peer-symmetric) winner to THIS peer's perspective. */
export function resultFor(winner: RaceWinner, isHost: boolean): RaceResult {
  if (winner === 'draw') return 'draw';
  const localRole: RaceRole = isHost ? 'host' : 'join';
  return winner === localRole ? 'win' : 'lose';
}

/**
 * Whether the LOCAL car leads, with a deadband so a gap jittering around zero doesn't
 * flip the leader (which would spam the overtake alert). The lead only flips once the
 * other car is ahead by more than `deadband`.
 *
 * @param gap localDistance - rivalDistance (positive = local ahead)
 */
export function leadWithDeadband(prevLocalLeads: boolean, gap: number, deadband: number): boolean {
  if (gap > deadband) return true; // local clearly ahead
  if (gap < -deadband) return false; // rival clearly ahead
  return prevLocalLeads; // inside the deadband → hold the current leader
}

/**
 * A car's fraction of the way to the finish, clamped to [0, 1] — the position of its
 * marker on the finish-progress bar. Pure: both peers place both markers identically.
 */
export function finishProgress(distance: number, finishDistance: number): number {
  if (finishDistance <= 0) return 0;
  const t = distance / finishDistance;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
