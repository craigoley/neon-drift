/**
 * Scoring, combo multiplier, near-miss and collision detection. PURE — no three.
 *
 * score = integral(speed dt) * comboMultiplier.
 * A near-miss (passing within a lateral threshold of an obstacle WITHOUT
 * colliding) bumps the combo; the combo decays back to base after a timeout
 * with no fresh near-miss, and resets on crash. Collision (AABB overlap) ends
 * the run.
 */

import { aabbOverlap, intervalsOverlap } from '../utils/math';
import { GATE, ObstacleKind, RAMP, SCORING, TRAFFIC, VEHICLE, type PowerupKind } from '../utils/constants';
import type { Obstacle, TrafficState } from './Traffic';

export interface ScoreState {
  /** Accumulated score. */
  score: number;
  /** Current combo multiplier (>= baseCombo). */
  combo: number;
  /** Highest combo reached this run — survives the crash reset so the WIPEOUT
   *  screen can show the run's best multiplier even though `combo` resets.
   *  (Distinct from SCORING.maxCombo, which is the cap.) */
  peakCombo: number;
  /** Seconds remaining before the combo decays back to base. */
  comboTimer: number;
  /** Telemetry / HUD: total near-misses this run. */
  nearMisses: number;
}

export function createScoreState(): ScoreState {
  return { score: 0, combo: SCORING.baseCombo, peakCombo: SCORING.baseCombo, comboTimer: 0, nearMisses: 0 };
}

/**
 * Integrate score for one step and decay the combo timer. Score rises while the
 * vehicle moves (speed > 0). `multiplier` is an EXTERNAL gain multiplier (the
 * SCORE-BOOST powerup passes 2 — stacking multiplicatively on top of the
 * combo); it defaults to 1 so existing callers are unchanged. Mutates and
 * returns `state`.
 */
export function integrateScore(state: ScoreState, speed: number, dt: number, multiplier = 1): ScoreState {
  state.score += speed * dt * SCORING.distanceFactor * state.combo * multiplier;
  if (state.comboTimer > 0) {
    state.comboTimer -= dt;
    if (state.comboTimer <= 0) {
      state.comboTimer = 0;
      state.combo = SCORING.baseCombo;
    }
  }
  return state;
}

/**
 * Register a near-miss: bump the combo (capped) and refresh its timer. `weight`
 * scales the combo step — threading a MOVER or a GATE pays more than a static
 * pass (defaults to 1 so existing callers are unchanged).
 */
export function registerNearMiss(state: ScoreState, weight = 1): ScoreState {
  state.combo = Math.min(state.combo + SCORING.comboStep * weight, SCORING.maxCombo);
  if (state.combo > state.peakCombo) state.peakCombo = state.combo;
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

/** True if the player box overlaps a STATIC/MOVER obstacle box (AABB). Pure. */
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

/** True if the car is fully inside a GATE's opening (so it would pass safely).
 *  The opening is centred on `gate.lateral` with half-width `openingHalfWidth`. */
export function withinGateOpening(playerLateral: number, gate: Obstacle): boolean {
  return Math.abs(playerLateral - gate.lateral) + VEHICLE.halfWidth <= gate.openingHalfWidth;
}

/**
 * True if the car hits a GATE's barrier: it overlaps the gate's forward band AND
 * is NOT fully within the opening. Pure predicate.
 */
export function gateBlocks(playerLateral: number, playerDistance: number, gate: Obstacle): boolean {
  const forwardOverlap = intervalsOverlap(playerDistance, VEHICLE.halfLength, gate.distance, GATE.halfLength);
  return forwardOverlap && !withinGateOpening(playerLateral, gate);
}

/** True if the car is touching a RAMP's contact box (beneficial — never a crash). */
export function isRampContact(playerLateral: number, playerDistance: number, ramp: Obstacle): boolean {
  return aabbOverlap(
    playerLateral,
    playerDistance,
    VEHICLE.halfWidth,
    VEHICLE.halfLength,
    ramp.lateral,
    ramp.distance,
    RAMP.halfWidth,
    RAMP.halfLength,
  );
}

export interface TrafficEvents {
  crashed: boolean;
  nearMisses: number;
  /** The powerup kind collected this step (last one), else null — for juice/audio. */
  collected?: PowerupKind | null;
  /** True on the step a held SHIELD absorbed a crash — for juice/audio. */
  shieldBlocked?: boolean;
  /** Number of RAMPs contacted this step (each grants a speed + score burst). */
  rampBoosts?: number;
  /** Label of a distance MILESTONE hit this step (last one), else null — for the
   *  celebratory toast + fanfare. See Milestones.ts. */
  milestone?: string | null;
  /** True on the step the active biome advanced to a new index — for a "NEW
   *  BIOME" celebration that tracks the actual environment transition. */
  biomeChanged?: boolean;
  /** Label of a per-run OBJECTIVE completed this step (last one), else null. */
  objectiveDone?: string | null;
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
  drifting = false,
): void {
  // A near-miss threaded WHILE DRIFTING is a committed, risky dodge, so it pays
  // a combo bonus — a concrete reason to drift through the tightest gaps.
  const driftMul = drifting ? SCORING.driftNearMissBonus : 1;
  events.crashed = false;
  events.nearMisses = 0;
  events.rampBoosts = 0;
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

    switch (o.kind) {
      case ObstacleKind.Static:
      case ObstacleKind.Mover: {
        if (isCollision(playerLateral, playerDistance, o)) {
          events.crashed = true;
          break;
        }
        // The player has just drawn level with / overtaken this obstacle.
        if (!o.passed && o.distance <= playerDistance) {
          o.passed = true;
          const gap = Math.abs(playerLateral - o.lateral);
          if (gap < SCORING.nearMissLateral) {
            // Threading a MOVER pays more than a static pass.
            const weight = o.kind === ObstacleKind.Mover ? SCORING.moverNearMissWeight : 1;
            registerNearMiss(score, weight * driftMul);
            events.nearMisses++;
          }
        }
        break;
      }
      case ObstacleKind.Gate: {
        if (gateBlocks(playerLateral, playerDistance, o)) {
          events.crashed = true;
          break;
        }
        // Threading the opening (only reachable without a crash) rewards combo.
        if (!o.passed && o.distance <= playerDistance) {
          o.passed = true;
          if (withinGateOpening(playerLateral, o)) {
            registerNearMiss(score, SCORING.gateThreadWeight * driftMul);
            events.nearMisses++;
          }
        }
        break;
      }
      case ObstacleKind.Ramp: {
        // Beneficial: contact applies its boost exactly once, never a crash.
        if (!o.consumed && isRampContact(playerLateral, playerDistance, o)) {
          o.consumed = true;
          events.rampBoosts = (events.rampBoosts ?? 0) + 1;
        }
        break;
      }
    }
  }
}
