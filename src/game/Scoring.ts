/**
 * Scoring, combo multiplier, near-miss and collision detection. PURE — no three.
 *
 * score = integral(speed dt) * comboMultiplier.
 * A near-miss (passing within a lateral threshold of an obstacle WITHOUT
 * colliding) bumps the combo; the combo decays back to base after a timeout
 * with no fresh near-miss, and resets on crash. Collision (AABB overlap) ends
 * the run.
 */

import { aabbOverlap, clamp, intervalsOverlap } from '../utils/math';
import {
  BASE_SCORING,
  GATE,
  JUICE,
  ObstacleKind,
  RAMP,
  SCORING,
  TRAFFIC,
  VEHICLE,
  type CarScoring,
  type PowerupKind,
} from '../utils/constants';
import type { Obstacle, TrafficState } from './Traffic';

/**
 * Near-miss feedback TIER (0..3) for a given combo — the band that drives the
 * crescendo intensity in the render layer. PURE; does NOT affect scoring or the
 * combo itself (display/feel only). Tier i applies when combo crosses
 * JUICE.nearMissTierThresholds[i-1]: <3 → 0, 3-5 → 1, 6-9 → 2, >=10 → 3.
 */
export function nearMissTier(combo: number): number {
  let tier = 0;
  for (let i = 0; i < JUICE.nearMissTierThresholds.length; i++) {
    if (combo >= JUICE.nearMissTierThresholds[i]) tier = i + 1;
  }
  return tier;
}

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
 * pass (defaults to 1 so existing callers are unchanged). `windowMul` scales the
 * combo SURVIVAL WINDOW per car (OPP-07b L2) — <1 means the combo decays back to
 * base sooner after a dry spell; defaults to 1 (the base comboTimeout).
 */
export function registerNearMiss(state: ScoreState, weight = 1, windowMul = 1): ScoreState {
  state.combo = Math.min(state.combo + SCORING.comboStep * weight, SCORING.maxCombo);
  if (state.combo > state.peakCombo) state.peakCombo = state.combo;
  state.comboTimer = SCORING.comboTimeout * windowMul;
  state.nearMisses++;
  return state;
}

/**
 * GRAZE reward gradient (OPP-14). For a near-miss `gap` (lateral centre-to-centre
 * distance, always < nearMissLateral when called), returns a reward multiplier
 * that scales the combo weight by how CLOSE the pass was:
 *
 *   gap >= nearMissLateral (4.0)  → 1.0   (outer edge: ordinary near-miss)
 *   gap == grazeInner      (2.3)  → grazeMax (2.5)  (paint-shave)
 *   gap <  grazeInner             → grazeMax  (capped — no runaway)
 *
 * i.e. mult = 1 + (grazeMax-1) · clamp((outer-gap)/(outer-inner), 0, 1). Linear
 * in the gap. Pure; multiplies the EXISTING weight (mover/gate/drift untouched).
 */
export function grazeMultiplier(gap: number): number {
  const t = clamp(
    (SCORING.nearMissLateral - gap) / (SCORING.nearMissLateral - SCORING.grazeInner),
    0,
    1,
  );
  return 1 + (SCORING.grazeMax - 1) * t;
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
  /** Smallest near-miss lateral gap this step (Infinity if none) — surfaces how
   *  close the closest graze was, so the feedback layer can punch a tight graze
   *  above its combo tier (OPP-14). Distinct from `closestLateral` (a nearest-
   *  obstacle diagnostic that may not be a near-miss at all). */
  nearMissClosest?: number;
  /** The powerup kind collected this step (last one), else null — for juice/audio. */
  collected?: PowerupKind | null;
  /** True on the step a held SHIELD absorbed a crash — for juice/audio. */
  shieldBlocked?: boolean;
  /** Number of RAMPs contacted this step (each grants a speed + score burst). */
  rampBoosts?: number;
  /** True on the step the player cleanly THREADED a gate (passed through the
   *  opening without crashing). Drives Daily Slalom scoring + feedback ONLY — it
   *  is NOT a near-miss (no combo, no crescendo); classic ignores it (gates are
   *  pure obstacles there). */
  gateThreaded?: boolean;
  /** Centeredness of that thread: 0 at the opening edge, 1 dead-centre. Feeds the
   *  slalom accuracy bonus + the per-gate feedback brightness. */
  gateCenteredness?: number;
  /** True on the step a clean thread pushed the slalom clean-streak across a
   *  MILESTONE tier (DAILY_SCORING.milestoneStep) — the rare, earned escalation
   *  cue. Set by GameState (slalom only) from the threadGate result. */
  gateMilestone?: boolean;
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
  scoring: CarScoring = BASE_SCORING,
): void {
  // A near-miss threaded WHILE DRIFTING is a committed, risky dodge, so it pays
  // a combo bonus — a concrete reason to drift through the tightest gaps.
  const driftMul = drifting ? SCORING.driftNearMissBonus : 1;
  // Per-car scoring tradeoff (OPP-07b): buildMul scales the combo weight (on top
  // of mover/gate/drift/graze — never replacing them); windowMul scales the
  // combo survival window. BASE_SCORING (1/1) leaves the base loop unchanged.
  const { buildMul, windowMul } = scoring;
  events.crashed = false;
  events.nearMisses = 0;
  events.nearMissClosest = Infinity;
  events.rampBoosts = 0;
  events.gateThreaded = false;
  events.gateMilestone = false;
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
            // Threading a MOVER pays more than a static pass; the GRAZE gradient
            // scales the reward by how close the pass was (OPP-14); the per-car
            // buildMul composes on top (OPP-07b) without replacing either.
            const weight = o.kind === ObstacleKind.Mover ? SCORING.moverNearMissWeight : 1;
            registerNearMiss(score, weight * driftMul * grazeMultiplier(gap) * buildMul, windowMul);
            events.nearMisses++;
            events.nearMissClosest = Math.min(events.nearMissClosest ?? Infinity, gap);
          }
        }
        break;
      }
      case ObstacleKind.Gate: {
        // A gate is a PURE obstacle: thread the opening or hit the wall (crash).
        // It produces NO near-miss (no combo, no crescendo) in either mode. It
        // DOES surface a clean-thread EVENT (with centeredness) that ONLY the
        // Daily Slalom scoring/feedback consumes — classic ignores it.
        if (gateBlocks(playerLateral, playerDistance, o)) {
          events.crashed = true;
          break;
        }
        if (!o.passed && o.distance <= playerDistance) {
          o.passed = true;
          if (withinGateOpening(playerLateral, o)) {
            events.gateThreaded = true;
            // 0 at the opening edge, 1 dead-centre (clamped). Pure geometry.
            events.gateCenteredness = clamp(
              1 - Math.abs(playerLateral - o.lateral) / o.openingHalfWidth,
              0,
              1,
            );
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
