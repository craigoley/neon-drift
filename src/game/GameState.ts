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
import { BASE_HANDLING, DEFAULT_SEED, type CarHandling } from '../utils/constants';
import type { InputIntent } from './Input';
import { createVehicleState, updateVehicle, type VehicleState } from './Vehicle';
import { createRoadState, roadCenterAt, updateRoad, type RoadState } from './Road';
import { createTrafficState, updateTraffic, type TrafficState } from './Traffic';
import {
  createScoreState,
  integrateScore,
  resetCombo,
  resolveTraffic,
  type ScoreState,
  type TrafficEvents,
} from './Scoring';
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
import { POWERUPS, RAMP, VEHICLE } from '../utils/constants';

/** Top-level run phase (erasable const-object, not a TS enum). */
export const Phase = {
  Menu: 'menu',
  Playing: 'playing',
  Paused: 'paused',
  Crashed: 'crashed',
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

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
  /** Active car handling profile for this run (resolved from the selected car
   *  by the composition root and passed in — the pure layer never reaches into
   *  UI/storage). Defaults to BASE_HANDLING. */
  handling: CarHandling;
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
    handling: BASE_HANDLING,
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
  seed: number = state.seed,
): GameState {
  state.phase = Phase.Playing;
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
  state.handling = handling;
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
  updateVehicle(state.vehicle, intent, state.distance, roadCenter, state.handling, simDt);
  state.distance += state.vehicle.speed * simDt;
  state.time += simDt;

  updateRoad(state.road, state.distance);
  updateBiome(state.biome, state.distance); // environment progression (pure)
  updateTraffic(state.traffic, state.rng, state.seed, state.distance, simDt);
  updatePickups(state.powerups, state.seed, state.distance, state.vehicle.lateral, simDt);

  // Writes into the pre-allocated lastEvents object (no per-frame allocation).
  resolveTraffic(
    state.lastEvents,
    state.score,
    state.vehicle.lateral,
    state.distance,
    state.traffic,
    state.vehicle.drifting,
  );
  state.lastEvents.collected = null;
  state.lastEvents.shieldBlocked = false;
  collectPickups(state.powerups, state.vehicle.lateral, state.distance, state.lastEvents);

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

  // SCORE-BOOST hook: an external multiplier stacked on top of the combo.
  integrateScore(state.score, state.vehicle.speed, simDt, powerupScoreMultiplier(effects));

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

  if (state.lastEvents.crashed) {
    state.phase = Phase.Crashed;
    resetCombo(state.score);
  }

  // Effect durations are wall-clock: tick on REAL dt, never the slowed simDt.
  tickEffects(effects, dt);

  return state;
}
