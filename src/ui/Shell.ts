/**
 * Front-end shell: the HTML/CSS overlay screens around the game — start screen,
 * settings panel, car picker (cosmetic), and the crash ("WIPEOUT") screen. Pure
 * DOM, NO three; it sits above the canvas like the HUD and never touches the
 * Three scene.
 *
 * Start/restart is driven from HERE (the PLAY / PLAY AGAIN actions and an
 * "any key" affordance on the start & crash screens), not from raw input in
 * Controls — so tapping a menu button never starts a run by accident.
 *
 * Layering: routes between screens; the game is "in play" when no screen is
 * shown (`go(null)`), at which point `body.playing` is set so the touch DRIFT
 * button shows.
 */

import type { SettingsStore } from '../state/Settings';
import type { BestRun, LeaderboardStore, RunPlacement } from '../state/Leaderboard';
import type { DailyEntry, DailyResult } from '../state/DailyStore';
import type { AudioEngine } from '../audio/AudioEngine';
import { carById, CARS, carStats, cssHex, handlingFor, SCORING, UI } from '../utils/constants';
import { share } from './share';

type Screen =
  | 'start'
  | 'settings'
  | 'carpicker'
  | 'missions'
  | 'leaderboard'
  | 'daily'
  | 'crash'
  | 'pause'
  | null;

/** Live data for the MISSIONS panel (all cosmetic; never gates the core run). */
export interface MissionView {
  label: string;
  have: number;
  need: number;
  done: boolean;
}
export interface RankView {
  name: string;
  completed: number;
  nextName: string | null;
  toNext: number;
  nextUnlock: string | null;
}
export interface StartBiomeView {
  index: number;
  name: string;
  unlocked: boolean;
  requirement: string | null;
  selected: boolean;
}
export interface MissionsPanel {
  active: () => MissionView[];
  rank: () => RankView;
  startBiomes: () => StartBiomeView[];
  selectStartBiome: (index: number) => void;
}

/** Live data for the DAILY CHALLENGE screen (OPP-09). */
export interface DailyPanel {
  /** Today's record on today's seed, or null if not played yet today. */
  today: () => DailyEntry | null;
  /** Rolling 7-day history, most-recent day first. */
  history: () => DailyEntry[];
}

export interface ShellOptions {
  isTouch: boolean;
  /** Canonical game URL to share (no query/hash). */
  shareUrl: string;
  /** Start a fresh run. */
  onPlay: () => void;
  /** Pause the in-progress run (freeze sim + silence audio). */
  onPause: () => void;
  /** Resume a paused run. */
  onResume: () => void;
  /** Abandon the run and reset to an idle menu state. */
  onMenu: () => void;
  /** Apply the selected car's cosmetic to the rendered vehicle. */
  applyCar: (carId: string) => void;
  /** Car-picker 3D preview lifecycle (rendering layer owns the actual mesh):
   *  enter mounts a preview into `container`; car updates it; exit disposes it. */
  onCarPickerEnter: (container: HTMLElement, carId: string) => void;
  onCarPickerCar: (carId: string) => void;
  onCarPickerExit: () => void;
  /** Lock state for a car: `null` when unlocked, else the requirement + live
   *  progress for the picker. Absent → everything unlocked (used by tests). */
  carLock?: (carId: string) => { label: string; have: number; need: number } | null;
  /** Across-run mission/rank panel data. Absent → no MISSIONS button (tests). */
  missions?: MissionsPanel;
  /** "Retro FX" toggle → enable/disable the bloom pipeline (HIGH/LOW quality). */
  onLowFxChange?: (lowFx: boolean) => void;
  /** "Cinematic FX" toggle → enable/disable the fullscreen grade pass (independent of
   *  bloom). OFF keeps the glow but drops the fullscreen shader (a mobile fill-rate win). */
  onCinematicFxChange?: (on: boolean) => void;
  /** Open the 2-player live race entry (MP-1). Absent → no 2P RACE button. */
  onMultiplayer?: () => void;
  /** Open the vs-Computer (AI race) entry. Absent → no "vs COMPUTER" button. */
  onVsComputer?: () => void;
  /** Current credit balance provider (PROG-1). Absent → no credits readout (tests). */
  credits?: () => number;
  /** "Rival Ghost" toggled — the next run reads the persisted setting; this lets
   *  the composition root react immediately if it wants (optional). */
  onGhostRaceChange?: (on: boolean) => void;
  /** Start TODAY'S daily challenge (OPP-09). Absent → no DAILY button (tests). */
  onPlayDaily?: () => void;
  /** Daily-challenge panel data. Absent → no DAILY button / screen (tests). */
  daily?: DailyPanel;
}

export class Shell {
  private readonly root: HTMLElement;
  private current: Screen = null;
  private carIndex = 0;

  // Screens.
  private readonly startScreen: HTMLElement;
  private readonly settingsScreen: HTMLElement;
  private readonly carScreen: HTMLElement;
  private readonly missionsScreen: HTMLElement;
  private readonly leaderboardScreen: HTMLElement;
  private readonly dailyScreen: HTMLElement;
  private readonly crashScreen: HTMLElement;
  private readonly pauseScreen: HTMLElement;
  /** Which mode the last launched run used, so PLAY AGAIN / retry replays the
   *  same mode (a daily crash retries the daily, not a random run). */
  private lastWasDaily = false;
  /** In-run PAUSE affordance (visible only while playing). */
  private readonly pauseBtn: HTMLButtonElement;
  /** Browse cursor for the start-biome selector in the missions panel. */
  private sbIndex = 0;

