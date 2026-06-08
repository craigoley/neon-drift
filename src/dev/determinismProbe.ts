/**
 * CROSS-ENGINE DETERMINISM PROBE (MP harness PR-A — diagnostic, test-only).
 *
 * Runs the PURE sim (src/game) headlessly on a real race configuration and returns
 * the per-frame #89 world checksums. Loaded by /probe.html and exposed on
 * `window.__determinismProbe` so a Playwright test can run it IN-PAGE — i.e. inside
 * that browser's JS engine (V8 in chromium, JavaScriptCore in webkit). Comparing the
 * two engines' checksum sequences reproduces the cross-engine FP divergence.
 *
 * NOT in src/game/ (this is a dev/test hook). Imports ONLY the pure sim + the pure
 * checksum (Desync), so there's no three.js/WebGL — it runs in a bare page in any
 * engine. The scripted steering uses ONLY basic arithmetic (no Math.sin/cos): the
 * INPUT must be bit-identical across engines, or it would mask the SIM's divergence.
 */

import { createGameState, GameMode, startRun, update } from '../game/GameState';
import { createIntent } from '../game/Input';
import { handlingFor, scoringFor, slowMoFor, TIMESTEP } from '../utils/constants';
import { worldSum, type WorldSum } from '../net/Desync';

export interface ProbeConfig {
  seed: number;
  carA: string;
  carB: string;
  frames: number;
  sampleEvery: number;
}

/**
 * Deterministic triangle-wave steer (basic ops only — no transcendentals). Weaves the
 * car wall-to-wall so it threads/clips traffic and crashes (the crash slowdown is a
 * known amplifier). A per-car phase makes the two cars drive different lines.
 */
function triSteer(frame: number, phase: number): number {
  const period = 90;
  const x = ((frame + phase) % period) / period; // [0, 1)
  const tri = x < 0.5 ? x * 4 - 1 : 3 - x * 4; // [-1, 1] triangle
  return tri * 0.85;
}

/** Run both cars on the shared seed for `frames` frames; sample world checksums. */
export function runDeterminismProbe(cfg: ProbeConfig): WorldSum[] {
  const a = startRun(createGameState(cfg.seed), handlingFor(cfg.carA), 0, cfg.seed, scoringFor(cfg.carA), GameMode.Classic, slowMoFor(cfg.carA), true);
  const b = startRun(createGameState(cfg.seed), handlingFor(cfg.carB), 0, cfg.seed, scoringFor(cfg.carB), GameMode.Classic, slowMoFor(cfg.carB), true);
  const out: WorldSum[] = [];
  for (let f = 0; f < cfg.frames; f++) {
    const ia = createIntent();
    ia.steer = triSteer(f, 0);
    const ib = createIntent();
    ib.steer = triSteer(f, 37);
    update(a, ia, TIMESTEP);
    update(b, ib, TIMESTEP);
    if (f % cfg.sampleEvery === 0) out.push(worldSum(f, a, b));
  }
  return out;
}

declare global {
  interface Window {
    __determinismProbe?: (cfg: ProbeConfig) => WorldSum[];
  }
}

window.__determinismProbe = runDeterminismProbe;
