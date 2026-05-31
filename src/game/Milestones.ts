/**
 * Distance milestones + per-run objectives. PURE — no three, no DOM.
 *
 * A small progress layer over the run: fixed distance thresholds fire one-shot
 * celebratory rewards (a free shield, a score bump…) through the EXISTING
 * powerup/score hooks — `updateMilestones` just calls `grantPowerup` or adds to
 * the score, the same seams a collected pickup or a ramp uses, so there is no
 * new reward special-casing. Biome changes get their own celebration, detected
 * from the biome system advancing rather than a hardcoded distance. Objectives
 * count existing per-step events (near-miss / pickup / ramp) and latch once.
 *
 * Everything here is deterministic and mutated in place (no per-frame
 * allocation), matching the rest of the pure layer.
 */

import { MILESTONES, OBJECTIVES, type ObjectiveId } from '../utils/constants';
import { grantPowerup, type PowerupEffects } from './Powerups';
import type { ScoreState, TrafficEvents } from './Scoring';

export interface MilestoneState {
  /** Index of the next distance milestone not yet reached (0..MILESTONES.length). */
  nextIndex: number;
  /** Last biome index observed — a change signals a new-biome celebration. */
  lastBiomeFrom: number;
  /** Per-run objective progress counters, keyed by objective id. */
  progress: Record<ObjectiveId, number>;
  /** Which objectives have already completed (latched — they fire exactly once). */
  done: Record<ObjectiveId, boolean>;
}

export function createMilestoneState(): MilestoneState {
  return {
    nextIndex: 0,
    lastBiomeFrom: 0,
    progress: { nearMiss: 0, collect: 0, ramp: 0 },
    done: { nearMiss: false, collect: false, ramp: false },
  };
}

/** Target for an objective id (from config; constant-size lookup). */
function targetOf(id: ObjectiveId): number {
  for (const o of OBJECTIVES) if (o.id === id) return o.target;
  return Infinity;
}

/** Accumulate progress for one objective and latch + announce on completion. */
function bumpObjective(ms: MilestoneState, id: ObjectiveId, inc: number, events: TrafficEvents): void {
  if (inc <= 0 || ms.done[id]) return;
  ms.progress[id] += inc;
  if (ms.progress[id] >= targetOf(id)) {
    ms.done[id] = true;
    const o = OBJECTIVES.find((x) => x.id === id);
    if (o) events.objectiveDone = o.label;
  }
}

/**
 * Advance milestones + objectives for this step. Call from GameState.update
 * AFTER distance, biome and the traffic/pickup events for the step are resolved.
 * Applies any rewards in place and writes the celebratory signals onto `events`
 * (milestone / biomeChanged / objectiveDone) for the presentation layer.
 *
 * Distance milestones fire IN ORDER, each exactly once — a single large step
 * that crosses several thresholds fires them all (the while-loop), and once
 * `nextIndex` passes a threshold it can never re-fire.
 */
export function updateMilestones(
  ms: MilestoneState,
  distance: number,
  biomeFrom: number,
  effects: PowerupEffects,
  score: ScoreState,
  events: TrafficEvents,
): void {
  // Distance milestones (sorted ascending): grant each crossed threshold once.
  while (ms.nextIndex < MILESTONES.length && distance >= MILESTONES[ms.nextIndex].distance) {
    const m = MILESTONES[ms.nextIndex];
    if (m.reward.kind === 'powerup') grantPowerup(effects, m.reward.powerup);
    else score.score += m.reward.amount;
    events.milestone = m.label; // last one this step wins the toast
    ms.nextIndex++;
  }

  // Biome celebration: fire once each time the active biome index advances.
  if (biomeFrom !== ms.lastBiomeFrom) {
    ms.lastBiomeFrom = biomeFrom;
    events.biomeChanged = true;
  }

  // Objectives: count this step's events; latch + announce on completion.
  bumpObjective(ms, 'nearMiss', events.nearMisses, events);
  bumpObjective(ms, 'collect', events.collected ? 1 : 0, events);
  bumpObjective(ms, 'ramp', events.rampBoosts ?? 0, events);
}