  // Dynamic nodes.
  private readonly startBest: HTMLElement;
  private readonly crashScoreEl: HTMLElement;
  private readonly crashComboEl: HTMLElement;
  private readonly crashPlacementEl: HTMLElement;
  private readonly crashTargetEl: HTMLElement;
  private readonly crashBestEl: HTMLElement;
  private readonly crashUnlockEl: HTMLElement;
  private readonly crashMissionsEl: HTMLElement;
  /** PROG-1 credit readouts (start balance + per-run earned). */
  private readonly startCreditsEl: HTMLElement;
  private readonly crashCreditsEl: HTMLElement;
  private readonly leaderboardListEl: HTMLElement;
  private readonly leaderboardCarsEl: HTMLElement;
  private readonly dailyTodayEl: HTMLElement;
  private readonly dailyHistoryEl: HTMLElement;
  private readonly carNameEl: HTMLElement;
  private readonly carTaglineEl: HTMLElement;
  private readonly carPlaystyleEl: HTMLElement;
  private readonly carSlowMoEl: HTMLElement;
  private readonly carCanvasEl: HTMLElement;
  private readonly carStatsEl: HTMLElement;
  private readonly carDotsEl: HTMLElement;
  private readonly carLockEl: HTMLElement;
  private readonly rankEl: HTMLElement;
  private readonly missionsListEl: HTMLElement;
  private readonly sbNameEl: HTMLElement;
  private readonly sbReqEl: HTMLElement;
  private readonly soundValueEl: HTMLElement;
  private readonly fxValueEl: HTMLElement;
  private readonly cineValueEl: HTMLElement;
  private readonly ghostValueEl: HTMLElement;

  private readonly settings: SettingsStore;
  private readonly leaderboard: LeaderboardStore;
  private readonly audio: AudioEngine;
  private readonly opts: ShellOptions;

  constructor(
    parent: HTMLElement,
    settings: SettingsStore,
    leaderboard: LeaderboardStore,
    audio: AudioEngine,
    opts: ShellOptions,
  ) {
    this.settings = settings;
    this.leaderboard = leaderboard;
    this.audio = audio;
    this.opts = opts;
    this.carIndex = Math.max(
      0,
      CARS.findIndex((c) => c.id === settings.get('selectedCarId')),
    );

    this.root = document.createElement('div');
    this.root.className = 'shell';

    this.startScreen = this.buildStart();
    this.settingsScreen = this.buildSettings();
    this.carScreen = this.buildCarPicker();
    this.missionsScreen = this.buildMissions();
    this.leaderboardScreen = this.buildLeaderboard();
    this.dailyScreen = this.buildDaily();
    this.crashScreen = this.buildCrash();
    this.pauseScreen = this.buildPause();

    // Cache nodes that update at runtime.
    this.startBest = this.startScreen.querySelector('.shell-best')!;
    this.startCreditsEl = this.startScreen.querySelector('.shell-credits')!;
    this.crashCreditsEl = this.crashScreen.querySelector('.shell-crash-credits')!;
    this.crashScoreEl = this.crashScreen.querySelector('.shell-crash-score')!;
    this.crashComboEl = this.crashScreen.querySelector('.shell-crash-combo')!;
    this.crashPlacementEl = this.crashScreen.querySelector('.shell-crash-placement')!;
    this.crashTargetEl = this.crashScreen.querySelector('.shell-crash-target')!;
    this.crashBestEl = this.crashScreen.querySelector('.shell-crash-best')!;
    this.crashUnlockEl = this.crashScreen.querySelector('.shell-crash-unlock')!;
    this.crashMissionsEl = this.crashScreen.querySelector('.shell-crash-missions')!;
    this.leaderboardListEl = this.leaderboardScreen.querySelector('.shell-lb-list')!;
    this.leaderboardCarsEl = this.leaderboardScreen.querySelector('.shell-lb-cars')!;
    this.dailyTodayEl = this.dailyScreen.querySelector('.shell-daily-today')!;
    this.dailyHistoryEl = this.dailyScreen.querySelector('.shell-daily-history')!;
    this.carNameEl = this.carScreen.querySelector('.shell-car-name')!;
    this.carTaglineEl = this.carScreen.querySelector('.shell-car-tagline')!;
    this.carPlaystyleEl = this.carScreen.querySelector('.shell-car-playstyle')!;
    this.carSlowMoEl = this.carScreen.querySelector('.shell-car-slowmo')!;
    this.carCanvasEl = this.carScreen.querySelector('.shell-car-canvas')!;
    this.carStatsEl = this.carScreen.querySelector('.shell-car-stats')!;
    this.carDotsEl = this.carScreen.querySelector('.shell-car-dots')!;
    this.carLockEl = this.carScreen.querySelector('.shell-car-lock')!;
    this.rankEl = this.missionsScreen.querySelector('.shell-rank')!;
    this.missionsListEl = this.missionsScreen.querySelector('.shell-missions-list')!;
    this.sbNameEl = this.missionsScreen.querySelector('.shell-sb-name')!;
    this.sbReqEl = this.missionsScreen.querySelector('.shell-sb-req')!;
    this.soundValueEl = this.settingsScreen.querySelector('.shell-toggle-value')!;
    this.fxValueEl = this.settingsScreen.querySelector('.shell-fx-value')!;
    this.cineValueEl = this.settingsScreen.querySelector('.shell-cine-value')!;
    this.ghostValueEl = this.settingsScreen.querySelector('.shell-ghost-value')!;

    // In-run PAUSE button (touch + mouse affordance; keyboard uses Esc/P). Shown
    // only while playing, gated by `body.playing` like the touch DRIFT button.
    this.pauseBtn = document.createElement('button');
    this.pauseBtn.className = 'shell-pause-btn';
    this.pauseBtn.type = 'button';
    this.pauseBtn.setAttribute('aria-label', 'pause');
    this.pauseBtn.textContent = '❚❚';
    this.pauseBtn.addEventListener('click', () => this.requestPause());

    this.root.append(
      this.startScreen,
      this.settingsScreen,
      this.carScreen,
      this.missionsScreen,
      this.leaderboardScreen,
      this.dailyScreen,
      this.crashScreen,
      this.pauseScreen,
      this.pauseBtn,
    );
    parent.appendChild(this.root);

    window.addEventListener('keydown', (e) => this.onKeyDown(e));

    // Apply the persisted car immediately and reflect it in the picker.
    this.opts.applyCar(CARS[this.carIndex].id);
    this.renderCar();
    this.renderSound();
    this.renderFx();
    this.renderCine();
    this.renderGhost();
  }

