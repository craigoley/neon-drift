/**
 * Entry point: builds the rendering layer, owns the pure GameState, and runs the
 * fixed-timestep loop  input -> game.update() -> render -> repeat.
 *
 * Layering: device input (src/input) writes a pure InputIntent; the game layer
 * (src/game) advances pure state; the rendering layer (src/rendering) reads that
 * state and draws it. Renderers never mutate the simulation.
 */

import './style.css';
import { createGameState, Phase, update } from './game/GameState';
import { normalizedSpeed } from './game/Vehicle';
import { Controls } from './input/Controls';
import { AudioEngine } from './audio/AudioEngine';
import { SceneManager } from './rendering/SceneManager';
import { Environment } from './rendering/Environment';
import { RoadRenderer } from './rendering/RoadRenderer';
import { VehicleRenderer } from './rendering/VehicleRenderer';
import { TrafficRenderer } from './rendering/TrafficRenderer';
import { PostProcessing } from './rendering/PostProcessing';
import { SpeedLines } from './rendering/SpeedLines';
import { CrashShards } from './rendering/CrashShards';
import { ScreenFx } from './rendering/ScreenFx';
import { HUD } from './rendering/HUD';
import { DebugOverlay } from './rendering/DebugOverlay';
import { BestStore } from './storage/BestStore';
import { Telemetry } from './utils/Telemetry';
import { AUDIO, JUICE, MAX_FRAME_DT, TIMESTEP } from './utils/constants';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app mount point');

const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
// Debug mode (?debug=1): enables the funnel panel and the mesh-identification
// tints (headlight cones -> green, mountains -> blue).
const isDebug = new URLSearchParams(window.location.search).get('debug') === '1';

// Pure game layer.
const game = createGameState();

// Device input. Keyboard always; touch additionally on touch devices (parity).
const controls = new Controls();
controls.attachKeyboard(window);
if (isTouch) controls.attachTouch(app, app);

// Synthesized audio — resumed on the first user gesture (autoplay policy).
const audio = new AudioEngine();
const resumeAudio = () => void audio.resume();
window.addEventListener('keydown', resumeAudio, { once: true });
window.addEventListener('pointerdown', resumeAudio, { once: true });
window.addEventListener('touchstart', resumeAudio, { once: true });

// Rendering layer.
const scene = new SceneManager(app, isTouch);
const post = new PostProcessing(scene.scene, scene.camera, scene.renderer, isTouch);
const environment = new Environment(scene.scene, game.seed, isDebug);
const road = new RoadRenderer(scene.scene);
const vehicle = new VehicleRenderer(scene.scene, isDebug);
const traffic = new TrafficRenderer(scene.scene);
const speedLines = new SpeedLines(scene.scene);
const shards = new CrashShards(scene.scene);
const screenFx = new ScreenFx(app);
const hud = new HUD(app);
const debug = new DebugOverlay(app);
const telemetry = new Telemetry();

// Persisted best run (localStorage).
const bestStore = new BestStore();

let last = performance.now();
let accumulator = 0;
let prevPhase = game.phase;
let slowmo = 0;

function frame(now: number): void {
  const ms = now - last;
  last = now;
  telemetry.push(ms);

  const realDt = Math.min(ms / 1000, MAX_FRAME_DT); // clamp tab-switch stalls
  // Optional micro slow-mo after a near-miss: feed the sim scaled time.
  const simScale = slowmo > 0 ? JUICE.slowmoScale : 1;
  if (slowmo > 0) slowmo -= realDt;

  accumulator += realDt * simScale;
  let nearMisses = 0;
  while (accumulator >= TIMESTEP) {
    update(game, controls.intent, TIMESTEP);
    nearMisses += game.lastEvents.nearMisses;
    accumulator -= TIMESTEP;
  }
  controls.endFrame();

  const crashed = game.phase === Phase.Crashed && prevPhase === Phase.Playing;

  // Event-driven juice + audio.
  if (nearMisses > 0) {
    screenFx.pulseNearMiss();
    slowmo = JUICE.nearMissSlowmo;
  }
  if (crashed) {
    scene.addShake(JUICE.shakeMagnitude);
    shards.burst(game.vehicle.lateral, JUICE.shardBurstY, 0);
    screenFx.flashCrash();
    bestStore.submit(game.distance, game.score.score);
  }
  if (audio.started) {
    audio.setSpeed(normalizedSpeed(game.vehicle.speed));
    audio.setScreech(
      game.phase === Phase.Playing &&
        controls.intent.handbrake &&
        game.vehicle.speed > AUDIO.screechMinSpeed,
    );
    if (nearMisses > 0) audio.playNearMiss();
    if (crashed) audio.playCrash();
  }
  prevPhase = game.phase;

  // Visuals advance on real time (only the simulation slows in slow-mo).
  scene.updateCamera(game, realDt);
  environment.update(game.distance, scene.camera.position.x, scene.camera.position.z);
  road.sync(game.road, game.distance);
  vehicle.sync(game.vehicle);
  traffic.sync(game.traffic, game.distance);
  speedLines.update(
    scene.camera.position.x,
    scene.camera.position.y,
    scene.camera.position.z,
    normalizedSpeed(game.vehicle.speed),
    realDt,
  );
  shards.update(realDt);
  screenFx.update(realDt);
  hud.sync(game, bestStore.best);
  debug.update(game, telemetry, hud.comboText());

  post.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  scene.resize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});
