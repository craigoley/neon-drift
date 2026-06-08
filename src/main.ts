/**
 * Entry point: builds the rendering layer, owns the pure GameState, and runs the
 * fixed-timestep loop  input -> game.update() -> render -> repeat.
 *
 * Layering: device input (src/input) writes a pure InputIntent; the game layer
 * (src/game) advances pure state; the rendering layer (src/rendering) reads that
 * state and draws it. Renderers never mutate the simulation.
 */

import './style.css';
import { createGameState, type GameState, GameMode, isSlalom, pause, Phase, resume, returnToMenu, startRun, update } from './game/GameState';
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
import { FinishLine } from './rendering/FinishLine';
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
import { GhostStore } from './state/GhostStore';
import {
  buildRecording,
  createGhostState,
  createRecordingBuffer,
  deploySetOf,
  recordFrame,
  type GhostRecording,
  type RecordingBuffer,
} from './game/Replay';
import { createIntent } from './game/Input';
import { SettingsStore } from './state/Settings';
import { ProgressStore } from './state/Progress';
import { unlockProgress } from './state/Unlocks';
import { MissionStore } from './state/MissionStore';
import { missionProgress, startBiomeUnlockRank } from './state/Missions';
import { biomesSeenForDistance } from './game/Biome';
import { roadCenterAt } from './game/Road';
import { MpRace } from './net/MpRace';
import { mountMpRaceUI } from './net/MpRaceUI';
import { Telemetry } from './utils/Telemetry';
import { lerp } from './utils/math';
import {
  BIOMES,
  carById,
  cssHex,
  GHOST,
  handlingFor,
  JUICE,
  MP_RACE,
  POSTFX,
  MAX_FRAME_DT,
  OBSTACLE_DEFS,
  ObstacleKind,
  PALETTE,
  POWERUP_DEFS,
  PowerupKind,
  RANKS,
  scoringFor,
  slowMoFor,
  SLALOM_FX,
  STARTER_CAR_ID,
  TIMESTEP,
} from './utils/constants';

