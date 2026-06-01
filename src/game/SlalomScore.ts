/**
 * Daily Slalom scoring (Daily Slalom PR 2). PURE — no three, no DOM. Event-driven
 * (per gate threaded), NOT the classic continuous distance×combo integral:
 *
 *   gatePoints = base × accuracyBonus × cleanMultiplier
 *
 * - accuracyBonus rewards a centred thread (1.0 at the opening edge → 1+max
 *   dead-centre).
 * - cleanMultiplier is the DOMINANT term: it climbs per consecutive clean gate
 *   (capped) and RESETS on a miss, so a long clean streak is what really scores.
 *
 * Kept entirely separate from the classic ScoreState (which is untouched). The
 * composition root submits this score to the daily store at run-end.
 */

import { clamp } from '../utils/math';
import { DAILY_SCORING } from '../utils/constants';

export interface SlalomScoreState {
  /** Running daily score (sum of gatePoints). */
  score: number;
  /** Current clean-streak multiplier (>= cleanStart, <= cleanMax). */
  cleanMultiplier: number;
  /** Gates threaded this run (telemetry / HUD). */
  gatesThreaded: number;
}

export function createSlalomScoreState(): SlalomScoreState {
  return { score: 0, cleanMultiplier: DAILY_SCORING.cleanStart, gatesThreaded: 0 };
}

/** Accuracy bonus for a thread's centeredness (0 edge → 1 dead-centre): 1.0 at the
 *  edge, 1+accuracyMaxBonus dead-centre. Pure; clamps its input. */
export function accuracyBonus(centeredness: number): number {
  return 1 + DAILY_SCORING.accuracyMaxBonus * clamp(centeredness, 0, 1);
}

/** Outcome of threading one gate — drives feedback in the composition root. */
export interface GateThreadResult {
  /** Points awarded for this gate. */
  points: number;
  /** The accuracy bonus applied (1.0 edge → max dead-centre) — feedback brightness. */
  accuracyBonus: number;
  /** True if this gate pushed cleanMultiplier across a milestone tier — the rare,
   *  earned escalation cue (the feedback layer reacts loudly). */
  milestone: boolean;
}

/**
 * Score one cleanly-threaded gate: award base × accuracyBonus × cleanMultiplier at
 * the CURRENT multiplier, then climb the multiplier (capped) for the next gate.
 * Mutates + returns the outcome. Pure.
 */
export function threadGate(state: SlalomScoreState, centeredness: number): GateThreadResult {
  const bonus = accuracyBonus(centeredness);
  const points = DAILY_SCORING.base * bonus * state.cleanMultiplier;
  state.score += points;
  state.gatesThreaded += 1;

  const prev = state.cleanMultiplier;
  const next = Math.min(prev + DAILY_SCORING.cleanStep, DAILY_SCORING.cleanMax);
  state.cleanMultiplier = next;
  // A milestone is crossed when the streak passes a multiple of milestoneStep.
  const milestone =
    Math.floor(next / DAILY_SCORING.milestoneStep) > Math.floor(prev / DAILY_SCORING.milestoneStep);

  return { points, accuracyBonus: bonus, milestone };
}

/** A miss breaks the clean streak — cleanMultiplier resets to its floor. (Score
 *  already banked is kept.) Pure. */
export function missGate(state: SlalomScoreState): void {
  state.cleanMultiplier = DAILY_SCORING.cleanStart;
}
