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
import { nearMissTier } from './game/Scoring';
import { normalizedSpeed } from './game/Vehicle';
import { Controls } from './input/Controls';
import { AudioEngine } from './audio/AudioEngine';
import { SceneManager } from './rendering/SceneManager';
import { Environment } from './rendering/Environment';
import { BiomeView } from './rendering/BiomeView';
import { Starfield } from './rendering/Starfield';
import { ParallaxScenery } from './rendering/ParallaxScenery';
import { RoadRenderer } from './rendering/RoadRenderer';
import { VehicleRenderer } from './rendering/VehicleRenderer';
import { CarPreview } from './rendering/CarPreview';
import { TrafficRenderer } from './rendering/TrafficRenderer';
import { PowerupRenderer } from './rendering/PowerupRenderer';
import { PostProcessing } from './rendering/PostProcessing';
import { SpeedLines } from './rendering/SpeedLines';
import { CarTrail } from './rendering/CarTrail';
import { CrashShards } from './rendering/CrashShards';
import { ScreenFx } from './rendering/ScreenFx';
import { HUD } from './rendering/HUD';
import { DebugOverlay } from './rendering/DebugOverlay';
import { Shell } from './ui/Shell';
import { LeaderboardStore, type RunPlacement } from './state/Leaderboard';
import { DailyStore, type DailyResult } from './state/DailyStore';
import { dailyDateKey, dailySeed } from './utils/daily';
import { SettingsStore } from './state/Settings';
import { ProgressStore } from './state/Progress';
import { unlockProgress } from './state/Unlocks';
import { MissionStore } from './state/MissionStore';
import { missionProgress, startBiomeUnlockRank } from './state/Missions';
import { biomesSeenForDistance } from './game/Biome';
import { Telemetry } from './utils/Telemetry';
import { lerp } from './utils/math';
import {
  AUDIO,
  BIOMES,
  carById,
  cssHex,
  handlingFor,
  JUICE,
  POSTFX,
  MAX_FRAME_DT,
  OBSTACLE_DEFS,
  ObstacleKind,
  PALETTE,
  POWERUP_DEFS,
  PowerupKind,
  RANKS,
  scoringFor,
  STARTER_CAR_ID,
  TIMESTEP,
} from './utils/constants';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app mount point');

const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// Pure game layer.
const game = createGameState();

// A fresh 32-bit run seed per PLAY so every run generates a DIFFERENT course.
// (The generator is fully seeded/deterministic; without this the seed stayed at
// the fixed default and every run replayed the identical course — the root cause
// of "every run feels the same".) The pure layer stays deterministic — the
// impurity (Math.random) lives only here in the composition root; tests pass
// explicit seeds.
const randomSeed = (): number => (Math.random() * 0x1_0000_0000) >>> 0;

// Device input. Keyboard always; touch additionally on touch devices (parity).
// Touch steering binds to the CANVAS (not `app`) so taps on the shell overlays
// reach their buttons instead of being captured as steering.
const controls = new Controls();
controls.attachKeyboard(window);

// Player settings (sound, selected car) — persisted to localStorage.
const settings = new SettingsStore();

// Cross-run progression: lifetime stats + unlocked cars (resilient store).
const progress = new ProgressStore();

