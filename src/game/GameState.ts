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
import { DEFAULT_SEED } from '../utils/constants';
import type { InputIntent } from './Input';
import { createVehicleState, updateVehicle, type VehicleState } from './Vehicle';
import { createRoadState, updateRoad, type RoadState } from './Road';
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
    lastEvents: { crashed: false, nearMisses: 0 },
  };
}

/** Reset everything for a fresh run and enter the playing phase. */
export function startRun(state: GameState, seed: number = state.seed): GameState {
  state.phase = Phase.Playing;
  state.seed = seed;
  state.rng = new Rng(seed);
  state.time = 0;
  state.distance = 0;
  state.vehicle = createVehicleState();
  state.road = createRoadState(seed);
  state.traffic = createTrafficState();
  state.score = createScoreState();
  state.lastEvents = { crashed: false, nearMisses: 0 };
  return state;
}

/**
 * Advance the whole simulation by `dt` seconds under the given intent. Mutates
 * and returns `state`.
 */
export function update(state: GameState, intent: InputIntent, dt: number): GameState {
  // Restart from the menu or crash screen.
  if ((state.phase === Phase.Menu || state.phase === Phase.Crashed) && intent.restart) {
    return startRun(state);
  }

  if (state.phase !== Phase.Playing) {
    state.lastEvents = { crashed: false, nearMisses: 0 };
    return state;
  }

  updateVehicle(state.vehicle, intent, state.distance, dt);
  state.distance += state.vehicle.speed * dt;
  state.time += dt;

  updateRoad(state.road, state.distance);
  updateTraffic(state.traffic, state.rng, state.distance, dt);

  const events = resolveTraffic(state.score, state.vehicle.lateral, state.distance, state.traffic);
  integrateScore(state.score, state.vehicle.speed, dt);
  state.lastEvents = events;

  if (events.crashed) {
    state.phase = Phase.Crashed;
    resetCombo(state.score);
  }

  return state;
}
