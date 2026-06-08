/**
 * DESYNC DETECTOR (MP-1 PR2) — the load-bearing safety net. PURE (reads GameState).
 *
 * Both peers simulate BOTH cars (host's + joiner's) from the same seed + same input
 * streams, so — if determinism holds (the #81 probe said it does Chrome↔Safari) —
 * each peer's WORLD is identical. Every `desyncCheckFrames` frames each peer hashes
 * its world (both states, keyed by ROLE so the hash is peer-symmetric) and swaps it;
 * a mismatch means the sims drifted (the thing the probe couldn't anticipate). PR2
 * logs + flags it; PR3 adds the graceful race-void.
 *
 * The RNG state is the exact anchor (uint32 — captures any spawn-cadence divergence);
 * float fields use a tolerance.
 */

import type { GameState } from '../game/GameState';
import { NET } from '../utils/constants';

export interface StateSum {
  rng: number; // exact uint32 anchor
  dist: number;
  lat: number;
  score: number;
}

/** Hash of one sim's key state. */
export function stateSum(g: GameState): StateSum {
  return { rng: g.rng.getState(), dist: g.distance, lat: g.vehicle.lateral, score: g.score.score };
}

/** A frame's whole-world hash, keyed by ROLE (not local/remote) so both peers
 *  compute the same thing regardless of which side they are. */
export interface WorldSum {
  f: number;
  host: StateSum;
  join: StateSum;
}

export function worldSum(frame: number, hostGame: GameState, joinGame: GameState): WorldSum {
  return { f: frame, host: stateSum(hostGame), join: stateSum(joinGame) };
}

export interface DesyncVerdict {
  ok: boolean;
  detail: string;
}

function cmpState(role: string, a: StateSum, b: StateSum, eps: number): DesyncVerdict | null {
  if (a.rng !== b.rng) return { ok: false, detail: `${role} RNG desync (${a.rng} vs ${b.rng})` };
  for (const [k, av, bv] of [
    ['dist', a.dist, b.dist],
    ['lat', a.lat, b.lat],
    ['score', a.score, b.score],
  ] as const) {
    if (Math.abs(av - bv) > eps) return { ok: false, detail: `${role}.${k} differs by ${Math.abs(av - bv).toExponential(2)}` };
  }
  return null;
}

/** Compare two peers' world hashes for the same frame. */
export function compareWorld(a: WorldSum, b: WorldSum, eps: number = NET.probeEpsilon): DesyncVerdict {
  if (a.f !== b.f) return { ok: false, detail: `frame mismatch ${a.f} vs ${b.f}` };
  return cmpState('host', a.host, b.host, eps) ?? cmpState('join', a.join, b.join, eps) ?? { ok: true, detail: `frame ${a.f} in sync` };
}