// Across-run missions + rank (resilient store; layered meta, never gates play).
const missions = new MissionStore();

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
// Honour the persisted "Retro FX" setting (off = disable the cinematic pass).
post.setCinematicEnabled(!settings.get('lowFx'));
const environment = new Environment(scene.scene, game.seed);
const stars = new Starfield(scene.scene, game.seed);
const scenery = new ParallaxScenery(scene.scene);
const road = new RoadRenderer(scene.scene);
// Resolve the persisted car against the unlock state: a returning player whose
// saved selection is now locked (re-gated since they last played) snaps back to
// the always-free starter — so the menu/picker never open on a locked car.
if (!progress.isUnlocked(settings.get('selectedCarId'))) {
  settings.set('selectedCarId', STARTER_CAR_ID);
}
// Seed the renderer with the persisted car so the initial silhouette + colours
// are correct from the first frame (no flash of the base shape).
const vehicle = new VehicleRenderer(scene.scene, carById(settings.get('selectedCarId')));
const traffic = new TrafficRenderer(scene.scene);
const powerups = new PowerupRenderer(scene.scene);
// Biome view drives the environment palette + star brightness + a faint traffic
// tint, so it's built after the things it recolours.
const biomeView = new BiomeView(scene.scene, environment, stars, traffic);
// Motion juice — speed lines + the car light-trail; both scale density DOWN on
// touch for mobile GPU headroom.
const speedLines = new SpeedLines(scene.scene, isTouch ? JUICE.speedLineCountTouch : JUICE.speedLineCount);
const trail = new CarTrail(scene.scene, isTouch);
const trailInfo = { active: 0, cap: 0 };
const shards = new CrashShards(scene.scene);
const screenFx = new ScreenFx(app);
const hud = new HUD(app);
const debug = new DebugOverlay(app);
const telemetry = new Telemetry();

// Touch steering on the canvas; DRIFT button in `app` (shown only while playing).
if (isTouch) controls.attachTouch(scene.renderer.domElement, app);

// Persisted leaderboard: top-10 runs + per-car bests (localStorage). Migrates
// the legacy single-best on first load; the "BEST" readout derives from #1.
const leaderboard = new LeaderboardStore();

// Daily challenge results (OPP-09): per-day best + run count, kept SEPARATE from
// the leaderboard (fixed per-date seed, not comparable to random runs).
const daily = new DailyStore();

// Front-end shell (start / settings / car picker / crash overlays).
const canonicalUrl = window.location.origin + window.location.pathname;
// The car-picker 3D preview's renderer — created when the picker opens, disposed
// when it closes (held here so the shell callbacks can manage its lifecycle).
let carPreview: CarPreview | null = null;