// TEST HOOKS (render-layer only — these live in the composition root, NEVER in
// the pure src/game/ layer): `window.__READY__` is flipped true once the first
// frame has actually been drawn, so an automated browser smoke test can wait for
// a real rendered scene before asserting/screenshotting.
declare global {
  interface Window {
    __READY__?: boolean;
  }
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app mount point');

const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// Optional ?seed= URL override (test hook): pins the seed so a browser smoke test
// boots a DETERMINISTIC scene. null when absent (the normal case). Coerced to a
// 32-bit unsigned int to match the pure layer's seed handling.
const urlSeed = ((): number | null => {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n >>> 0 : null;
})();

// Pure game layer. A ?seed= override makes the initial (menu) scene deterministic;
// otherwise the default seed is used until the first PLAY.
const game = urlSeed !== null ? createGameState(urlSeed) : createGameState();

// A fresh 32-bit run seed per PLAY so every run generates a DIFFERENT course.
// (The generator is fully seeded/deterministic; without this the seed stayed at
// the fixed default and every run replayed the identical course — the root cause
// of "every run feels the same".) The pure layer stays deterministic — the
// impurity (Math.random) lives only here in the composition root; tests pass
// explicit seeds.
const randomSeed = (): number => (Math.random() * 0x1_0000_0000) >>> 0;
// With a ?seed= override every PLAY reuses it (deterministic runs for tests);
// otherwise a fresh random course each play.
const playSeed = (): number => (urlSeed !== null ? urlSeed : randomSeed());

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
post.setQuality(!settings.get('lowFx')); // Retro FX off = LOW quality (skips bloom — the perf lever)
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
// RIVAL GHOST: a SECOND translucent car, drawn from a SECOND sim state replayed in
// lockstep with the live run (input-replay — see game/Replay.ts). Built once;
// restyled to the recorded car's silhouette + ghost look at each race start.
const ghostRenderer = new VehicleRenderer(scene.scene);
ghostRenderer.setVisible(false);
// LIVE 2P (MP-1 PR2): the remote player's car — a SOLID rival (its own car cosmetic,
// not a translucent ghost), drawn from the remote GameState stepped in lockstep.
const rivalRenderer = new VehicleRenderer(scene.scene);
rivalRenderer.setVisible(false);
// LIVE 2P (PR3-pt2): the finish line, drawn at the shared finish distance.
const finishLine = new FinishLine(scene.scene);
let mpRace: MpRace | null = null; // non-null + isRacing ⇒ a live 2P race is running
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

// Rival-ghost recordings: the best input-replay per mode (classic / daily).
const ghosts = new GhostStore();

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
// --- Rival ghost run-state (spans the frame loop) -------------------------------
let recBuf: RecordingBuffer = createRecordingBuffer(); // the live run's recorded intents
let ghostGame: GameState | null = null; // the replaying ghost sim (null = not racing one)
let ghostRec: GhostRecording | null = null;
let ghostDeploySet = new Set<number>();
let ghostFrame = 0;
let ghostActive = false; // still feeding recorded intents (false once the recording ends)
let ghostBeaten = false; // latched the moment the live run out-scores the ghost's final score
const ghostScratchIntent = createIntent(); // reused each sub-step (no per-frame allocation)

/**
 * Set up recording + (optionally) the rival ghost for a starting run, returning the
 * SEED the live run should use. When racing a ghost we run on ITS seed so both race
 * the SAME course: classic adopts the ghost's recorded seed; daily already shares
 * today's fixed seed, so we only race a ghost recorded on today's seed (a stale
 * ghost from another day is skipped). Sets module run-state only.
 */
function setupRunGhost(mode: GameMode, defaultSeed: number): number {
  recBuf = createRecordingBuffer();
  ghostGame = null;
  ghostRec = null;
  ghostActive = false;
  ghostBeaten = false;
  ghostRenderer.setVisible(false);

  const rec = settings.get('ghostRace') ? ghosts.get(mode) : null;
  if (!rec || (mode === GameMode.DailySlalom && rec.seed !== defaultSeed)) return defaultSeed;

  const liveSeed = mode === GameMode.Classic ? rec.seed : defaultSeed;
  ghostRec = rec;
  ghostDeploySet = deploySetOf(rec);
  ghostFrame = 0;
  ghostActive = true;
  ghostGame = createGhostState(rec, {
    handling: handlingFor(rec.carId),
    scoring: scoringFor(rec.carId),
    slowMo: slowMoFor(rec.carId),
  });
  ghostRenderer.applyCar(carById(rec.carId)); // the recorded car's silhouette...
  ghostRenderer.makeGhost(); // ...restyled as the translucent phantom
  return liveSeed;
}

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
    // Fresh random seed each run — UNLESS racing the ghost, which adopts the ghost's
    // recorded seed so both run the same course (setupRunGhost returns the seed).
    const seed = setupRunGhost(GameMode.Classic, playSeed());
    startRun(game, handlingFor(carId), missions.startBiome(), seed, scoringFor(carId), GameMode.Classic, slowMoFor(carId));
  },
  // OPP-09 / Daily Slalom: start TODAY'S daily challenge — same fixed seed all day
  // (replayable). mode='dailySlalom' makes the sim a constant-speed, gates-only
  // slalom AND routes the run-end result to the daily store (not the main
  // leaderboard). Uses the player's LOCAL date (see dailySeed).
  onPlayDaily: () => {
    audio.setMuted(false);
    const carId = resolvePlayCarId();
    // Daily seed is fixed for the day; setupRunGhost races a ghost only if it was
    // recorded on THIS seed (today), and returns that same seed.
    const seed = setupRunGhost(GameMode.DailySlalom, dailySeed(new Date()));
    startRun(game, handlingFor(carId), missions.startBiome(), seed, scoringFor(carId), GameMode.DailySlalom, slowMoFor(carId));
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
    ghostGame = null; // drop any rival ghost; the next run sets up its own
    ghostRenderer.setVisible(false);
  },
  // 2-PLAYER live race (MP-1 PR2): open the minimal Host/Join overlay; on connect +
  // handshake it starts the lockstep race and hands the running MpRace back here.
  onMultiplayer: () => {
    audio.setMuted(false);
    const carId = resolvePlayCarId();
    mountMpRaceUI(app, {
      game,
      localCarId: carId,
      onRacing: (race) => {
        mpRace = race;
        rivalRenderer.applyCar(carById(race.remoteCarId)); // remote's solid car
        rivalRenderer.setVisible(true);
      },
      // Crash-slowdown cue: the local car hit something and slowed (the run continues).
      onLocalCrash: () => {
        screenFx.flashCrash();
        scene.addShake(JUICE.nearMissShake[JUICE.nearMissShake.length - 1]);
        if (audio.started) audio.playCrash();
      },
      // Race over (finish or disconnect) → tear down cleanly + back to the menu.
      onLeaveRace: () => {
        mpRace = null;
        rivalRenderer.setVisible(false);
        finishLine.setVisible(false);
        returnToMenu(game); // fully reset the sim — no stale race carries into the menu
        shell.showStart();
      },
      onExit: () => shell.showStart(),
    });
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
  onLowFxChange: (lowFx) => post.setQuality(!lowFx),
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

// MULTIPLAYER CONNECTION TEST (MP-1 PR1): a standalone overlay reached via ?mp=1.
// Connection foundation only — connect two peers, measure RTT, run the cross-engine
// determinism probe. No gameplay. Available in production builds so it can be tested
// on real devices against the deployed signaling function (lazy-loaded so the netcode
// never ships in the normal play path).
if (new URLSearchParams(window.location.search).get('mp') === '1') {
  void import('./net/MultiplayerTestUI').then((m) => m.mountMultiplayerTest(app));
}

// TEST-ONLY screen hook (DEV builds ONLY). `import.meta.env.DEV` is false in the
// production `vite build`, so this whole block is dead-code-eliminated from the
// shipped bundle — a real user can never spoof a screen with fabricated data. It
// boots straight into a post-run screen state (the WIPEOUT placement / chase-target
// / daily-result / unlock variants) that otherwise only appears after a full run,
// so Playwright can DOM-assert them deterministically. Pure presentation:
// shell.showCrash only sets DOM text (no store writes), so injecting fixtures here
// has no side effects. NOTE: render-layer only — touches nothing in src/game/.
if (import.meta.env.DEV) {
  const urlScreen = new URLSearchParams(window.location.search).get('screen');
  if (urlScreen) {
    const best = { distance: 3000, score: 12000 };
    // The fixtures are a fixed list of [name, fn] pairs. We MATCH the user-controlled
    // `urlScreen` against each known name (an equality guard) and call the matched —
    // KNOWN — function. The invoked function is therefore NEVER selected by a user-
    // controlled property/key lookup (no `obj[user]()` / `map.get(user)()`), so there
    // is no prototype-dispatch hole and nothing dynamic to mis-dispatch (clears CodeQL
    // js/unvalidated-dynamic-method-call).
    const fixtures: ReadonlyArray<readonly [string, () => void]> = [
      // classic board placement + a chase target
      ['wipeout-rank', () =>
        shell.showCrash(8200, 1640, best, 4.5, [], [], { rank: 3, isCarBest: false, carId: 'pulse', target: { rank: 2, score: 9400, gap: 1200 } }, null)],
      // the #1 "NEW BEST!" punch
      ['wipeout-best', () =>
        shell.showCrash(15000, 2600, best, 6.0, [], [], { rank: 1, isCarBest: true, carId: 'pulse', target: null }, null)],
      // a per-car best with no board rank
      ['wipeout-carbest', () =>
        shell.showCrash(5400, 1100, best, 2.5, [], [], { rank: null, isCarBest: true, carId: 'nova', target: null }, null)],
      // unlock + mission/rank celebration lines
      ['wipeout-unlock', () =>
        shell.showCrash(9100, 1800, best, 3.5, ['Nova'], ['MISSION COMPLETE: Thread 25 near-misses', 'RANK UP: Runner!', 'UNLOCKED: Nova'], { rank: 5, isCarBest: false, carId: 'pulse', target: { rank: 4, score: 9300, gap: 200 } }, null)],
      // daily-result card (new daily best)
      ['wipeout-daily', () =>
        shell.showCrash(6400, 1200, { distance: 1200, score: 6400 }, 1.0, [], [], null, { isBest: true, runs: 1, bestScore: 6400, bestDistance: 1200 })],
    ];
    // Match the requested screen against the known names; an unknown value matches
    // nothing and safely no-ops. The called `run` is a KNOWN function, not a lookup.
    for (const [name, run] of fixtures) {
      if (name === urlScreen) {
        run();
        break;
      }
    }
  }
}

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
let ready = false; // flips true after the first rendered frame (test hook)
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
  let gateThreads = 0; // clean gate threads this frame (Daily Slalom feedback)
  let gateCenteredness = 0; // the latest thread's centeredness (0 edge → 1 centre)
  let gateMilestone = false; // a clean-streak milestone was crossed this frame
  let gateMissed = false; // a slalom miss cost a life this frame but the run continued
  let collectedKind: PowerupKind | null = null;
  let shieldBlocked = false;
  let rampBoosts = 0;
  let milestoneLabel: string | null = null;
  let biomeCelebrate = false;
  let objectiveLabel: string | null = null;
  const mpActive = mpRace?.isRacing ?? false;
  if (mpActive) {
    // LIVE 2P lockstep: schedule + send local input, then step BOTH sims for every
    // frame whose inputs are known (stalls cleanly if the remote input is late).
    // controls.endFrame() below clears the deploy edge, same as the SP path.
    mpRace!.tick(controls.intent);
  } else if (playing) {
    // Optional micro slow-mo after a near-miss: feed the sim scaled time.
    const simScale = slowmo > 0 ? JUICE.slowmoScale : 1;
    if (slowmo > 0) slowmo -= realDt;
    accumulator += realDt * simScale;
    while (accumulator >= TIMESTEP) {
      // Only record / advance the ghost on REAL playing sub-steps — a crash mid-loop
      // turns later sub-steps into no-ops (update() freezes once Crashed), which we
      // must not record or step the ghost through.
      const liveStep = game.phase === Phase.Playing;
      // RECORD this sub-step's intent BEFORE update() consumes the deploy latch.
      if (liveStep) recordFrame(recBuf, controls.intent);
      update(game, controls.intent, TIMESTEP);
      // REPLAY the rival ghost in LOCKSTEP — one ghost step per live step, same dt,
      // feeding the next recorded intent. Same seed + inputs ⇒ its exact run (#73).
      if (liveStep && ghostActive && ghostGame && ghostRec) {
        ghostScratchIntent.steer = ghostRec.steers[ghostFrame];
        ghostScratchIntent.deploySlowMo = ghostDeploySet.has(ghostFrame);
        update(ghostGame, ghostScratchIntent, TIMESTEP);
        ghostFrame++;
        if (ghostFrame >= ghostRec.steers.length) {
          ghostActive = false; // recording exhausted — freeze + fade the ghost car
          ghostRenderer.markEnded();
        }
        // Beat-the-ghost moment: the first instant the live score passes the ghost's
        // FINAL score (you've out-scored its whole run). A phantom — no collision.
        if (!ghostBeaten) {
          const liveScore = isSlalom(game) ? game.slalomScore.score : game.score.score;
          if (liveScore > ghostRec.score) {
            ghostBeaten = true;
            hud.showToast('GHOST BEATEN!', cssHex(GHOST.glowColor));
          }
        }
      }
      nearMisses += game.lastEvents.nearMisses;
      nearMissClosest = Math.min(nearMissClosest, game.lastEvents.nearMissClosest ?? Infinity);
      if (game.lastEvents.gateThreaded) {
        gateThreads += 1;
        gateCenteredness = game.lastEvents.gateCenteredness ?? 0;
        if (game.lastEvents.gateMilestone) gateMilestone = true;
      }
      if (game.lastEvents.gateMissed) gateMissed = true;
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
    // Not playing: drop any deploy armed off the track (menu / pause / crash) so
    // it can't fire on the next run's first step. (The sim consumes it while
    // playing; here there are no sub-steps to do so.)
    controls.intent.deploySlowMo = false;
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
  // DAILY SLALOM feedback — its OWN signal (gate threads), NOT the near-miss path.
  // SLALOM-ONLY: the gate-thread EVENT also fires in classic (slalom scoring reads
  // it via a mode-agnostic seam), so the FEEDBACK must be guarded by isSlalom here
  // — otherwise threading a gate in CLASSIC would pulse+chime, which #64 removed
  // (classic gates: thread = nothing, wall = crash).
  // PER-GATE is deliberately SUBTLE (fires ~every second): a light edge pulse +
  // a chime, both scaled by how centred the thread was. NO per-gate shake or
  // slow-mo (that constant heaviness was the problem we removed with gate near-
  // misses). A STREAK MILESTONE is the loud, earned moment: a bright pulse + a
  // small one-off shake + the milestone fanfare + a callout. (A miss is the crash
  // sting, below.)
  if (isSlalom(game) && gateThreads > 0) {
    const c = gateCenteredness; // already clamped 0..1 at detection
    screenFx.pulseNearMiss(SLALOM_FX.gatePulseMin + (SLALOM_FX.gatePulseMax - SLALOM_FX.gatePulseMin) * c);
    audio.playNearMiss(SLALOM_FX.gatePitchMin + (SLALOM_FX.gatePitchMax - SLALOM_FX.gatePitchMin) * c);
    if (gateMilestone) {
      screenFx.pulseNearMiss(SLALOM_FX.milestonePulse);
      scene.addShake(SLALOM_FX.milestoneShake);
      audio.playMilestone();
      hud.showNearMiss(`CLEAN x${game.slalomScore.cleanMultiplier}`);
    }
  }
  // SLALOM MISS sting (PR 3): a non-fatal gate-wall miss (lost a life, run
  // continues) — pronounced punctuation: a flash + a notable shake (below the full
  // crash shake; the run isn't over). The streak just reset; the FATAL miss is the
  // crash block below instead. `gateMissed` is set only in slalom, but guard by
  // isSlalom anyway (defensive — never let a slalom signal feed classic).
  if (isSlalom(game) && gateMissed) {
    screenFx.flashCrash();
    scene.addShake(SLALOM_FX.missShake);
    hud.showNearMiss(`MISS · ${game.lives} LEFT`);
  }
  // Powerup collection juice: a screen glow in the pickup's colour. A shield
  // absorbing a crash flashes the shield colour ("saved!").
  if (collectedKind) screenFx.pulsePickup(cssHex(POWERUP_DEFS[collectedKind].color));
  if (shieldBlocked) screenFx.pulsePickup(cssHex(POWERUP_DEFS[PowerupKind.Shield].color));
  // Ramp boost juice: a green flash in the ramp's "go" colour.
  if (rampBoosts > 0) screenFx.pulsePickup(cssHex(OBSTACLE_DEFS[ObstacleKind.Ramp].color));
  let unlockedNames = NO_UNLOCKS;
  let missionLines = NO_UNLOCKS;
  // SP run-end recording (leaderboard / daily / missions / ghost) — SKIPPED during a
  // live 2P race: MP race-end + win/lose is PR3 (a local crash here just freezes the
  // local car while the remote keeps racing; no SP wipeout / leaderboard write).
  if (crashed && !mpActive) {
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
    if (isSlalom(game)) {
      // Daily Slalom submits its OWN event-driven score (not the classic integral).
      dailyResult = daily.submitDaily(dailyDateKey(new Date()), game.slalomScore.score, game.distance, carIdNow);
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
      slowMosDeployed: game.runStats.slowMosDeployed,
      distance: game.distance,
      score: game.score.score,
      reachedMidnight: biomesSeenForDistance(game.distance) >= 2,
    });
    // RIVAL GHOST: assemble this run's recording and save it as the mode's new
    // ghost if it out-scored the stored one. Recorded on the seed actually played
    // (game.seed) + the car used, so a future replay reproduces it exactly.
    const ghostScore = isSlalom(game) ? game.slalomScore.score : game.score.score;
    const recording = buildRecording(recBuf, {
      seed: game.seed,
      mode: game.mode,
      carId: carIdNow,
      score: ghostScore,
      distance: game.distance,
      date: Date.now(),
    });
    const becameGhost = ghosts.submit(recording);
    missionLines = [
      // Surface the satisfying ghost moments first (only when a ghost was raced/set).
      ...(ghostBeaten ? ['RIVAL GHOST BEATEN!'] : []),
      ...(becameGhost && ghostRec ? ['NEW RIVAL GHOST SET'] : []),
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
    if (nearMisses > 0) audio.playNearMiss(JUICE.nearMissPitch[nmTier]); // riser scales with tier
    if (collectedKind || shieldBlocked || rampBoosts > 0) audio.playPickup();
    if (crashed) audio.playCrash();
    // A non-fatal slalom miss plays the crash sound too (the sting) — `gateMissed`
    // and `crashed` are mutually exclusive (survived vs fatal), so never both.
    if (isSlalom(game) && gateMissed) audio.playCrash();
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
  // Anchor roadside scenery to the ROAD centre (not the camera/player lateral) so
  // props never slide onto the road when the player is at an edge. (Bug fix.)
  scenery.update(game.distance, roadCenterAt(game.seed, game.distance)); // bounded roadside parallax props
  biomeView.apply(game.biome); // environment palette + stars + traffic tint follow the active biome (self-throttled)
  road.sync(game.road, game.distance);
  vehicle.sync(game.vehicle);
  // RIVAL GHOST: place the phantom on the SAME course offset by how far apart the
  // two runs are (ahead = -z, same mapping as traffic). Visible only while playing.
  // It non-interacting: a separate sim state, never read by the live sim.
  if (ghostGame) {
    ghostRenderer.setVisible(playing);
    ghostRenderer.sync(ghostGame.vehicle, -(ghostGame.distance - game.distance));
  }
  // LIVE 2P rival: draw the remote player's car from the remote sim, offset by the
  // distance gap (the race), same z-mapping. Phantom — no collision with the local car.
  if (mpActive && mpRace?.remoteGame) {
    rivalRenderer.setVisible(true);
    rivalRenderer.sync(mpRace.remoteGame.vehicle, -(mpRace.remoteGame.distance - game.distance));
    // Finish line at the shared finish distance (render-only; the win is decided in sim).
    finishLine.setVisible(true);
    finishLine.sync(MP_RACE.finishDistance, game.distance);
  } else if (!mpActive) {
    rivalRenderer.setVisible(false);
    finishLine.setVisible(false);
  }
  // Car light-trail: lengthens with speed. Fed 0 speed when not playing so it
  // fades out on the menu / pause / WIPEOUT screens.
  trail.update(
    game.vehicle.lateral,
    playing ? game.vehicle.speed : 0,
    playing ? normalizedSpeed(game.vehicle.speed) : 0,
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
  // Bank-collect cue: a slow-mo BANKS silently (no immediate effect), so pulse its
  // HUD count chip as the bank ticks up — fired from the existing collect event.
  // Runs after sync so the chip is shown/updated first. At cap (x3) the chip still
  // flashes and the number stays x3 (the extra charge is spent — see Powerups).
  if (collectedKind === PowerupKind.SlowMo) hud.pulseSlowMoBank();
  trailInfo.active = trail.activeCount();
  trailInfo.cap = trail.capacity();
  debug.update(game, telemetry, hud.comboText(), trailInfo, scenery.activeCount);

  post.render(realDt);
  // First-frame-ready signal for the browser smoke test — set once, AFTER a
  // successful render, so a test never screenshots an undrawn canvas.
  if (!ready) {
    ready = true;
    window.__READY__ = true;
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  scene.resize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});
