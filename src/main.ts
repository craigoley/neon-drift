/**
 * Entry point: builds the rendering layer, owns the pure GameState, and runs the
 * fixed-timestep loop  input -> game.update() -> render -> repeat.
 *
 * Layering: device input (src/input) writes a pure InputIntent; the game layer
 * (src/game) advances pure state; the rendering layer (src/rendering) reads that
 * state and draws it. Renderers never mutate the simulation.
 */

import './style.css';
import { createGameState, pause, Phase, resume, returnToMenu, startRun, update } from './game/GameState';
import { normalizedSpeed } from './game/Vehicle';
import { Controls } from './input/Controls';
import { AudioEngine } from './audio/AudioEngine';
import { SceneManager } from './rendering/SceneManager';
import { Environment } from './rendering/Environment';
import { BiomeView } from './rendering/BiomeView';
import { RoadRenderer } from './rendering/RoadRenderer';
import { VehicleRenderer } from './rendering/VehicleRenderer';
import { CarPreview } from './rendering/CarPreview';
import { TrafficRenderer } from './rendering/TrafficRenderer';
import { PowerupRenderer } from './rendering/PowerupRenderer';
import { PostProcessing } from './rendering/PostProcessing';
import { SpeedLines } from './rendering/SpeedLines';
import { CrashShards } from './rendering/CrashShards';
import { ScreenFx } from './rendering/ScreenFx';
import { HUD } from './rendering/HUD';
import { DebugOverlay } from './rendering/DebugOverlay';
import { Shell } from './ui/Shell';
import { BestStore } from './storage/BestStore';
import { SettingsStore } from './state/Settings';
import { Telemetry } from './utils/Telemetry';
import {
  AUDIO,
  carById,
  cssHex,
  handlingFor,
  JUICE,
  MAX_FRAME_DT,
  OBSTACLE_DEFS,
  ObstacleKind,
  PALETTE,
  POWERUP_DEFS,
  PowerupKind,
  TIMESTEP,
} from './utils/constants';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app mount point');

const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// Pure game layer.
const game = createGameState();

// Device input. Keyboard always; touch additionally on touch devices (parity).
// Touch steering binds to the CANVAS (not `app`) so taps on the shell overlays
// reach their buttons instead of being captured as steering.
const controls = new Controls();
controls.attachKeyboard(window);

// Player settings (sound, selected car) — persisted to localStorage.
const settings = new SettingsStore();

// Synthesized audio — resumed on the first user gesture (autoplay policy).
const audio = new AudioEngine();
audio.setEnabled(settings.get('soundEnabled')); // honour persisted sound setting
const resumeAudio = () => void audio.resume();
window.addEventListener('keydown', resumeAudio, { once: true });
window.addEventListener('pointerdown', resumeAudio, { once: true });
window.addEventListener('touchstart', resumeAudio, { once: true });

// Rendering layer.
const scene = new SceneManager(app, isTouch);
const post = new PostProcessing(scene.scene, scene.camera, scene.renderer, isTouch);
const environment = new Environment(scene.scene, game.seed);
const biomeView = new BiomeView(scene.scene, environment);
const road = new RoadRenderer(scene.scene);
const vehicle = new VehicleRenderer(scene.scene);
vehicle.applyCar(carById(settings.get('selectedCarId'))); // persisted cosmetic
const traffic = new TrafficRenderer(scene.scene);
const powerups = new PowerupRenderer(scene.scene);
const speedLines = new SpeedLines(scene.scene);
const shards = new CrashShards(scene.scene);
const screenFx = new ScreenFx(app);
const hud = new HUD(app);
const debug = new DebugOverlay(app);
const telemetry = new Telemetry();

// Touch steering on the canvas; DRIFT button in `app` (shown only while playing).
if (isTouch) controls.attachTouch(scene.renderer.domElement, app);

// Persisted best run (localStorage).
const bestStore = new BestStore();

// Front-end shell (start / settings / car picker / crash overlays).
const canonicalUrl = window.location.origin + window.location.pathname;
// The car-picker 3D preview's renderer — created when the picker opens, disposed
// when it closes (held here so the shell callbacks can manage its lifecycle).
let carPreview: CarPreview | null = null;
const shell = new Shell(app, settings, bestStore, audio, {
  isTouch,
  shareUrl: canonicalUrl,
  // Resolve the selected car's handling fresh each run (the picker can change
  // it between runs) and pass it into the pure sim — the game layer never reads
  // settings/UI itself.
  onPlay: () => {
    audio.setMuted(false); // a fresh run is never muted (defensive)
    startRun(game, handlingFor(settings.get('selectedCarId')));
  },
  onPause: () => {
    pause(game);
    audio.setMuted(true); // silence the engine drone while paused
  },
  onResume: () => {
    resume(game);
    audio.setMuted(false);
  },
  onMenu: () => {
    returnToMenu(game); // fully reset — no stale run carries into the menu
    audio.setMuted(false);
  },
  applyCar: (carId) => vehicle.applyCar(carById(carId)),
  // 3D car-picker preview (own light renderer; created on enter, disposed on
  // exit — never runs behind the game).
  onCarPickerEnter: (container, carId) => {
    carPreview?.dispose();
    carPreview = new CarPreview(container);
    carPreview.setCar(carById(carId));
  },
  onCarPickerCar: (carId) => carPreview?.setCar(carById(carId)),
  onCarPickerExit: () => {
    carPreview?.dispose();
    carPreview = null;
  },
});
shell.showStart();

