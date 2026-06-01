/**
 * The pure game-state container and its single `update` entry point.
 *
 * Heart of the pure layer: owns the vehicle, road pool, traffic pool, scoring
 * and RNG, and advances them by a fixed timestep. Imports NOTHING from three and
 * never touches the DOM, so the whole simulation runs and is unit-tested in
 * Node. The rendering layer READS a GameState; it must never mutate one.
 *
 * State is mutated in place by `update` (the only mutation path) so the segment
 * and traffic pools can be reused with zero per-frame allocation.
 */

import { Rng } from '../utils/rng';
import { BASE_HANDLING, BASE_SCORING, DEFAULT_SEED, type CarHandling, type CarScoring } from '../utils/constants';
import type { InputIntent } from './Input';
import { createVehicleState, updateVehicle, type VehicleState } from './Vehicle';
import { createRoadState, roadCenterAt, updateRoad, type RoadState } from './Road';
import { createTrafficState, seedOpeningObstacle, updateTraffic, type TrafficState } from './Traffic';
import {
  createScoreState,
  integrateScore,
  resetCombo,
  resolveTraffic,
  type ScoreState,
  type TrafficEvents,
} from './Scoring';
import {
  createSlalomScoreState,
  missGate,
  threadGate,
  type SlalomScoreState,
} from './SlalomScore';
import {
  collectPickups,
  consumeShield,
  createPowerupState,
  powerupScoreMultiplier,
  powerupTimeScale,
  tickEffects,
  updatePickups,
  type PowerupState,
} from './Powerups';
import { createBiomeState, updateBiome, type BiomeState } from './Biome';
import { createMilestoneState, updateMilestones, type MilestoneState } from './Milestones';
import { BIOME_CYCLE, DRIFT_MIN_SPEED, POWERUPS, PowerupKind, RAMP, SLALOM, VEHICLE } from '../utils/constants';

