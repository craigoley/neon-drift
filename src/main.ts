/**
 * Entry point. SCAFFOLD STAGE: the pure game layer + telemetry are built and
 * tested first; the three.js rendering layer is added in a later step. For now
 * this boots the pure simulation on a fixed-timestep loop with no input, with
 * the debug overlay wired so pool counts are visible. Replaced in Step 4.
 */

import './style.css';
import { createGameState, startRun, update } from './game/GameState';
import { createIntent } from './game/Input';
import { Telemetry } from './utils/Telemetry';
import { DebugOverlay } from './rendering/DebugOverlay';
import { TIMESTEP } from './utils/constants';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app mount point');

const telemetry = new Telemetry();
const debug = new DebugOverlay(app);
const intent = createIntent();
let game = startRun(createGameState());

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  const ms = now - last;
  telemetry.push(ms);
  accumulator += ms / 1000;
  last = now;
  while (accumulator >= TIMESTEP) {
    game = update(game, intent, TIMESTEP);
    accumulator -= TIMESTEP;
  }
  debug.update(game, telemetry);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