// Auto-pause when the tab/app is backgrounded mid-run (don't let it run blind).
// requestPause() is a no-op unless actually playing, so this never double-fires
// with the crash/menu overlays.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) shell.requestPause();
});

let last = performance.now();
let accumulator = 0;
let prevPhase = game.phase;
let slowmo = 0;

function frame(now: number): void {
  const ms = now - last;
  last = now;
  telemetry.push(ms);

  const realDt = Math.min(ms / 1000, MAX_FRAME_DT); // clamp tab-switch stalls
  const playing = game.phase === Phase.Playing;

  // Advance the sim only while playing. When on the menu / paused / crash
  // screens, don't bank time in the accumulator (so resuming never fast-forwards
  // a backlog of steps).
  let nearMisses = 0;
  let collectedKind: PowerupKind | null = null;
  let shieldBlocked = false;
  let rampBoosts = 0;
  let milestoneLabel: string | null = null;
  let biomeCelebrate = false;
  let objectiveLabel: string | null = null;
  if (playing) {
    // Optional micro slow-mo after a near-miss: feed the sim scaled time.
    const simScale = slowmo > 0 ? JUICE.slowmoScale : 1;
    if (slowmo > 0) slowmo -= realDt;
    accumulator += realDt * simScale;
    while (accumulator >= TIMESTEP) {
      update(game, controls.intent, TIMESTEP);
      nearMisses += game.lastEvents.nearMisses;
      if (game.lastEvents.collected) collectedKind = game.lastEvents.collected;
      if (game.lastEvents.shieldBlocked) shieldBlocked = true;
      rampBoosts += game.lastEvents.rampBoosts ?? 0;
      if (game.lastEvents.milestone) milestoneLabel = game.lastEvents.milestone;
      if (game.lastEvents.biomeChanged) biomeCelebrate = true;
      if (game.lastEvents.objectiveDone) objectiveLabel = game.lastEvents.objectiveDone;
      accumulator -= TIMESTEP;
    }
  } else {
    accumulator = 0;
  }
  controls.endFrame();

  const crashed = game.phase === Phase.Crashed && prevPhase === Phase.Playing;

  // Event-driven juice + audio.
  if (nearMisses > 0) {
    screenFx.pulseNearMiss();
    slowmo = JUICE.nearMissSlowmo;
  }
  // Powerup collection juice: a screen glow in the pickup's colour. A shield
  // absorbing a crash flashes the shield colour ("saved!").
  if (collectedKind) screenFx.pulsePickup(cssHex(POWERUP_DEFS[collectedKind].color));
  if (shieldBlocked) screenFx.pulsePickup(cssHex(POWERUP_DEFS[PowerupKind.Shield].color));
  // Ramp boost juice: a green flash in the ramp's "go" colour.
  if (rampBoosts > 0) screenFx.pulsePickup(cssHex(OBSTACLE_DEFS[ObstacleKind.Ramp].color));
  if (crashed) {
    scene.addShake(JUICE.shakeMagnitude);
    shards.burst(game.vehicle.lateral, JUICE.shardBurstY, 0);
    screenFx.flashCrash();
    bestStore.submit(game.distance, game.score.score); // update best before showing it
    shell.showCrash(game.score.score, game.distance, bestStore.best, game.score.peakCombo);
  }
  if (audio.started) {
    audio.setSpeed(normalizedSpeed(game.vehicle.speed));
    audio.setScreech(
      game.phase === Phase.Playing &&
        controls.intent.handbrake &&
        game.vehicle.speed > AUDIO.screechMinSpeed,
    );
    if (nearMisses > 0) audio.playNearMiss();
    if (collectedKind || shieldBlocked || rampBoosts > 0) audio.playPickup();
    if (crashed) audio.playCrash();
  }

  // Milestone / biome / objective celebration: a brief, non-intrusive toast plus
  // a fanfare (milestones + biome) or a lighter chime (objectives). Priority:
  // milestone > biome > objective — only one toast shows per frame.
  const toast = milestoneLabel
    ? { text: milestoneLabel, color: PALETTE.magenta, fanfare: true }
    : biomeCelebrate
      ? { text: 'NEW BIOME', color: PALETTE.cyan, fanfare: true }
      : objectiveLabel
        ? { text: objectiveLabel, color: PALETTE.cyan, fanfare: false }
        : null;
  if (toast) {
    hud.showToast(toast.text, cssHex(toast.color));
    if (audio.started) {
      if (toast.fanfare) audio.playMilestone();
      else audio.playPickup();
    }
  }
  prevPhase = game.phase;

  // Visuals advance on real time (only the simulation slows in slow-mo).
  scene.updateCamera(game, realDt);
  environment.update(game.distance, scene.camera.position.x, scene.camera.position.z, realDt);
  biomeView.apply(game.biome); // environment palette follows the active biome (self-throttled)
  road.sync(game.road, game.distance);
  vehicle.sync(game.vehicle);
  traffic.sync(game.traffic, game.distance);
  powerups.sync(game.powerups, game.distance, game.vehicle.lateral, realDt);
  // Speed lines only stream while actually playing — otherwise they keep
  // rushing on the frozen menu / pause / WIPEOUT screens (the cyan edge streak
  // seen on the crash screen). Feeding 0 fades them out.
  speedLines.update(
    scene.camera.position.x,
    scene.camera.position.y,
    scene.camera.position.z,
    playing ? normalizedSpeed(game.vehicle.speed) : 0,
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