/** Top-level run phase (erasable const-object, not a TS enum). */
export const Phase = {
  Menu: 'menu',
  Playing: 'playing',
  Paused: 'paused',
  Crashed: 'crashed',
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

/**
 * Per-run game MODE. 'classic' is the normal endless racer (every system's
 * single path, unchanged). 'dailySlalom' is the Daily Challenge re-imagined as an
 * endless gates-only slalom at constant speed (Daily Slalom PRs). The mode is set
 * once at startRun and read by the sim via the `isSlalom` predicate; it replaces
 * the old sim-inert `isDaily` flag (the daily challenge IS the slalom now).
 */
export const GameMode = {
  Classic: 'classic',
  DailySlalom: 'dailySlalom',
} as const;
export type GameMode = (typeof GameMode)[keyof typeof GameMode];

/** True when the run is the Daily Slalom — the single predicate the sim branches
 *  on, so behaviour code never scatters raw string compares. */
export function isSlalom(state: GameState): boolean {
  return state.mode === GameMode.DailySlalom;
}

export interface GameState {
  phase: Phase;
  seed: number;
  rng: Rng;
  /** Seconds elapsed in the current run. */
  time: number;
  /** Forward distance travelled this run (world units). */
  distance: number;
  vehicle: VehicleState;
  road: RoadState;
  traffic: TrafficState;
  powerups: PowerupState;
  /** Active biome + transition progress, driven by distance (see Biome.ts).
   *  Pure indices + a blend scalar; the rendering layer maps it to a palette. */
  biome: BiomeState;
  /** Distance-milestone + per-run-objective progress (see Milestones.ts). */
  milestones: MilestoneState;
  score: ScoreState;
  /** Daily Slalom score (event-driven per-gate points + clean streak). Used ONLY
   *  in 'dailySlalom' mode; left at its fresh zero state in classic. Kept separate
   *  from `score` (the classic ScoreState) so neither mode's scoring touches the
   *  other. */
  slalomScore: SlalomScoreState;
  /** Lives remaining (Daily Slalom PR 3). In 'dailySlalom' a gate-WALL miss costs
   *  one (run continues until 0); used ONLY in slalom. In classic it's inert
   *  (single-collision death is unchanged) — initialised but never read. */
  lives: number;
  /** Active car handling profile for this run (resolved from the selected car
   *  by the composition root and passed in — the pure layer never reaches into
   *  UI/storage). Defaults to BASE_HANDLING. */
  handling: CarHandling;
  /** Active car SCORING tradeoff for this run (OPP-07b) — resolved from the
   *  selected car by the composition root and passed in, like `handling`.
   *  Separate from handling (physics): this scales the combo build rate +
   *  survival window. Defaults to BASE_SCORING (neutral 1/1). */
  scoring: CarScoring;
  /** This run's MODE (set at startRun). 'classic' = the normal racer; 'dailySlalom'
   *  = the Daily Challenge gates-only slalom (constant speed). The composition
   *  root routes the run-end result to the daily store for 'dailySlalom' (it's
   *  today's fixed-seed daily), and the sim branches on it via isSlalom(). */
  mode: GameMode;
  /** Cosmetic starting-biome index (a mission/rank reward): shifts ONLY the
   *  biome visuals, never the distance/difficulty. 0 = default (Sunset). */
  startBiome: number;
  /** Per-run stat accumulators the across-run missions read at run end. Only the
   *  values not already derivable from other state live here (drift time +
   *  shields collected). Reset each run. */
  runStats: { driftSeconds: number; shields: number };
  /** Events produced on the most recent update — read by audio/juice. */
  lastEvents: TrafficEvents;
}

export function createGameState(seed: number = DEFAULT_SEED): GameState {
  return {
    phase: Phase.Menu,
    seed,
    rng: new Rng(seed),
    time: 0,
    distance: 0,
    vehicle: createVehicleState(),
    road: createRoadState(seed),
    traffic: createTrafficState(),
    powerups: createPowerupState(seed),
    biome: createBiomeState(),
    milestones: createMilestoneState(),
    score: createScoreState(),
    slalomScore: createSlalomScoreState(),
    lives: SLALOM.lives,
    handling: BASE_HANDLING,
    scoring: BASE_SCORING,
    mode: GameMode.Classic,
    startBiome: 0,
    runStats: { driftSeconds: 0, shields: 0 },
    lastEvents: { crashed: false, nearMisses: 0, collected: null, shieldBlocked: false, rampBoosts: 0 },
  };
}

/**
 * Reset everything for a fresh run and enter the playing phase. `handling` is
 * the selected car's profile, supplied by the caller (composition root); it
 * persists on the state until the next run.
 */
export function startRun(
  state: GameState,
  handling: CarHandling = state.handling,
  startBiome: number = state.startBiome,
  seed: number = state.seed,
  scoring: CarScoring = state.scoring,
  mode: GameMode = GameMode.Classic,
): GameState {
  state.phase = Phase.Playing;
  state.seed = seed;
  state.rng = new Rng(seed);
  state.time = 0;
  state.distance = 0;
  state.vehicle = createVehicleState();
  state.road = createRoadState(seed);
  state.traffic = createTrafficState();
  // Classic seeds one easy static obstacle so the opening isn't empty road. The
  // slalom is gates-only (a static here would violate that), so it's skipped.
  if (mode !== GameMode.DailySlalom) seedOpeningObstacle(state.traffic, seed);
  state.powerups = createPowerupState(seed);
  state.biome = createBiomeState();
  state.milestones = createMilestoneState();
  state.score = createScoreState();
  state.slalomScore = createSlalomScoreState();
  state.lives = SLALOM.lives; // full lives each run (inert in classic)
  state.handling = handling;
  state.scoring = scoring;
  state.mode = mode;
  state.startBiome = startBiome;
  state.runStats.driftSeconds = 0;
  state.runStats.shields = 0;
  state.lastEvents = { crashed: false, nearMisses: 0, collected: null, shieldBlocked: false, rampBoosts: 0 };
  return state;
}

/**
 * Reset to a fresh, idle MENU state (no run in progress). Used by "return to
 * menu" so a stale run never carries over; the next PLAY (startRun) begins clean.
 * Keeps the selected `handling` so the menu's car selection persists.
 */
export function returnToMenu(state: GameState, seed: number = state.seed): GameState {
  state.phase = Phase.Menu;
  state.seed = seed;
  state.rng = new Rng(seed);
  state.time = 0;
  state.distance = 0;
  state.vehicle = createVehicleState();
  state.road = createRoadState(seed);
  state.traffic = createTrafficState();
  state.powerups = createPowerupState(seed);
  state.biome = createBiomeState();
  state.milestones = createMilestoneState();
  state.score = createScoreState();
  state.runStats.driftSeconds = 0;
  state.runStats.shields = 0;
  state.lastEvents.crashed = false;
  state.lastEvents.nearMisses = 0;
  state.lastEvents.collected = null;
  state.lastEvents.shieldBlocked = false;
  state.lastEvents.rampBoosts = 0;
  return state;
}

/** Pause an in-progress run (no-op unless Playing). The sim won't advance while
 *  Paused; `resume` returns to Playing exactly where it left off. */
export function pause(state: GameState): GameState {
  if (state.phase === Phase.Playing) state.phase = Phase.Paused;
  return state;
}

/** Resume a paused run (no-op unless Paused). */
export function resume(state: GameState): GameState {
  if (state.phase === Phase.Paused) state.phase = Phase.Playing;
  return state;
}

/**
 * Advance the whole simulation by `dt` seconds under the given intent. Mutates
 * and returns `state`. No-ops unless Playing (Menu/Paused/Crashed are frozen).
 */
export function update(state: GameState, intent: InputIntent, dt: number): GameState {
  // Restart from the menu or crash screen.
  if ((state.phase === Phase.Menu || state.phase === Phase.Crashed) && intent.restart) {
    return startRun(state);
  }

  if (state.phase !== Phase.Playing) {
    // Mutate in place — no per-frame allocation while on menu / crash screen.
    state.lastEvents.crashed = false;
    state.lastEvents.nearMisses = 0;
    state.lastEvents.collected = null;
    state.lastEvents.shieldBlocked = false;
    state.lastEvents.rampBoosts = 0;
    state.lastEvents.milestone = null;
    state.lastEvents.biomeChanged = false;
    state.lastEvents.objectiveDone = null;
    state.vehicle.drifting = false; // not driving — no drift visual/audio/screech
    return state;
  }

  const effects = state.powerups.effects;

  // SLOW-MO hook: the whole simulation advances on a scaled timestep, so the
  // vehicle, distance, traffic, pickups and score all slow together and stay
  // mutually consistent. Effect TIMERS still tick on real `dt` (below) so their
  // durations are wall-clock.
  const simDt = dt * powerupTimeScale(effects);

  // The drivable corridor follows the road's curve at the player's position.
  const roadCenter = roadCenterAt(state.seed, state.distance);
  const slalom = isSlalom(state);
  updateVehicle(state.vehicle, intent, state.distance, roadCenter, state.handling, simDt, slalom);
  state.distance += state.vehicle.speed * simDt;
  state.time += simDt;

  // Drift-time accrual for the across-run drift missions (handbrake while moving).
  if (intent.handbrake && state.vehicle.speed > DRIFT_MIN_SPEED) state.runStats.driftSeconds += simDt;

  updateRoad(state.road, state.distance);
  // Biome is shifted by the cosmetic startBiome offset (visuals only — distance
  // and difficulty are untouched, so this never affects gameplay).
  updateBiome(state.biome, state.distance + state.startBiome * BIOME_CYCLE.span);
  updateTraffic(state.traffic, state.rng, state.seed, state.distance, simDt, slalom);
  updatePickups(state.powerups, state.seed, state.distance, state.vehicle.lateral, simDt);

  // Writes into the pre-allocated lastEvents object (no per-frame allocation).
  resolveTraffic(
    state.lastEvents,
    state.score,
    state.vehicle.lateral,
    state.distance,
    state.traffic,
    state.vehicle.drifting,
    state.scoring,
  );
  state.lastEvents.collected = null;
  state.lastEvents.shieldBlocked = false;
  collectPickups(state.powerups, state.vehicle.lateral, state.distance, state.lastEvents);
  // Track shields collected this run (for the "collect N shields" mission).
  if (state.lastEvents.collected === PowerupKind.Shield) state.runStats.shields += 1;

  // RAMP hook: a contacted boost-strip grants a flat score burst and a brief
  // over-cap speed boost (the raised cap lives on the vehicle's boostTimer).
  if (state.lastEvents.rampBoosts && state.lastEvents.rampBoosts > 0) {
    state.score.score += RAMP.scoreBurst * state.lastEvents.rampBoosts;
    state.vehicle.boostTimer = RAMP.boostDuration;
    state.vehicle.speed += VEHICLE.boostBonus;
  }

  // MILESTONE hook: distance thresholds grant rewards through the SAME powerup /
  // score seams used above (no new special-casing), and objectives count this
  // step's events. Runs after the ramp/pickup events are resolved so its
  // objective counters see them, and before the shield/crash check so a
  // milestone-granted shield can guard the very step it is awarded. Reset the
  // one-step milestone signals first (mutate in place, no allocation).
  state.lastEvents.milestone = null;
  state.lastEvents.biomeChanged = false;
  state.lastEvents.objectiveDone = null;
  updateMilestones(
    state.milestones,
    state.distance,
    state.biome.from,
    effects,
    state.score,
    state.lastEvents,
  );

  // SCORING. CLASSIC: the continuous distance×combo integral (SCORE-BOOST stacks
  // on top). SLALOM: EVENT-driven instead — no distance integral (would double-
  // count); a cleanly-threaded gate scores base×accuracy×cleanMultiplier. The two
  // paths are mutually exclusive, so classic scoring is entirely unchanged.
  if (slalom) {
    if (state.lastEvents.gateThreaded) {
      const result = threadGate(state.slalomScore, state.lastEvents.gateCenteredness ?? 0);
      state.lastEvents.gateMilestone = result.milestone; // surface the streak-tier crossing
    }
  } else {
    integrateScore(state.score, state.vehicle.speed, simDt, powerupScoreMultiplier(effects));
  }

  // SHIELD hook: intercept the crash path. While i-frames are active (granted
  // when a shield breaks), crashes are ignored so the car can clear the obstacle
  // it just survived. Otherwise a held shield absorbs the crash, keeps the run
  // going, preserves the combo, and starts the invulnerability window.
  if (effects.invulnTimer > 0) state.lastEvents.crashed = false;
  if (state.lastEvents.crashed && consumeShield(effects)) {
    state.lastEvents.crashed = false;
    state.lastEvents.shieldBlocked = true;
    effects.invulnTimer = POWERUPS.shieldInvuln;
  }

  // LIVES (Daily Slalom PR 3): in slalom, a gate-WALL miss (the only crash source
  // there — gates-only) costs a LIFE instead of ending the run, until the last.
  // Mirrors the shield intercept and sits AFTER it: the i-frame check above (and a
  // held shield) get first refusal, so the post-miss invuln window swallows the
  // immediately-following gate WITHOUT spending a second life. Classic NEVER enters
  // here (guarded by `slalom`), so single-collision death is unchanged.
  if (slalom && state.lastEvents.crashed && state.lives > 0) {
    state.lives -= 1;
    if (state.lives > 0) {
      // Survived: swallow the crash, break the streak, grant i-frames, sting.
      state.lastEvents.crashed = false;
      state.lastEvents.gateMissed = true;
      missGate(state.slalomScore);
      effects.invulnTimer = POWERUPS.shieldInvuln;
    }
    // else lives now 0 → leave `crashed` set so the run ends below (the 3rd miss).
  }

  if (state.lastEvents.crashed) {
    state.phase = Phase.Crashed;
    resetCombo(state.score);
    // A slalom run-ending miss (the last life) also breaks the streak — moot at
    // run-end, but keeps the invariant "any miss resets cleanMultiplier".
    if (slalom) missGate(state.slalomScore);
  }

  // Effect durations are wall-clock: tick on REAL dt, never the slowed simDt.
  tickEffects(effects, dt);

  return state;
}