  // --- public screen transitions ----------------------------------------

  showStart(): void {
    this.startBest.textContent = this.bestLine(this.leaderboard.bestRun());
    this.renderCredits(this.startCreditsEl, 0);
    this.go('start');
  }

  /** Render a credit readout: the balance, plus an optional "+N earned" prefix. */
  private renderCredits(eln: HTMLElement, earned: number): void {
    if (!this.opts.credits) {
      eln.style.display = 'none';
      return;
    }
    const balance = Math.round(this.opts.credits());
    eln.textContent = earned > 0 ? `+${Math.round(earned)} credits · ${balance} total` : `★ ${balance} credits`;
    eln.style.display = '';
  }

  showCrash(
    score: number,
    distance: number,
    best: BestRun,
    peakCombo: number,
    unlockedNames: string[] = [],
    missionLines: string[] = [],
    placement: RunPlacement | null = null,
    daily: DailyResult | null = null,
    creditsEarned = 0,
  ): void {
    this.crashScoreEl.textContent = `score ${Math.round(score)} · ${Math.round(distance)} m`;
    // PROG-1: the credits earned this run + the running balance (no spend yet).
    this.renderCredits(this.crashCreditsEl, creditsEarned);
    // The live combo resets on crash, so the WIPEOUT screen is where the player
    // sees how daring the run was. Dimmed when the run never built a combo.
    this.crashComboEl.textContent = `MAX COMBO x${peakCombo.toFixed(1)}`;
    // Dim when the run never rose above the base combo (a daring run pops).
    this.crashComboEl.style.opacity = peakCombo > SCORING.baseCombo ? '1' : '0.45';

    // Placement callout: for a DAILY run a daily badge (OPP-09); otherwise the
    // OPP-15 board placement + nearest target. Both hide when nothing's earned.
    this.renderPlacement(placement, daily);

    // For a daily run `best` is TODAY's best (chase-your-own); else the all-time #1.
    const bestLabel = daily ? 'today' : 'best';
    this.crashBestEl.textContent = `${bestLabel} ${Math.round(best.score)} · ${Math.round(best.distance)} m`;

    // Unlock moment: celebrate anything earned this run (else stay hidden).
    if (unlockedNames.length > 0) {
      const label = unlockedNames.length === 1 ? unlockedNames[0] : unlockedNames.join(' + ');
      this.crashUnlockEl.textContent = `UNLOCKED: ${label}!`;
      this.crashUnlockEl.style.display = '';
      if (typeof this.crashUnlockEl.animate === 'function') {
        this.crashUnlockEl.animate(
          [
            { opacity: 0, transform: 'scale(0.9)' },
            { opacity: 1, transform: 'scale(1.06)', offset: 0.6 },
            { opacity: 1, transform: 'scale(1)' },
          ],
          { duration: 700, easing: 'ease-out' },
        );
      }
    } else {
      this.crashUnlockEl.textContent = '';
      this.crashUnlockEl.style.display = 'none';
    }

    // Mission / rank celebration lines (non-intrusive; never block the retry).
    if (missionLines.length > 0) {
      this.crashMissionsEl.innerHTML = missionLines
        .map((l) => `<span class="shell-crash-mission-line">${l}</span>`)
        .join('');
      this.crashMissionsEl.style.display = '';
    } else {
      this.crashMissionsEl.innerHTML = '';
      this.crashMissionsEl.style.display = 'none';
    }

    this.go('crash');
  }

  /** In-play: hide all overlays. */
  hide(): void {
    this.go(null);
  }

  /** Pause an in-progress run (from the PAUSE button, Esc/P, or tab-blur). Only
   *  acts while actually playing (no overlay shown). Idempotent. */
  requestPause(): void {
    if (this.current !== null) return;
    this.opts.onPause();
    this.go('pause');
  }

  // --- routing ------------------------------------------------------------

  private go(screen: Screen): void {
    const prev = this.current;
    this.current = screen;
    this.startScreen.style.display = screen === 'start' ? 'flex' : 'none';
    this.settingsScreen.style.display = screen === 'settings' ? 'flex' : 'none';
    this.carScreen.style.display = screen === 'carpicker' ? 'flex' : 'none';
    this.missionsScreen.style.display = screen === 'missions' ? 'flex' : 'none';
    this.leaderboardScreen.style.display = screen === 'leaderboard' ? 'flex' : 'none';
    this.dailyScreen.style.display = screen === 'daily' ? 'flex' : 'none';
    this.crashScreen.style.display = screen === 'crash' ? 'flex' : 'none';
    this.pauseScreen.style.display = screen === 'pause' ? 'flex' : 'none';
    // `body.playing` gates the in-run controls (DRIFT + PAUSE) — only while playing.
    document.body.classList.toggle('playing', screen === null);

    // Refresh the missions panel from live progression data when it opens.
    if (screen === 'missions' && prev !== 'missions') this.renderMissions();
    // Refresh the leaderboard from the store each time it opens (live data).
    if (screen === 'leaderboard' && prev !== 'leaderboard') this.renderLeaderboard();
    // Refresh the daily challenge view from the store each time it opens.
    if (screen === 'daily' && prev !== 'daily') this.renderDaily();

    // Spin up / tear down the 3D car preview with the picker (the rendering
    // layer owns the mesh; it must never run behind the game).
    if (screen === 'carpicker' && prev !== 'carpicker') {
      this.opts.onCarPickerEnter(this.carCanvasEl, CARS[this.carIndex].id);
    } else if (prev === 'carpicker' && screen !== 'carpicker') {
      this.opts.onCarPickerExit();
    }
  }

