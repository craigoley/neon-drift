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
import type { BestStore, BestRun } from '../storage/BestStore';
import type { AudioEngine } from '../audio/AudioEngine';
import { CARS, carStats, cssHex, handlingFor, SCORING, UI } from '../utils/constants';
import { share } from './share';

type Screen = 'start' | 'settings' | 'carpicker' | 'crash' | 'pause' | null;

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
}

export class Shell {
  private readonly root: HTMLElement;
  private current: Screen = null;
  private carIndex = 0;

  // Screens.
  private readonly startScreen: HTMLElement;
  private readonly settingsScreen: HTMLElement;
  private readonly carScreen: HTMLElement;
  private readonly crashScreen: HTMLElement;
  private readonly pauseScreen: HTMLElement;
  /** In-run PAUSE affordance (visible only while playing). */
  private readonly pauseBtn: HTMLButtonElement;

  // Dynamic nodes.
  private readonly startBest: HTMLElement;
  private readonly crashScoreEl: HTMLElement;
  private readonly crashComboEl: HTMLElement;
  private readonly crashBestEl: HTMLElement;
  private readonly carNameEl: HTMLElement;
  private readonly carCanvasEl: HTMLElement;
  private readonly carStatsEl: HTMLElement;
  private readonly carDotsEl: HTMLElement;
  private readonly soundValueEl: HTMLElement;

  private readonly settings: SettingsStore;
  private readonly best: BestStore;
  private readonly audio: AudioEngine;
  private readonly opts: ShellOptions;

  constructor(
    parent: HTMLElement,
    settings: SettingsStore,
    best: BestStore,
    audio: AudioEngine,
    opts: ShellOptions,
  ) {
    this.settings = settings;
    this.best = best;
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
    this.crashScreen = this.buildCrash();
    this.pauseScreen = this.buildPause();

    // Cache nodes that update at runtime.
    this.startBest = this.startScreen.querySelector('.shell-best')!;
    this.crashScoreEl = this.crashScreen.querySelector('.shell-crash-score')!;
    this.crashComboEl = this.crashScreen.querySelector('.shell-crash-combo')!;
    this.crashBestEl = this.crashScreen.querySelector('.shell-crash-best')!;
    this.carNameEl = this.carScreen.querySelector('.shell-car-name')!;
    this.carCanvasEl = this.carScreen.querySelector('.shell-car-canvas')!;
    this.carStatsEl = this.carScreen.querySelector('.shell-car-stats')!;
    this.carDotsEl = this.carScreen.querySelector('.shell-car-dots')!;
    this.soundValueEl = this.settingsScreen.querySelector('.shell-toggle-value')!;

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
  }

  // --- public screen transitions ----------------------------------------

  showStart(): void {
    this.startBest.textContent = this.bestLine(this.best.best);
    this.go('start');
  }

  showCrash(score: number, distance: number, best: BestRun, peakCombo: number): void {
    this.crashScoreEl.textContent = `score ${Math.round(score)} · ${Math.round(distance)} m`;
    // The live combo resets on crash, so the WIPEOUT screen is where the player
    // sees how daring the run was. Dimmed when the run never built a combo.
    this.crashComboEl.textContent = `MAX COMBO x${peakCombo.toFixed(1)}`;
    // Dim when the run never rose above the base combo (a daring run pops).
    this.crashComboEl.style.opacity = peakCombo > SCORING.baseCombo ? '1' : '0.45';
    this.crashBestEl.textContent = `best ${Math.round(best.score)} · ${Math.round(best.distance)} m`;
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
    this.crashScreen.style.display = screen === 'crash' ? 'flex' : 'none';
    this.pauseScreen.style.display = screen === 'pause' ? 'flex' : 'none';
    // `body.playing` gates the in-run controls (DRIFT + PAUSE) — only while playing.
    document.body.classList.toggle('playing', screen === null);

    // Spin up / tear down the 3D car preview with the picker (the rendering
    // layer owns the mesh; it must never run behind the game).
    if (screen === 'carpicker' && prev !== 'carpicker') {
      this.opts.onCarPickerEnter(this.carCanvasEl, CARS[this.carIndex].id);
    } else if (prev === 'carpicker' && screen !== 'carpicker') {
      this.opts.onCarPickerExit();
    }
  }

