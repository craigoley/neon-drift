/**
 * MP race FINISH (MP-1 PR3-pt2, Part A). Drives two cars to the finish on one seed
 * (exactly how MpRace steps both sims in lockstep) and proves the winner is decided
 * deterministically in SHARED SIM TIME — both peers agree, no split-brain — and that
 * the race actually ENDS (a car reaches the finish in a sane number of frames).
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type GameState, GameMode, startRun, update } from '../GameState';
import { createIntent } from '../Input';
import { handlingFor, MP_RACE, scoringFor, slowMoFor, TIMESTEP } from '../../utils/constants';
import { decideWinner, resultFor } from '../../net/raceLogic';

function startCar(seed: number, carId: string): GameState {
  return startRun(createGameState(seed), handlingFor(carId), 0, seed, scoringFor(carId), GameMode.Classic, slowMoFor(carId), true);
}

/** Step both cars in lockstep until the FIRST reaches the finish; return the result. */
function raceToFinish(seed: number, hostCar: string, joinCar: string) {
  const host = startCar(seed, hostCar);
  const join = startCar(seed, joinCar);
  const intent = createIntent(); // both drive straight
  let hostFinishFrame = -1;
  let joinFinishFrame = -1;
  let frame = 0;
  const fin = MP_RACE.finishDistance;
  for (; frame < 100_000; frame++) {
    update(host, intent, TIMESTEP);
    update(join, intent, TIMESTEP);
    if (hostFinishFrame < 0 && host.distance >= fin) hostFinishFrame = frame;
    if (joinFinishFrame < 0 && join.distance >= fin) joinFinishFrame = frame;
    if (hostFinishFrame >= 0 || joinFinishFrame >= 0) break; // first crosser → race over
  }
  const winner = decideWinner(hostFinishFrame, joinFinishFrame, host.distance, join.distance);
  return { winner, hostFinishFrame, joinFinishFrame, frame, hostDist: host.distance, joinDist: join.distance };
}

describe('MP finish — the race ends with a deterministic, agreed winner', () => {
  it('a car reaches the finish in a sane number of frames (the race is winnable)', () => {
    const r = raceToFinish(12345, 'ember', 'slipstream');
    expect(r.frame).toBeGreaterThan(100); // not instant
    expect(r.frame).toBeLessThan(60_000); // and it actually finishes
    expect(Math.max(r.hostDist, r.joinDist)).toBeGreaterThanOrEqual(MP_RACE.finishDistance);
  });

  it('the faster car wins (ember > slipstream)', () => {
    for (const seed of [12345, 0x5eed1234, 99]) {
      expect(raceToFinish(seed, 'ember', 'slipstream').winner, `seed ${seed}`).toBe('host');
      expect(raceToFinish(seed, 'slipstream', 'ember').winner, `seed ${seed}`).toBe('join');
    }
  });

  it('BOTH peers agree on the winner + finish frame (deterministic — no split-brain)', () => {
    const a = raceToFinish(777, 'pulse', 'nova');
    const b = raceToFinish(777, 'pulse', 'nova'); // a second peer = a second run of the same sim
    expect(a.winner).toBe(b.winner);
    expect(a.hostFinishFrame).toBe(b.hostFinishFrame);
    expect(a.joinFinishFrame).toBe(b.joinFinishFrame);
    // The two peers map the same winner to OPPOSITE results — exactly one winner.
    expect(resultFor(a.winner, true)).not.toBe(resultFor(a.winner, false));
  });

  it('identical cars → a deterministic result (tiebreak, never a hang)', () => {
    const r = raceToFinish(2024, 'pulse', 'pulse');
    expect(['host', 'join', 'draw']).toContain(r.winner);
    expect(r.frame).toBeLessThan(60_000);
  });
});