// Resolve the car to start a run in, defensively falling back to the always-free
// starter if the persisted selection is somehow locked. Shared by the normal and
// daily launch paths so both apply the same guard.
const resolvePlayCarId = (): string => {
  let carId = settings.get('selectedCarId');
  if (!progress.isUnlocked(carId)) {
    carId = STARTER_CAR_ID;
    settings.set('selectedCarId', carId);
    vehicle.applyCar(carById(carId));
  }
  return carId;
};
const shell = new Shell(app, settings, leaderboard, audio, {
  isTouch,
  shareUrl: canonicalUrl,
  // Resolve the selected car's handling fresh each run (the picker can change
  // it between runs) and pass it into the pure sim — the game layer never reads
  // settings/UI itself.
  onPlay: () => {
    audio.setMuted(false); // a fresh run is never muted (defensive)
    const carId = resolvePlayCarId();
    // The chosen starting biome is a cosmetic mission/rank reward (visual only).
    // Fresh random seed each run → a genuinely different course every time.
    startRun(game, handlingFor(carId), missions.startBiome(), randomSeed(), scoringFor(carId));
  },
  // OPP-09: start TODAY'S daily challenge — same fixed seed all day (replayable),
  // and flagged isDaily=true so the run-end routes its result to the daily store,
  // not the main leaderboard. Uses the player's LOCAL date (see dailySeed).
  onPlayDaily: () => {
    audio.setMuted(false);
    const carId = resolvePlayCarId();
    startRun(game, handlingFor(carId), missions.startBiome(), dailySeed(new Date()), scoringFor(carId), true);
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
    carPreview = new CarPreview(container, carById(carId));
  },
  onCarPickerCar: (carId) => carPreview?.setCar(carById(carId)),
  onCarPickerExit: () => {
    carPreview?.dispose();
    carPreview = null;
  },
  // Picker lock state: a persisted-unlocked car is null (selectable); otherwise
  // show its requirement + live progress. Monotonic — once earned, never locked.
  carLock: (carId) => (progress.isUnlocked(carId) ? null : unlockProgress(carId, progress.getStats())),
  // "Retro FX" toggle from the settings panel → enable/disable the cinematic pass.
  onLowFxChange: (lowFx) => post.setCinematicEnabled(!lowFx),
  // MISSIONS panel data (read fresh each time the panel opens). All cosmetic —
  // nothing here gates the core run.
  missions: {
    active: () => {
      const st = missions.state();
      return st.active.map((m) => missionProgress(m, st.stats));
    },
    rank: () => {
      const st = missions.state();
      const next = RANKS[st.rank + 1];
      const nextUnlock = next
        ? next.reward.startBiome !== undefined
          ? `Start in ${BIOMES[next.reward.startBiome].displayName}`
          : `Title: ${next.reward.title}`
        : null;
      return {
        name: RANKS[st.rank].name,
        completed: st.completed,
        nextName: next ? next.name : null,
        toNext: next ? Math.max(0, next.missionsRequired - st.completed) : 0,
        nextUnlock,
      };
    },
    startBiomes: () =>
      BIOMES.map((b, index) => {
        const unlocked = missions.startBiomeUnlocked(index);
        const r = startBiomeUnlockRank(index);
        return {
          index,
          name: b.displayName,
          unlocked,
          requirement: unlocked || r === null ? null : `Rank: ${RANKS[r].name}`,
          selected: index === missions.startBiome(),
        };
      }),
    selectStartBiome: (index: number) => missions.setStartBiome(index),
  },
  // OPP-09 DAILY panel data (read fresh each time the screen opens). `today` is
  // keyed on the player's LOCAL date; history is the rolling 7-day window.
  daily: {
    today: () => daily.today(dailyDateKey(new Date())),
    history: () => daily.history(),
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
const NO_UNLOCKS: string[] = [];

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
  let nearMissClosest = Infinity; // smallest near-miss gap across this frame's substeps (OPP-14)
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
      nearMissClosest = Math.min(nearMissClosest, game.lastEvents.nearMissClosest ?? Infinity);
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

  // Near-miss CRESCENDO (OPP-13+04): feedback escalates across 4 combo bands —
  // restrained at low combo, an event at a high streak. The tier comes from the
  // live combo (scoring is unchanged); each channel scales by the JUICE table.
  // OPP-14 tie-in: a tight GRAZE (very close pass) bumps the tier by +1 (capped),
  // so shaving the paint punches above its combo band even at a low combo.
  const grazeBump = nearMissClosest <= JUICE.nearMissGrazeBumpGap ? 1 : 0;
  const nmTier = nearMisses > 0 ? Math.min(nearMissTier(game.score.combo) + grazeBump, JUICE.nearMissTierThresholds.length) : 0;
  if (nearMisses > 0) {
    screenFx.pulseNearMiss(JUICE.nearMissEdge[nmTier]); // brighter edge at higher tier
    speedLines.burst(); // a quick whoosh streak reinforcing the near-miss/combo
    slowmo = JUICE.nearMissSlowmo;
    const shakeMag = JUICE.nearMissShake[nmTier];
    if (shakeMag > 0) scene.addShake(shakeMag); // tier 0 = no shake (stays slick)
    if (nmTier >= JUICE.nearMissCalloutTier) hud.showNearMiss(JUICE.nearMissCalloutText[nmTier]);
    if (nmTier >= JUICE.nearMissCaTier) post.pulseAberration(POSTFX.aberrationPulsePeak); // top tier only
  }
  // Powerup collection juice: a screen glow in the pickup's colour. A shield
  // absorbing a crash flashes the shield colour ("saved!").
  if (collectedKind) screenFx.pulsePickup(cssHex(POWERUP_DEFS[collectedKind].color));
  if (shieldBlocked) screenFx.pulsePickup(cssHex(POWERUP_DEFS[PowerupKind.Shield].color));
  // Ramp boost juice: a green flash in the ramp's "go" colour.
  if (rampBoosts > 0) screenFx.pulsePickup(cssHex(OBSTACLE_DEFS[ObstacleKind.Ramp].color));
  let unlockedNames = NO_UNLOCKS;
  let missionLines = NO_UNLOCKS;
  if (crashed) {
    scene.addShake(JUICE.shakeMagnitude);
    shards.burst(game.vehicle.lateral, JUICE.shardBurstY, 0);
    screenFx.flashCrash();
    const carIdNow = settings.get('selectedCarId');
    // Route the result by run type, keeping daily + main board SEPARATE (OPP-09).
    // A DAILY run records ONLY to the daily store (today's best + run count); a
    // normal run records ONLY to the leaderboard. Neither writes to the other.
    let placement: RunPlacement | null = null;
    let dailyResult: DailyResult | null = null;
    let bestForCrash = leaderboard.bestRun();
    if (game.isDaily) {
      dailyResult = daily.submitDaily(dailyDateKey(new Date()), game.score.score, game.distance, carIdNow);
      bestForCrash = { distance: dailyResult.bestDistance, score: dailyResult.bestScore };
    } else {
      placement = leaderboard.submit({
        score: game.score.score,
        distance: game.distance,
        carId: carIdNow,
      });
    }
    // Fold this run into the lifetime totals and surface anything newly unlocked.
    const result = progress.recordRun({
      distance: game.distance,
      bestCombo: game.score.peakCombo,
      powerupsCollected: game.powerups.collected,
      biomesSeen: biomesSeenForDistance(game.distance),
    });
    unlockedNames = result.newlyUnlocked.map((id) => carById(id).displayName);
    // Commit the run to the across-run mission/rank progression (crash included).
    const mission = missions.commitRun({
      nearMisses: game.score.nearMisses,
      powerups: game.powerups.collected,
      shields: game.runStats.shields,
      driftSeconds: game.runStats.driftSeconds,
      distance: game.distance,
      score: game.score.score,
      reachedMidnight: biomesSeenForDistance(game.distance) >= 2,
    });
    missionLines = [
      ...mission.completedMissions.map((l) => `MISSION COMPLETE: ${l}`),
      ...mission.rankUps.map((n) => `RANK UP: ${n}!`),
      ...mission.unlocked.map((u) => `UNLOCKED: ${u}`),
    ];
    shell.showCrash(
      game.score.score,
      game.distance,
      bestForCrash,
      game.score.peakCombo,
      unlockedNames,
      missionLines,
      placement,
      dailyResult,
    );
  }
  if (audio.started) {
    audio.setSpeed(normalizedSpeed(game.vehicle.speed));
    // Biome-aware tone: glide the engine voicing between the current → next biome.
    audio.setBiomeTone(lerp(BIOMES[game.biome.from].audioTone, BIOMES[game.biome.to].audioTone, game.biome.blend));
    audio.setScreech(
      game.phase === Phase.Playing &&
        controls.intent.handbrake &&
        game.vehicle.speed > AUDIO.screechMinSpeed,
    );
    if (nearMisses > 0) audio.playNearMiss(JUICE.nearMissPitch[nmTier]); // riser scales with tier
    if (collectedKind || shieldBlocked || rampBoosts > 0) audio.playPickup();
    if (crashed) audio.playCrash();
    // Unlock / mission / rank fanfare over the WIPEOUT (milestone three-note chime).
    if (unlockedNames.length > 0 || missionLines.length > 0) audio.playMilestone();
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
  stars.update(scene.camera.position.x, scene.camera.position.z);
  scenery.update(game.distance, scene.camera.position.x); // bounded roadside parallax props
  biomeView.apply(game.biome); // environment palette + stars + traffic tint follow the active biome (self-throttled)
  road.sync(game.road, game.distance);
  vehicle.sync(game.vehicle);
  // Car light-trail: lengthens with speed, hotter while drifting. Fed 0 speed
  // when not playing so it fades out on the menu / pause / WIPEOUT screens.
  trail.update(
    game.vehicle.lateral,
    playing ? game.vehicle.speed : 0,
    playing ? normalizedSpeed(game.vehicle.speed) : 0,
    playing && game.vehicle.drifting,
    realDt,
  );
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
  hud.sync(game, leaderboard.bestRun());
  trailInfo.active = trail.activeCount();
  trailInfo.cap = trail.capacity();
  debug.update(game, telemetry, hud.comboText(), trailInfo, scenery.activeCount);

  post.render(realDt);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  scene.resize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});