  private play(): void {
    this.go(null);
    this.opts.onPlay();
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
      ? 'drag to steer · DRIFT to dodge'
      : '← → / A D to steer · SPACE to drift';
    s.innerHTML =
      `<h1 class="shell-title">NEON DRIFT</h1>` +
      `<p class="shell-best"></p>` +
      `<button class="shell-btn shell-play" type="button">PLAY</button>` +
      `<p class="shell-hint">${hint}</p>` +
      `<div class="shell-row">` +
      `<button class="shell-btn shell-btn--ghost shell-cars" type="button">CARS</button>` +
      `<button class="shell-btn shell-btn--ghost shell-settings-open" type="button">SETTINGS</button>` +
      `</div>` +
      `<button class="shell-btn shell-btn--ghost shell-share" type="button">SHARE</button>`;

    s.querySelector('.shell-play')!.addEventListener('click', () => this.play());
    s.querySelector('.shell-cars')!.addEventListener('click', () => this.go('carpicker'));
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
      `<button class="shell-btn shell-toggle" type="button" role="switch">` +
      `<span class="shell-toggle-value">ON</span></button>` +
      `</div>` +
      // Room for future toggles (difficulty, reduced motion) — add rows here.
      `<button class="shell-btn shell-close" type="button">CLOSE</button>`;

    s.querySelector('.shell-toggle')!.addEventListener('click', () => this.toggleSound());
    s.querySelector('.shell-close')!.addEventListener('click', () => this.go('start'));
    return s;
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
    const toggle = this.settingsScreen.querySelector('.shell-toggle')!;
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
      `<div class="shell-car-stats">` +
      this.statRow('SPEED', 'speed') +
      this.statRow('GRIP', 'grip') +
      this.statRow('DRIFT', 'drift') +
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
    this.settings.set('selectedCarId', car.id); // persist
    this.opts.applyCar(car.id); // live update the rendered car behind the menu
    this.opts.onCarPickerCar(car.id); // update the 3D preview
    this.renderCar();
  }

  private renderCar(): void {
    const car = CARS[this.carIndex];
    this.carNameEl.textContent = car.displayName;

    // Stat bars — DERIVED from the same handling multipliers the sim uses
    // (carStats), tinted with the car's glow so they read with the preview.
    const stats = carStats(handlingFor(car.id));
    const glow = cssHex(car.cosmetic.glow);
    const setBar = (key: keyof typeof stats) => {
      const fill = this.carStatsEl.querySelector(`[data-stat="${key}"]`) as HTMLElement | null;
      if (!fill) return;
      fill.style.width = `${Math.round(stats[key] * 100)}%`;
      fill.style.background = glow;
      fill.style.boxShadow = `0 0 8px ${glow}`;
    };
    setBar('speed');
    setBar('grip');
    setBar('drift');

    // Page dots.
    this.carDotsEl.innerHTML = CARS.map(
      (_, i) => `<span class="shell-dot${i === this.carIndex ? ' shell-dot--on' : ''}"></span>`,
    ).join('');
  }

  // --- crash screen -------------------------------------------------------

  private buildCrash(): HTMLElement {
    const s = screen('shell-crash');
    s.innerHTML =
      `<h1 class="shell-title shell-wipeout">WIPEOUT</h1>` +
      `<p class="shell-crash-line shell-crash-score"></p>` +
      `<p class="shell-crash-combo"></p>` +
      `<p class="shell-crash-line shell-crash-best"></p>` +
      `<button class="shell-btn shell-play-again" type="button">PLAY AGAIN</button>` +
      `<div class="shell-row">` +
      `<button class="shell-btn shell-btn--ghost shell-menu" type="button">MENU</button>` +
      `<button class="shell-btn shell-btn--ghost shell-share" type="button">SHARE</button>` +
      `</div>` +
      `<p class="shell-hint">tap / any key to retry · Esc for menu</p>`;

    s.querySelector('.shell-play-again')!.addEventListener('click', () => this.play());
    s.querySelector('.shell-menu')!.addEventListener('click', () => this.menu());
    s.querySelector('.shell-share')!.addEventListener('click', () => this.doShare());
    // Tap anywhere on the crash backdrop (not a button) also retries.
    s.addEventListener('click', (e) => {
      if (e.target === s) this.play();
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
        this.play();
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
      case 'settings':
        if (e.key === 'Escape') {
          e.preventDefault();
          this.go('start');
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
