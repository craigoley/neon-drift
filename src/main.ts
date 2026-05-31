/**
 * Entry point: constructs the rendering layer, owns the pure GameState, and runs
 * the fixed-timestep loop  input -> game.update() -> render -> repeat.
 *
 * This is the SCAFFOLD placeholder render. It proves the pipeline end to end —
 * a full-viewport WebGL canvas, the deep-purple scene, the glowing magenta road
 * stub, the cyan HUD title, a running RAF loop and resize handling — but there
 * is no gameplay yet. The seams (renderers, input, audio) are wired and inert.
 */

import './style.css';
import { SceneManager } from './rendering/SceneManager';
import { RoadRenderer } from './rendering/RoadRenderer';
import { VehicleRenderer } from './rendering/VehicleRenderer';
import { TrafficRenderer } from './rendering/TrafficRenderer';
import { PostProcessing } from './rendering/PostProcessing';
import { HUD } from './rendering/HUD';
import { createGameState, start, update } from './game/GameState';
import { Input } from './game/Input';
import { TIMESTEP } from './utils/constants';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app mount point');

// --- Rendering layer ------------------------------------------------------
const sceneManager = new SceneManager(app);
const post = new PostProcessing(sceneManager);
const roadRenderer = new RoadRenderer(sceneManager.scene);
const vehicleRenderer = new VehicleRenderer(sceneManager.scene);
const trafficRenderer = new TrafficRenderer(sceneManager.scene);
const hud = new HUD(app);

// --- Pure game layer ------------------------------------------------------
const input = new Input();
input.attach(window);
let game = start(createGameState());

// --- Fixed-timestep loop --------------------------------------------------
let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  accumulator += (now - last) / 1000;
  last = now;

  // Advance the pure simulation in fixed steps for determinism.
  while (accumulator >= TIMESTEP) {
    game = update(game, input.state, TIMESTEP, Math.random);
    accumulator -= TIMESTEP;
  }

  // Renderers read game state; they never mutate it.
  roadRenderer.sync(game.vehicle.distance);
  vehicleRenderer.sync(game.vehicle);
  trafficRenderer.sync(game.traffic);
  hud.sync(game.score.score, game.vehicle.speed);

  post.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// --- Viewport handling ----------------------------------------------------
window.addEventListener('resize', () => {
  sceneManager.resize(window.innerWidth, window.innerHeight);
  post.resize(window.innerWidth, window.innerHeight);
});
