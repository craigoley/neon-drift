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
    score: createScoreState(),
    handling: BASE_HANDLING,
    lastEvents: { crashed: false, nearMisses: 0 },
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
  state.score = createScoreState();
  state.handling = handling;
  state.lastEvents = { crashed: false, nearMisses: 0 };
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
  state.score = createScoreState();
  state.lastEvents.crashed = false;
  state.lastEvents.nearMisses = 0;
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
    return state;
  }

  // The drivable corridor follows the road's curve at the player's position.
  const roadCenter = roadCenterAt(state.seed, state.distance);
  updateVehicle(state.vehicle, intent, state.distance, roadCenter, state.handling, dt);
  state.distance += state.vehicle.speed * dt;
  state.time += dt;

  updateRoad(state.road, state.distance);
  updateTraffic(state.traffic, state.rng, state.seed, state.distance, dt);

  // Writes into the pre-allocated lastEvents object (no per-frame allocation).
  resolveTraffic(state.lastEvents, state.score, state.vehicle.lateral, state.distance, state.traffic);
  integrateScore(state.score, state.vehicle.speed, dt);

  if (state.lastEvents.crashed) {
    state.phase = Phase.Crashed;
    resetCombo(state.score);
  }

  return state;
}
