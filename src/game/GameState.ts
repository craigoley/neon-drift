/**
 * The pure game-state container and its single `update` entry point.
 *
 * This is the heart of the pure layer: it owns the vehicle, traffic and score
 * sub-states and advances them by a fixed timestep. It imports NOTHING from
 * three and never touches the DOM, so the entire simulation runs and is tested
 * in Node. The rendering layer reads a GameState; it must never mutate one.
 */

import type { InputState } from './Input';
import type { RandomSource } from './Traffic';
import { createVehicleState, updateVehicle, type VehicleState } from './Vehicle';
import { createTrafficState, updateTraffic, type TrafficState } from './Traffic';
import { addDistance, createScoreState, type ScoreState } from './Scoring';

/** Top-level run phase. Erasable const-object instead of a TS enum. */
export const Phase = {
  Ready: 'ready',
  Running: 'running',
  GameOver: 'gameOver',
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

export interface GameState {
  phase: Phase;
  /** Seconds of simulated play time elapsed. */
  elapsed: number;
  vehicle: VehicleState;
  traffic: TrafficState;
  score: ScoreState;
}

export function createGameState(): GameState {
  return {
    phase: Phase.Ready,
    elapsed: 0,
    vehicle: createVehicleState(),
    traffic: createTrafficState(),
    score: createScoreState(),
  };
}

/**
 * Advance the whole simulation by `dt` seconds. Returns a NEW GameState; the
 * input state is never mutated. `random` is injected so runs are reproducible
 * in tests (the browser passes `Math.random`).
 */
export function update(
  state: GameState,
  input: InputState,
  dt: number,
  random: RandomSource,
): GameState {
  if (state.phase !== Phase.Running) {
    return state;
  }

  const vehicle = updateVehicle(state.vehicle, input, dt);
  const distanceDelta = vehicle.distance - state.vehicle.distance;

  return {
    phase: state.phase,
    elapsed: state.elapsed + dt,
    vehicle,
    traffic: updateTraffic(state.traffic, dt, state.elapsed, vehicle.speed, random),
    score: addDistance(state.score, distanceDelta),
  };
}

/** Transition a freshly-created state into the running phase. */
export function start(state: GameState): GameState {
  return { ...state, phase: Phase.Running };
}
