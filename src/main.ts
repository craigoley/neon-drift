/**
 * Entry point: builds the rendering layer, owns the pure GameState, and runs the
 * fixed-timestep loop  input -> game.update() -> render -> repeat.
 *
 * Layering: device input (src/input) writes a pure InputIntent; the game layer
 * (src/game) advances pure state; the rendering layer (src/rendering) reads that
 * state and draws it. Renderers never mutate the simulation.
 */

import './style.css';
import { createGameState, update } from './game/GameState';
import { Controls } from './input/Controls';
import { SceneManager } from './rendering/SceneManager';
import { Environment } from './rendering/Environment';
import { RoadRenderer } from './rendering/RoadRenderer';
import { VehicleRenderer } from './rendering/VehicleRenderer';
import { TrafficRenderer } from './rendering/TrafficRenderer';
import { HUD } from './rendering/HUD';
import { DebugOverlay } from './rendering/DebugOverlay';
import { Telemetry } from './utils/Telemetry';
import { TIMESTEP } from './utils/constants';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app mount point');

const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// Pure game layer.
const game = createGameState();

// Device input.
const controls = new Controls();
controls.attachKeyboard(window);

// Rendering layer.
const scene = new SceneManager(app, isTouch);
const environment = new Environment(scene.scene, game.seed);
const road = new RoadRenderer(scene.scene);
const vehicle = new VehicleRenderer(scene.scene);
const traffic = new TrafficRenderer(scene.scene);
const hud = new HUD(app);
const debug = new DebugOverlay(app);
const telemetry = new Telemetry();

// Best run (wired to persistence in a later step).
const best = { distance: 0, score: 0 };

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  const ms = now - last;
  last = now;
  telemetry.push(ms);

  accumulator += ms / 1000;
  // Clamp to avoid a spiral of death after a tab-switch stall.
  if (accumulator > 0.25) accumulator = 0.25;
  while (accumulator >= TIMESTEP) {
    update(game, controls.intent, TIMESTEP);
    accumulator -= TIMESTEP;
  }
  controls.endFrame();

  const dt = ms / 1000;
  scene.updateCamera(game, dt);
  environment.update(game.distance, scene.camera.position.x, scene.camera.position.z);
  road.sync(game.road, game.distance);
  vehicle.sync(game.vehicle);
  traffic.sync(game.traffic, game.distance);
  hud.sync(game, best);
  debug.update(game, telemetry);

  scene.renderer.render(scene.scene, scene.camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  scene.resize(window.innerWidth, window.innerHeight);
});