  private play(): void {
    this.lastWasDaily = false;
    this.go(null);
    this.opts.onPlay();
  }

  /** Launch TODAY'S daily challenge (OPP-09). Falls back to a normal run if the
   *  daily callback isn't wired (e.g. in tests). */
  private playDaily(): void {
    if (!this.opts.onPlayDaily) return this.play();
    this.lastWasDaily = true;
    this.go(null);
    this.opts.onPlayDaily();
  }

  /** Retry from the crash screen, REPLAYING the same mode the last run used — so
   *  a daily wipeout retries the daily (chasing your best), not a random run. */
  private replay(): void {
    if (this.lastWasDaily) this.playDaily();
    else this.play();
  }

  /** Resume from the pause overlay back into the run. */
  private resumeRun(): void {
    this.opts.onResume();
    this.go(null);
  }

  /** Abandon the current run and return to the (reset) start screen. */
  private menu(): void {
    this.opts.onMenu();
    this.showStart();
  }

  // --- start screen -------------------------------------------------------

  private buildStart(): HTMLElement {
    const s = screen('shell-start');
    const hint = this.opts.isTouch
      ? 'drag to steer · tap SLOW-MO to deploy a banked charge'
      : '← → / A D to steer · SPACE to deploy a banked slow-mo';
    s.innerHTML =
      `<h1 class="shell-title">NEON DRIFT</h1>` +
      `<p class="shell-best"></p>` +
      `<p class="shell-credits"></p>` +
      `<button class="shell-btn shell-play" type="button">PLAY</button>` +
      `<p class="shell-hint">${hint}</p>` +
      `<div class="shell-row">` +
      `<button class="shell-btn shell-btn--ghost shell-cars" type="button">CARS</button>` +
      (this.opts.daily
        ? `<button class="shell-btn shell-btn--ghost shell-daily-open" type="button">DAILY</button>`
        : '') +
      (this.opts.missions
        ? `<button class="shell-btn shell-btn--ghost shell-missions-open" type="button">MISSIONS</button>`
        : '') +
      // vs-COMPUTER race — only when the composition root wired it up.
      (this.opts.onVsComputer
        ? `<button class="shell-btn shell-btn--ghost shell-vscpu-open" type="button">vs COMPUTER</button>`
        : '') +
      // 2-PLAYER live race (MP-1) — only when the composition root wired it up.
      (this.opts.onMultiplayer
        ? `<button class="shell-btn shell-btn--ghost shell-mp-open" type="button">2P RACE</button>`
        : '') +
      `<button class="shell-btn shell-btn--ghost shell-leaderboard-open" type="button">SCORES</button>` +
      `<button class="shell-btn shell-btn--ghost shell-settings-open" type="button">SETTINGS</button>` +
      `</div>` +
      `<button class="shell-btn shell-btn--ghost shell-share" type="button">SHARE</button>`;

    s.querySelector('.shell-play')!.addEventListener('click', () => this.play());
    s.querySelector('.shell-cars')!.addEventListener('click', () => this.go('carpicker'));
    s.querySelector('.shell-daily-open')?.addEventListener('click', () => this.go('daily'));
    s.querySelector('.shell-missions-open')?.addEventListener('click', () => this.go('missions'));
    s.querySelector('.shell-vscpu-open')?.addEventListener('click', () => {
      this.hide(); // leave the menu; the vs-Computer picker + race take over
      this.opts.onVsComputer?.();
    });
    s.querySelector('.shell-mp-open')?.addEventListener('click', () => {
      this.hide(); // leave the menu; the MP overlay + race take over
      this.opts.onMultiplayer?.();
    });
    s.querySelector('.shell-leaderboard-open')!.addEventListener('click', () => this.go('leaderboard'));
    s.querySelector('.shell-settings-open')!.addEventListener('click', () => this.go('settings'));
    s.querySelector('.shell-share')!.addEventListener('click', () => this.doShare());
    return s;
  }

  private bestLine(best: BestRun): string {
    if (best.score <= 0 && best.distance <= 0) return 'NO RUNS YET';
    return `BEST  ${Math.round(best.score)} · ${Math.round(best.distance)} m`;
  }

  // --- settings panel -----------------------------------------------------

  private buildSettings(): HTMLElement {
    const s = screen('shell-settings');
    s.innerHTML =
      `<h2 class="shell-subtitle">SETTINGS</h2>` +
      `<div class="shell-setting">` +
      `<span class="shell-setting-label">Sound</span>` +
      `<button class="shell-btn shell-toggle shell-toggle-sound" type="button" role="switch">` +
      `<span class="shell-toggle-value">ON</span></button>` +
      `</div>` +
      // Retro FX: the graphics-quality HIGH/LOW lever. ON = full neon glow (bloom +
      // cinematic grade). OFF = LOW — skips the WHOLE post pipeline incl. the expensive
      // bloom + renders direct, a real perf fallback for weaker GPUs.
      `<div class="shell-setting">` +
      `<span class="shell-setting-label">Retro FX</span>` +
      `<button class="shell-btn shell-toggle shell-toggle-fx" type="button" role="switch">` +
      `<span class="shell-fx-value">ON</span></button>` +
      `</div>` +
      // Cinematic FX: the fullscreen grade pass (aberration / scanlines / grain /
      // vignette), independent of bloom. OFF keeps the glow but drops the fullscreen
      // shader — a fill-rate win on mobile GPUs. No effect while Retro FX is off.
      `<div class="shell-setting">` +
      `<span class="shell-setting-label">Cinematic FX</span>` +
      `<button class="shell-btn shell-toggle shell-toggle-cine" type="button" role="switch">` +
      `<span class="shell-cine-value">ON</span></button>` +
      `</div>` +
      // Rival Ghost: race a translucent replay of your best run for the mode.
      `<div class="shell-setting">` +
      `<span class="shell-setting-label">Rival Ghost</span>` +
      `<button class="shell-btn shell-toggle shell-toggle-ghost" type="button" role="switch">` +
      `<span class="shell-ghost-value">OFF</span></button>` +
      `</div>` +
      `<button class="shell-btn shell-close" type="button">CLOSE</button>`;

    s.querySelector('.shell-toggle-sound')!.addEventListener('click', () => this.toggleSound());
    s.querySelector('.shell-toggle-fx')!.addEventListener('click', () => this.toggleFx());
    s.querySelector('.shell-toggle-cine')!.addEventListener('click', () => this.toggleCine());
    s.querySelector('.shell-toggle-ghost')!.addEventListener('click', () => this.toggleGhost());
    s.querySelector('.shell-close')!.addEventListener('click', () => this.go('start'));
    return s;
  }

