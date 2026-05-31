/**
 * Scoring, combo multiplier, near-miss and collision detection. PURE — no three.
 *
 * score = integral(speed dt) * comboMultiplier.
 * A near-miss (passing within a lateral threshold of an obstacle WITHOUT
 * colliding) bumps the combo; the combo decays back to base after a timeout
 * with no fresh near-miss, and resets on crash. Collision (AABB overlap) ends
 * the run.
 */

import { aabbOverlap } from '../utils/math';
import { SCORING, TRAFFIC, VEHICLE } from '../utils/constants';
import type { Obstacle, TrafficState } from './Traffic';

export interface ScoreState {
  /** Accumulated score. */
  score: number;
  /** Current combo multiplier (>= baseCombo). */
  combo: number;
  /** Seconds remaining before the combo decays back to base. */
  comboTimer: number;
  /** Telemetry / HUD: total near-misses this run. */
  nearMisses: number;
}

export function createScoreState(): ScoreState {
  return { score: 0, combo: SCORING.baseCombo, comboTimer: 0, nearMisses: 0 };
}

/**
 * Integrate score for one step and decay the combo timer. Score rises while the
 * vehicle moves (speed > 0). Mutates and returns `state`.
 */
export function integrateScore(state: ScoreState, speed: number, dt: number): ScoreState {
  state.score += speed * dt * SCORING.distanceFactor * state.combo;
  if (state.comboTimer > 0) {
    state.comboTimer -= dt;
    if (state.comboTimer <= 0) {
      state.comboTimer = 0;
      state.combo = SCORING.baseCombo;
    }
  }
  return state;
}

/** Register a near-miss: bump the combo (capped) and refresh its timer. */
export function registerNearMiss(state: ScoreState): ScoreState {
  state.combo = Math.min(state.combo + SCORING.comboStep, SCORING.maxCombo);
  state.comboTimer = SCORING.comboTimeout;
  state.nearMisses++;
  return state;
}

/** Reset the combo to base (e.g. on crash). */
export function resetCombo(state: ScoreState): ScoreState {
  state.combo = SCORING.baseCombo;
  state.comboTimer = 0;
  return state;
}

/** True if the player box overlaps the obstacle box (AABB). Pure predicate. */
export function isCollision(
  playerLateral: number,
  playerDistance: number,
  obstacle: Obstacle,
): boolean {
  return aabbOverlap(
    playerLateral,
    playerDistance,
    VEHICLE.halfWidth,
    VEHICLE.halfLength,
    obstacle.lateral,
    obstacle.distance,
    TRAFFIC.halfWidth,
    TRAFFIC.halfLength,
  );
}

export interface TrafficEvents {
  crashed: boolean;
  nearMisses: number;
}

/**
 * Resolve collisions and near-misses against the active traffic for this step.
 * Mutates `score` (near-miss combo) and each obstacle's `passed` flag; reports
 * whether a collision occurred. A collision takes precedence over a near-miss.
 */
export function resolveTraffic(
  score: ScoreState,
  playerLateral: number,
  playerDistance: number,
  traffic: TrafficState,
): TrafficEvents {
  let crashed = false;
  let nearMisses = 0;

  for (const o of traffic.pool) {
    if (!o.active) continue;

    if (isCollision(playerLateral, playerDistance, o)) {
      crashed = true;
      continue;
    }

    // The player has just drawn level with / overtaken this obstacle.
    if (!o.passed && o.distance <= playerDistance) {
      o.passed = true;
      const gap = Math.abs(playerLateral - o.lateral);
      if (gap < SCORING.nearMissLateral) {
        registerNearMiss(score);
        nearMisses++;
      }
    }
  }

  return { crashed, nearMisses };
}
