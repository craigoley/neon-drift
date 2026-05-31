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
  /** Instrumentation (surfaced in ?debug=1): active obstacles checked this frame. */
  evaluated?: number;
  /** Instrumentation: lateral gap to the nearest obstacle (by |longitudinal|). */
  closestLateral?: number;
  /** Instrumentation: that obstacle's longitudinal gap (o.distance - player). */
  closestLongitudinal?: number;
}

/**
 * Resolve collisions and near-misses against the active traffic for this step.
 * Mutates `score` (near-miss combo), each obstacle's `passed` flag, and writes
 * the outcome into the caller-supplied `events` object (mutate-in-place — no
 * per-frame allocation). A collision takes precedence over a near-miss.
 *
 * Also records per-frame proximity diagnostics on `events` (evaluated count +
 * the nearest obstacle's gaps) for the ?debug=1 funnel panel — pure telemetry,
 * no effect on the scoring logic.
 */
export function resolveTraffic(
  events: TrafficEvents,
  score: ScoreState,
  playerLateral: number,
  playerDistance: number,
  traffic: TrafficState,
): void {
  events.crashed = false;
  events.nearMisses = 0;
  events.evaluated = 0;
  events.closestLateral = Infinity;
  events.closestLongitudinal = Infinity;
  let nearestAbsLong = Infinity;

  for (const o of traffic.pool) {
    if (!o.active) continue;
    events.evaluated++;

    // Diagnostics: track the obstacle nearest the player longitudinally.
    const longitudinal = o.distance - playerDistance;
    if (Math.abs(longitudinal) < nearestAbsLong) {
      nearestAbsLong = Math.abs(longitudinal);
      events.closestLateral = Math.abs(playerLateral - o.lateral);
      events.closestLongitudinal = longitudinal;
    }

    if (isCollision(playerLateral, playerDistance, o)) {
      events.crashed = true;
      continue;
    }

    // The player has just drawn level with / overtaken this obstacle.
    if (!o.passed && o.distance <= playerDistance) {
      o.passed = true;
      const gap = Math.abs(playerLateral - o.lateral);
      if (gap < SCORING.nearMissLateral) {
        registerNearMiss(score);
        events.nearMisses++;
      }
    }
  }
}