  private toggleGhost(): void {
    const next = !this.settings.get('ghostRace');
    this.settings.set('ghostRace', next);
    this.opts.onGhostRaceChange?.(next);
    this.renderGhost();
  }

  private renderGhost(): void {
    const on = this.settings.get('ghostRace');
    this.ghostValueEl.textContent = on ? 'ON' : 'OFF';
    const toggle = this.settingsScreen.querySelector('.shell-toggle-ghost')!;
    toggle.classList.toggle('shell-toggle--on', on);
    toggle.setAttribute('aria-checked', String(on));
  }

  private toggleFx(): void {
    const nextLowFx = !this.settings.get('lowFx');
    this.settings.set('lowFx', nextLowFx);
    this.opts.onLowFxChange?.(nextLowFx); // enable/disable the cinematic pass
    this.renderFx();
  }

  private renderFx(): void {
    const on = !this.settings.get('lowFx'); // FX ON = bloom + composer
    this.fxValueEl.textContent = on ? 'ON' : 'OFF';
    const toggle = this.settingsScreen.querySelector('.shell-toggle-fx')!;
    toggle.classList.toggle('shell-toggle--on', on);
    toggle.setAttribute('aria-checked', String(on));
  }

  private toggleCine(): void {
    const next = !this.settings.get('cinematicFx');
    this.settings.set('cinematicFx', next);
    this.opts.onCinematicFxChange?.(next);
    this.renderCine();
  }

  private renderCine(): void {
    const on = this.settings.get('cinematicFx');
    this.cineValueEl.textContent = on ? 'ON' : 'OFF';
    const toggle = this.settingsScreen.querySelector('.shell-toggle-cine')!;
    toggle.classList.toggle('shell-toggle--on', on);
    toggle.setAttribute('aria-checked', String(on));
  }

  private toggleSound(): void {
    const next = !this.settings.get('soundEnabled');
    this.settings.set('soundEnabled', next);
    this.audio.setEnabled(next); // immediate, no restart
    this.renderSound();
  }

  private renderSound(): void {
    const on = this.settings.get('soundEnabled');
    this.soundValueEl.textContent = on ? 'ON' : 'OFF';
    const toggle = this.settingsScreen.querySelector('.shell-toggle-sound')!;
    toggle.classList.toggle('shell-toggle--on', on);
    toggle.setAttribute('aria-checked', String(on));
  }

  // --- car picker (cosmetic) ---------------------------------------------

