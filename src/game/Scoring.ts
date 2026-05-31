/**
 * Score, speed bonus and combo multiplier. PURE and deterministic.
 */

import { clamp } from '../utils/math';
import { SCORING } from '../utils/constants';

export interface ScoreState {
  /** Accumulated score. */
  score: number;
  /** Current combo multiplier, >= 1. */
  multiplier: number;
}

export function createScoreState(): ScoreState {
  return { score: 0, multiplier: 1 };
}

/**
 * Award score for `distanceDelta` world-units travelled this step, scaled by the
 * current multiplier. Returns a new state — never mutates the input.
 */
export function addDistance(state: ScoreState, distanceDelta: number): ScoreState {
  return {
    ...state,
    score: state.score + distanceDelta * SCORING.distanceFactor * state.multiplier,
  };
}

/** Increase the multiplier when an obstacle is cleanly passed, up to the cap. */
export function incrementMultiplier(state: ScoreState): ScoreState {
  return {
    ...state,
    multiplier: clamp(state.multiplier + SCORING.multiplierStep, 1, SCORING.maxMultiplier),
  };
}

/** Reset the multiplier to 1 (e.g. on a collision). */
export function resetMultiplier(state: ScoreState): ScoreState {
  return { ...state, multiplier: 1 };
}
