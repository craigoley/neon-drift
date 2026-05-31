/**
 * Entry point. SCAFFOLD STAGE: the pure game layer is built and tested first;
 * the three.js rendering layer is added in a later step. For now this boots the
 * pure simulation on a fixed-timestep loop with no input, proving the pure loop
 * runs in the browser with zero rendering dependencies. Replaced in Step 4.
 */

import './style.css';
import { createGameState, startRun, update } from './game/GameState';
import { createIntent } from './game/Input';
import { TIMESTEP } from './utils/constants';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app mount point');

const status = document.createElement('pre');
status.style.color = '#00ffff';
status.style.fontFamily = 'monospace';
status.style.padding = '16px';
app.appendChild(status);

const intent = createIntent();
let game = startRun(createGameState());

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  accumulator += (now - last) / 1000;
  last = now;
  while (accumulator >= TIMESTEP) {
    game = update(game, intent, TIMESTEP);
    accumulator -= TIMESTEP;
  }
  status.textContent =
    `NEON DRIFT — pure sim running (rendering pending)\n` +
    `phase: ${game.phase}\n` +
    `distance: ${game.distance.toFixed(1)}\n` +
    `speed: ${game.vehicle.speed.toFixed(1)}\n` +
    `score: ${game.score.score.toFixed(0)}\n` +
    `road segments: ${game.road.segments.length} (spawned ${game.road.spawned})\n` +
    `traffic spawned/culled: ${game.traffic.spawned}/${game.traffic.culled}`;
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