  private buildCarPicker(): HTMLElement {
    const s = screen('shell-carpicker');
    s.innerHTML =
      `<h2 class="shell-subtitle">SELECT CAR</h2>` +
      `<div class="shell-car-stage">` +
      `<button class="shell-btn shell-arrow shell-prev" type="button" aria-label="previous car">‹</button>` +
      `<div class="shell-car-canvas"></div>` +
      `<button class="shell-btn shell-arrow shell-next" type="button" aria-label="next car">›</button>` +
      `</div>` +
      `<p class="shell-car-name"></p>` +
      `<p class="shell-car-tagline"></p>` +
      `<p class="shell-car-playstyle"></p>` +
      `<p class="shell-car-slowmo"></p>` +
      `<p class="shell-car-lock"></p>` +
      `<div class="shell-car-stats">` +
      this.statRow('SPEED', 'speed') +
      this.statRow('GRIP', 'grip') +
      this.statRow('AGILITY', 'agility') +
      `</div>` +
      `<div class="shell-car-dots"></div>` +
      `<button class="shell-btn shell-close" type="button">DONE</button>`;

    s.querySelector('.shell-prev')!.addEventListener('click', () => this.cycleCar(-1));
    s.querySelector('.shell-next')!.addEventListener('click', () => this.cycleCar(1));
    s.querySelector('.shell-close')!.addEventListener('click', () => this.go('start'));

    // Swipe to cycle (touch parity with the arrows).
    const stage = s.querySelector('.shell-car-stage') as HTMLElement;
    let startX = 0;
    stage.addEventListener(
      'touchstart',
      (e) => {
        startX = e.changedTouches[0].clientX;
      },
      { passive: true },
    );
    stage.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) >= UI.carSwipeThresholdPx) this.cycleCar(dx < 0 ? 1 : -1);
    });
    return s;
  }

  /** One stat row markup; the fill width is set per car in renderCar(). */
  private statRow(label: string, key: string): string {
    return (
      `<div class="shell-stat">` +
      `<span class="shell-stat-label">${label}</span>` +
      `<div class="shell-stat-track"><div class="shell-stat-fill" data-stat="${key}"></div></div>` +
      `</div>`
    );
  }

  private cycleCar(dir: number): void {
    this.carIndex = (this.carIndex + dir + CARS.length) % CARS.length;
    const car = CARS[this.carIndex];
    // Always preview the browsed car (so the player can see what they're working
    // toward), but only SELECT it — persist + apply the cosmetic behind the menu
    // — when it's unlocked. A locked car can't become the chosen car.
    if (!this.opts.carLock?.(car.id)) {
      this.settings.set('selectedCarId', car.id);
      this.opts.applyCar(car.id);
    }
    this.opts.onCarPickerCar(car.id); // update the 3D preview either way
    this.renderCar();
  }

  private renderCar(): void {
    const car = CARS[this.carIndex];
    const lock = this.opts.carLock?.(car.id) ?? null;
    this.carNameEl.textContent = car.displayName;
    this.carTaglineEl.textContent = car.tagline ?? '';
    // Scoring-playstyle line (OPP-07b) — beneath the handling tagline so the
    // combo build/window tradeoff is readable, not just felt.
    this.carPlaystyleEl.textContent = car.scoringTagline ?? '';
    // Slow-mo line (PR2) — beneath the scoring line so the slow-mo↔agility
    // tradeoff is readable too.
    this.carSlowMoEl.textContent = car.slowMoTagline ?? '';

    // Locked cars show their requirement + live progress; unlocked ones clear it.
    this.carScreen.classList.toggle('locked', !!lock);
    this.carLockEl.textContent = lock ? `🔒 ${lock.label} · ${Math.floor(lock.have)}/${lock.need}` : '';

    // Stat bars — DERIVED from the same handling multipliers the sim uses
    // (carStats), tinted with the car's glow so they read with the preview. A
    // locked car dims its bars (greyed) so it reads as not-yet-available.
    const stats = carStats(handlingFor(car.id));
    const glow = lock ? '#6a6a7a' : cssHex(car.cosmetic.glow);
    const setBar = (key: keyof typeof stats) => {
      const fill = this.carStatsEl.querySelector(`[data-stat="${key}"]`) as HTMLElement | null;
      if (!fill) return;
      fill.style.width = `${Math.round(stats[key] * 100)}%`;
      fill.style.background = glow;
      fill.style.boxShadow = lock ? 'none' : `0 0 8px ${glow}`;
    };
    setBar('speed');
    setBar('grip');
    setBar('agility');

    // Page dots.
    this.carDotsEl.innerHTML = CARS.map(
      (_, i) => `<span class="shell-dot${i === this.carIndex ? ' shell-dot--on' : ''}"></span>`,
    ).join('');
  }

  // --- missions panel -----------------------------------------------------

  private buildMissions(): HTMLElement {
    const s = screen('shell-missions');
    s.innerHTML =
      `<h2 class="shell-subtitle">MISSIONS</h2>` +
      `<p class="shell-rank"></p>` +
      `<div class="shell-missions-list"></div>` +
      `<div class="shell-startbiome">` +
      `<span class="shell-startbiome-label">STARTING BIOME</span>` +
      `<div class="shell-startbiome-row">` +
      `<button class="shell-btn shell-arrow shell-sb-prev" type="button" aria-label="previous biome">‹</button>` +
      `<span class="shell-sb-name"></span>` +
      `<button class="shell-btn shell-arrow shell-sb-next" type="button" aria-label="next biome">›</button>` +
      `</div>` +
      `<p class="shell-sb-req"></p>` +
      `</div>` +
      `<button class="shell-btn shell-close-missions" type="button">DONE</button>`;

    s.querySelector('.shell-sb-prev')!.addEventListener('click', () => this.cycleStartBiome(-1));
    s.querySelector('.shell-sb-next')!.addEventListener('click', () => this.cycleStartBiome(1));
    s.querySelector('.shell-close-missions')!.addEventListener('click', () => this.showStart());
    return s;
  }

  /** Render the missions panel from the live progression data (on open). */
  private renderMissions(): void {
    const m = this.opts.missions;
    if (!m) return;

    const rank = m.rank();
    this.rankEl.innerHTML =
      `<span class="shell-rank-name">${rank.name}</span> · ${rank.completed} missions` +
      (rank.nextName
        ? ` · next: <b>${rank.nextName}</b> in ${rank.toNext} (${rank.nextUnlock})`
        : ' · MAX RANK');

    // Active missions with progress bars (rebuilt on open — at most 3 rows).
    this.missionsListEl.innerHTML = m
      .active()
      .map((v) => {
        const pct = Math.round((v.have / Math.max(1, v.need)) * 100);
        return (
          `<div class="shell-mission${v.done ? ' done' : ''}">` +
          `<span class="shell-mission-label">${v.done ? '✓ ' : ''}${v.label}</span>` +
          `<div class="shell-mission-track"><div class="shell-mission-fill" style="width:${pct}%"></div></div>` +
          `<span class="shell-mission-count">${v.have}/${v.need}</span>` +
          `</div>`
        );
      })
      .join('');

    // Start-biome selector starts on the currently-selected option.
    const biomes = m.startBiomes();
    const sel = biomes.findIndex((b) => b.selected);
    this.sbIndex = sel >= 0 ? sel : 0;
    this.renderStartBiome();
  }

  private cycleStartBiome(dir: number): void {
    const m = this.opts.missions;
    if (!m) return;
    const biomes = m.startBiomes();
    this.sbIndex = (this.sbIndex + dir + biomes.length) % biomes.length;
    const b = biomes[this.sbIndex];
    // Only an UNLOCKED biome can be chosen (cosmetic gating — never gameplay).
    if (b.unlocked) m.selectStartBiome(b.index);
    this.renderStartBiome();
  }

  private renderStartBiome(): void {
    const m = this.opts.missions;
    if (!m) return;
    const b = m.startBiomes()[this.sbIndex];
    if (!b) return;
    this.sbNameEl.textContent = b.name;
    this.missionsScreen.classList.toggle('sb-locked', !b.unlocked);
    this.sbReqEl.textContent = b.unlocked ? (b.selected ? '✓ selected' : 'tap an arrow to select') : `🔒 ${b.requirement ?? 'locked'}`;
  }

  // --- leaderboard view ---------------------------------------------------

  private buildLeaderboard(): HTMLElement {
    const s = screen('shell-leaderboard');
    s.innerHTML =
      `<h2 class="shell-subtitle">SCORES</h2>` +
      `<div class="shell-lb-list"></div>` +
      `<h3 class="shell-lb-heading">BEST PER CAR</h3>` +
      `<div class="shell-lb-cars"></div>` +
      `<button class="shell-btn shell-close-leaderboard" type="button">DONE</button>`;
    s.querySelector('.shell-close-leaderboard')!.addEventListener('click', () => this.showStart());
    return s;
  }

  /** Display name for a recorded run's car ('—' for a migrated legacy entry). */
  private carLabel(carId: string): string {
    return carId ? carById(carId).displayName : '—';
  }

  /** Render the leaderboard view from the store (on open). Top runs + per-car. */
  private renderLeaderboard(): void {
    const top = this.leaderboard.top();
    if (top.length === 0) {
      this.leaderboardListEl.innerHTML = `<p class="shell-lb-empty">NO RUNS YET</p>`;
    } else {
      this.leaderboardListEl.innerHTML = top
        .map(
          (e, i) =>
            `<div class="shell-lb-row${i === 0 ? ' shell-lb-row--top' : ''}">` +
            `<span class="shell-lb-rank">#${i + 1}</span>` +
            `<span class="shell-lb-score">${fmtNum(e.score)}</span>` +
            `<span class="shell-lb-dist">${fmtNum(e.distance)} m</span>` +
            `<span class="shell-lb-car">${this.carLabel(e.carId)}</span>` +
            `<span class="shell-lb-date">${fmtDate(e.date)}</span>` +
            `</div>`,
        )
        .join('');
    }

    const cars = this.leaderboard.perCarBests();
    this.leaderboardCarsEl.innerHTML =
      cars.length === 0
        ? `<p class="shell-lb-empty">—</p>`
        : cars
            .map(
              (c) =>
                `<div class="shell-lb-row">` +
                `<span class="shell-lb-car">${this.carLabel(c.carId)}</span>` +
                `<span class="shell-lb-score">${fmtNum(c.score)}</span>` +
                `<span class="shell-lb-dist">${fmtNum(c.distance)} m</span>` +
                `<span class="shell-lb-date">${fmtDate(c.date)}</span>` +
                `</div>`,
            )
            .join('');
  }

  // --- daily challenge view (OPP-09) --------------------------------------

  private buildDaily(): HTMLElement {
    const s = screen('shell-daily');
    s.innerHTML =
      `<h2 class="shell-subtitle">DAILY CHALLENGE</h2>` +
      `<p class="shell-daily-sub">One fixed seed all day · chase your own best</p>` +
      `<button class="shell-btn shell-play-daily" type="button">PLAY TODAY'S CHALLENGE</button>` +
      `<p class="shell-daily-today"></p>` +
      `<h3 class="shell-lb-heading">LAST 7 DAYS</h3>` +
      `<div class="shell-daily-history"></div>` +
      `<button class="shell-btn shell-close-daily" type="button">DONE</button>`;
    s.querySelector('.shell-play-daily')!.addEventListener('click', () => this.playDaily());
    s.querySelector('.shell-close-daily')!.addEventListener('click', () => this.showStart());
    return s;
  }

  /** Render the daily view from the store (on open): today's best + run count,
   *  and the rolling 7-day history. */
  private renderDaily(): void {
    const d = this.opts.daily;
    if (!d) return;

    const today = d.today();
    this.dailyTodayEl.textContent =
      today && today.runs > 0
        ? `TODAY: ${fmtNum(today.bestScore)} · ${fmtNum(today.bestDistance)} m · ${today.runs} run${today.runs === 1 ? '' : 's'}`
        : 'TODAY: not played yet';

    const history = d.history();
    this.dailyHistoryEl.innerHTML =
      history.length === 0
        ? `<p class="shell-lb-empty">NO DAILIES YET</p>`
        : history
            .map(
              (e) =>
                `<div class="shell-lb-row shell-daily-row">` +
                `<span class="shell-lb-date">${fmtDateKey(e.dateKey)}</span>` +
                `<span class="shell-lb-score">${fmtNum(e.bestScore)}</span>` +
                `<span class="shell-lb-dist">${fmtNum(e.bestDistance)} m</span>` +
                `<span class="shell-lb-car">${this.carLabel(e.bestCarId)}</span>` +
                `</div>`,
            )
            .join('');
  }

  // --- crash screen -------------------------------------------------------

  /** Game-over placement callout. For a DAILY run (OPP-09): a daily badge (new
   *  daily best, else the replay count). Otherwise the OPP-15 board placement +
   *  nearest higher score to chase. Lines hide when nothing's earned. The two
   *  paths are mutually exclusive — daily + main board never mix. */
  private renderPlacement(placement: RunPlacement | null, daily: DailyResult | null = null): void {
    let badge = '';
    let target = '';
    if (daily) {
      // DAILY run: celebrate a new best on today's seed, else show the run count
      // (the "today <best>" line below is the score to chase — no board target).
      badge = daily.isBest ? 'DAILY BEST!' : `DAILY · RUN #${daily.runs}`;
    } else if (placement) {
      if (placement.rank === 1) {
        badge = 'NEW BEST!'; // #1 implies the car best too — keep it to one punch
      } else {
        const parts: string[] = [];
        if (placement.rank !== null) parts.push(`NEW #${placement.rank}!`);
        if (placement.isCarBest) parts.push(`BEST IN ${this.carLabel(placement.carId).toUpperCase()}`);
        badge = parts.join('  ·  ');
      }
      if (placement.target) target = `just ${fmtNum(placement.target.gap)} from #${placement.target.rank}`;
    }
    if (badge) {
      this.crashPlacementEl.textContent = badge;
      this.crashPlacementEl.style.display = '';
      if (typeof this.crashPlacementEl.animate === 'function') {
        this.crashPlacementEl.animate(
          [
            { opacity: 0, transform: 'scale(0.9)' },
            { opacity: 1, transform: 'scale(1.06)', offset: 0.6 },
            { opacity: 1, transform: 'scale(1)' },
          ],
          { duration: 600, easing: 'ease-out' },
        );
      }
    } else {
      this.crashPlacementEl.textContent = '';
      this.crashPlacementEl.style.display = 'none';
    }

    if (target) {
      this.crashTargetEl.textContent = target;
      this.crashTargetEl.style.display = '';
    } else {
      this.crashTargetEl.textContent = '';
      this.crashTargetEl.style.display = 'none';
    }
  }

  private buildCrash(): HTMLElement {
    const s = screen('shell-crash');
    s.innerHTML =
      `<h1 class="shell-title shell-wipeout">WIPEOUT</h1>` +
      `<p class="shell-crash-line shell-crash-score"></p>` +
      `<p class="shell-crash-placement"></p>` +
      `<p class="shell-crash-combo"></p>` +
      `<p class="shell-crash-unlock"></p>` +
      `<div class="shell-crash-missions"></div>` +
      `<p class="shell-crash-line shell-crash-best"></p>` +
      `<p class="shell-crash-credits"></p>` +
      `<p class="shell-crash-target"></p>` +
      `<button class="shell-btn shell-play-again" type="button">PLAY AGAIN</button>` +
      `<div class="shell-row">` +
      `<button class="shell-btn shell-btn--ghost shell-menu" type="button">MENU</button>` +
      `<button class="shell-btn shell-btn--ghost shell-share" type="button">SHARE</button>` +
      `</div>` +
      `<p class="shell-hint">tap / any key to retry · Esc for menu</p>`;

    s.querySelector('.shell-play-again')!.addEventListener('click', () => this.replay());
    s.querySelector('.shell-menu')!.addEventListener('click', () => this.menu());
    s.querySelector('.shell-share')!.addEventListener('click', () => this.doShare());
    // Tap anywhere on the crash backdrop (not a button) also retries.
    s.addEventListener('click', (e) => {
      if (e.target === s) this.replay();
    });
    return s;
  }

  // --- pause overlay ------------------------------------------------------

  private buildPause(): HTMLElement {
    const s = screen('shell-pause');
    s.innerHTML =
      `<h2 class="shell-subtitle">PAUSED</h2>` +
      `<button class="shell-btn shell-resume" type="button">RESUME</button>` +
      `<button class="shell-btn shell-btn--ghost shell-quit" type="button">QUIT TO MENU</button>` +
      `<p class="shell-hint">Esc / P to resume</p>`;
    s.querySelector('.shell-resume')!.addEventListener('click', () => this.resumeRun());
    s.querySelector('.shell-quit')!.addEventListener('click', () => this.menu());
    return s;
  }

  // --- share --------------------------------------------------------------

  private doShare(): void {
    // Called synchronously from the click handler (iOS transient-activation).
    share({ title: 'Neon Drift', url: this.opts.shareUrl }, this.root);
  }

  // --- keyboard -----------------------------------------------------------

  private onKeyDown(e: KeyboardEvent): void {
    // Never hijack keys meant for a focused TEXT FIELD (the MP join-code input, and
    // any future field) — this global handler would otherwise preventDefault e.g. the
    // pause key 'P', swallowing it before the input receives it. Bail so the field
    // gets the keystroke; pause still works when nothing is focused / during a run.
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    // In play (no overlay): Esc / P pauses.
    if (this.current === null) {
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        this.requestPause();
      }
      return;
    }
    switch (this.current) {
      case 'pause':
        // Esc / P resume; buttons handle their own Enter/Space activation.
        if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          this.resumeRun();
        }
        break;
      case 'start':
        // Any key starts — except Tab (focus traversal) and Enter/Space when a
        // non-PLAY button is focused (so keyboard users can reach CARS/SETTINGS/
        // SHARE). Modifiers alone are ignored.
        if (e.key === 'Tab' || e.key === 'Shift' || e.key === 'Escape') return;
        if ((e.key === 'Enter' || e.key === ' ') && this.focusedNonPlayButton()) return;
        e.preventDefault();
        this.play();
        break;
      case 'crash':
        if (e.key === 'Escape') {
          e.preventDefault();
          this.menu();
          return;
        }
        if (e.key === 'Tab' || e.key === 'Shift') return;
        if ((e.key === 'Enter' || e.key === ' ') && this.focusedNonPlayButton()) return;
        e.preventDefault();
        this.replay();
        break;
      case 'carpicker':
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.cycleCar(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.cycleCar(1);
        } else if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          this.go('start');
        }
        break;
      case 'missions':
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.cycleStartBiome(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.cycleStartBiome(1);
        } else if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          this.showStart();
        }
        break;
      case 'settings':
        if (e.key === 'Escape') {
          e.preventDefault();
          this.go('start');
        }
        break;
      case 'leaderboard':
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          this.showStart();
        }
        break;
      case 'daily':
        // Esc closes; Enter launches today's challenge (the screen's primary action).
        if (e.key === 'Escape') {
          e.preventDefault();
          this.showStart();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this.playDaily();
        }
        break;
      default:
        break; // in play — Controls handles keys
    }
  }

  /** True if a focused button on the active screen is NOT a play/again button. */
  private focusedNonPlayButton(): boolean {
    const el = document.activeElement;
    if (!(el instanceof HTMLButtonElement)) return false;
    return !el.classList.contains('shell-play') && !el.classList.contains('shell-play-again');
  }
}

function screen(modifier: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `shell-screen ${modifier}`;
  el.style.display = 'none';
  return el;
}

/** Rounded integer with thousands separators (e.g. 56142 → "56,142"). Fixed
 *  'en-US' grouping so leaderboard scores read consistently across locales. */
function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Short YYYY-MM-DD for a recorded run; '—' for a migrated legacy entry (date 0). */
function fmtDate(ms: number): string {
  return ms > 0 ? new Date(ms).toISOString().slice(0, 10) : '—';
}

/** Format a YYYYMMDD daily date key (e.g. 20260531 → "2026-05-31"). */
function fmtDateKey(key: number): string {
  const s = String(key);
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
}
