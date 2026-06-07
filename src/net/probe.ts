/**
 * CROSS-ENGINE DETERMINISM PROBE (MP-1 PR1) — the top technical risk for lockstep.
 *
 * Both peers run the SAME seed + SAME scripted input through the pure sim and compare
 * checksums. If two DIFFERENT JS engines (Chrome V8 ↔ Safari JSC) produce identical
 * results, cross-engine lockstep is safe; if not, we learn it NOW (before building
 * racing). The #73 meta-test only proves V8↔V8 — this is the empirical cross-engine
 * check, run over the live connection.
 *
 * Pure (no DOM/WebRTC): reuses the #73/#80 sim harness. The RNG state is the
 * load-bearing comparison — it's an exact uint32 and it only advances on seeded
 * spawns, so any float divergence that shifts the spawn cadence shows up here as an
 * exact mismatch. Float fields are reported with a tolerance for visibility.
 */

import { createGameState, startRun, update } from '../game/GameState';
import { createIntent, type InputIntent } from '../game/Input';
import { NET, TIMESTEP } from '../utils/constants';

export interface ProbeChecksum {
  rngState: number; // exact uint32 anchor
  distance: number;
  lateral: number;
  score: number;
  frames: number;
}

/** Deterministic, RNG-free input as a pure function of the frame index. */
function probeIntent(f: number): InputIntent {
  const intent = createIntent();
  intent.steer = Math.sin(f * 0.1) * 0.7;
  return intent;
}

/** Run the probe sim and return its checksum. Classic mode, base car, fixed seed. */
export function probeChecksum(seed: number = NET.probeSeed, frames: number = NET.probeFrames): ProbeChecksum {
  const g = startRun(createGameState(seed), undefined, undefined, seed);
  for (let f = 0; f < frames; f++) update(g, probeIntent(f), TIMESTEP);
  return {
    rngState: g.rng.getState(),
    distance: g.distance,
    lateral: g.vehicle.lateral,
    score: g.score.score,
    frames,
  };
}

export interface ProbeVerdict {
  ok: boolean;
  detail: string;
}

/** Compare two peers' checksums. rngState must match EXACTLY (the desync anchor);
 *  float fields must agree within NET.probeEpsilon. */
export function compareProbe(local: ProbeChecksum, remote: ProbeChecksum): ProbeVerdict {
  if (local.frames !== remote.frames) {
    return { ok: false, detail: `frame count ${local.frames} vs ${remote.frames}` };
  }
  if (local.rngState !== remote.rngState) {
    return { ok: false, detail: `RNG desync — rngState ${local.rngState} vs ${remote.rngState}` };
  }
  const floats: Array<[string, number, number]> = [
    ['distance', local.distance, remote.distance],
    ['lateral', local.lateral, remote.lateral],
    ['score', local.score, remote.score],
  ];
  for (const [name, a, b] of floats) {
    const d = Math.abs(a - b);
    if (d > NET.probeEpsilon) return { ok: false, detail: `${name} differs by ${d.toExponential(2)}` };
  }
  return { ok: true, detail: `rngState match + floats within ${NET.probeEpsilon}` };
}
