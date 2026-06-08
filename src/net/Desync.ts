/**
 * DESYNC DETECTOR (MP-1 PR2; diagnostics enhanced) — the load-bearing safety net.
 * PURE (reads GameState, mutates nothing — diagnostic only, never changes the sim).
 *
 * Both peers simulate BOTH cars (host's + joiner's) from the same seed + same input
 * streams, so if determinism holds each peer's WORLD is identical. Every
 * `desyncCheckFrames` frames each peer hashes its world (both states, keyed by ROLE
 * so the hash is peer-symmetric) and swaps it; a mismatch means the sims drifted.
 *
 * The hash captures the suspected CAUSAL CHAIN of a cross-engine FP drift, root →
 * downstream, so the report names which field broke FIRST and by how much:
 *   speed (sub-ULP FP root) → spawn accumulators (sinceSpawn) → spawn counts →
 *   rng draw-state (the permanent stream offset) → distance/lateral → score.
 * Integer anchors (rng states, spawn counts) are compared EXACTLY (an offset is
 * reported as draw/spawn counts); float fields report their exact delta magnitude,
 * so a ~1e-12 delta reads as cross-engine FP and a large delta reads as a logic bug.
 */

import type { GameState } from '../game/GameState';

export interface StateSum {
  // Exact integer anchors (compared ===; a mismatch is a hard offset).
  trafficRng: number; // traffic spawn stream state (uint32)
  powerupRng: number; // powerup spawn stream state (uint32) — invisible to the old detector
  trafficSpawned: number; // total obstacles spawned (a spawn-cadence offset shows here first)
  powerupSpawned: number; // total pickups spawned
  // Float fields (compared with a tolerance; the actual delta is reported).
  speed: number; // suspected ROOT: a sub-ULP transcendental drift surfaces here first
  trafficSince: number; // seconds since last obstacle spawn (drifts before the gate flips)
  powerupSince: number; // seconds since last pickup spawn
  dist: number;
  lat: number;
  score: number;
}

/** Hash one sim's key state (everything in the suspected causal chain). */
export function stateSum(g: GameState): StateSum {
  return {
    trafficRng: g.rng.getState(),
    powerupRng: g.powerups.rng.getState(),
    trafficSpawned: g.traffic.spawned,
    powerupSpawned: g.powerups.spawned,
    speed: g.vehicle.speed,
    trafficSince: g.traffic.sinceSpawn,
    powerupSince: g.powerups.sinceSpawn,
    dist: g.distance,
    lat: g.vehicle.lateral,
    score: g.score.score,
  };
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

/**
 * The tracked fields in CAUSAL ORDER (root → downstream). The first entry that
 * differs is the earliest link in the divergence chain, which is what we report as
 * the likely cause. `exact` fields are integers compared with ===; the rest are
 * floats compared with a tolerance.
 */
const FIELDS: ReadonlyArray<{ key: string; exact: boolean; get: (s: StateSum) => number }> = [
  { key: 'speed', exact: false, get: (s) => s.speed },
  { key: 'trafficSince', exact: false, get: (s) => s.trafficSince },
  { key: 'powerupSince', exact: false, get: (s) => s.powerupSince },
  { key: 'trafficSpawned', exact: true, get: (s) => s.trafficSpawned },
  { key: 'powerupSpawned', exact: true, get: (s) => s.powerupSpawned },
  { key: 'trafficRng', exact: true, get: (s) => s.trafficRng },
  { key: 'powerupRng', exact: true, get: (s) => s.powerupRng },
  { key: 'dist', exact: false, get: (s) => s.dist },
  { key: 'lat', exact: false, get: (s) => s.lat },
  { key: 'score', exact: false, get: (s) => s.score },
];

export interface FieldDiff {
  role: 'host' | 'join';
  field: string;
  exact: boolean;
  a: number;
  b: number;
  /** For floats: |a-b|. For ints: the signed offset (b-a). */
  delta: number;
}

export interface DesyncVerdict {
  ok: boolean;
  /** Full multi-field line for the console. */
  detail: string;
  /** Short line for on-screen surfacing (frame + earliest field + magnitude). */
  summary: string;
  /** The earliest-in-causal-order diverging field (the likely cause). */
  first?: FieldDiff;
}

function fmtDiff(d: FieldDiff): string {
  return d.exact
    ? `${d.role}.${d.field} OFFSET(${d.a} vs ${d.b}, Δ${d.delta >= 0 ? '+' : ''}${d.delta})`
    : `${d.role}.${d.field} Δ${d.delta.toExponential(2)}`;
}

/**
 * Compare two peers' world hashes for the same frame. Reports EVERY diverging field
 * (with its magnitude) and identifies the earliest one in the causal chain.
 *
 * `eps` defaults to 0 (EXACT float comparison): both peers run the same lockstep so —
 * absent a real divergence — every float is bit-identical, and a cross-engine FP drift
 * is exactly what we want to catch at its sub-ULP root (e.g. speed ~1e-15) before it
 * amplifies. Pass a tolerance only if a caller wants to ignore small float deltas.
 */
export function compareWorld(a: WorldSum, b: WorldSum, eps = 0): DesyncVerdict {
  if (a.f !== b.f) {
    const detail = `frame mismatch ${a.f} vs ${b.f}`;
    return { ok: false, detail, summary: `f${a.f}≠${b.f}` };
  }
  const diffs: FieldDiff[] = [];
  // Outer loop = causal field order; inner = role → diffs[0] is the earliest link.
  for (const f of FIELDS) {
    for (const role of ['host', 'join'] as const) {
      const av = f.get(a[role]);
      const bv = f.get(b[role]);
      const bad = f.exact ? av !== bv : Math.abs(av - bv) > eps;
      if (bad) diffs.push({ role, field: f.key, exact: f.exact, a: av, b: bv, delta: f.exact ? bv - av : Math.abs(av - bv) });
    }
  }
  if (diffs.length === 0) return { ok: true, detail: `frame ${a.f} in sync`, summary: `f${a.f} ok` };

  const first = diffs[0];
  const detail = `frame ${a.f}: ${diffs.map(fmtDiff).join(' | ')}`;
  const mag = first.exact ? `${first.a}≠${first.b}` : first.delta.toExponential(1);
  const summary = `f${a.f} ${first.role}.${first.field} ${mag}`;
  return { ok: false, detail, summary, first };
}
