/**
 * HTML overlay HUD. Pure DOM — no three. Shows live speed / distance / score /
 * combo / best during play, a menu screen, and a crash ("WIPEOUT") screen.
 * Reads game state + the persisted best; owns no game state.
 */

import type { GameState } from '../game/GameState';
import { Phase } from '../game/GameState';

/** Minimal shape the HUD needs for the best run (kept local to avoid coupling). */
export interface BestDisplay {
  distance: number;
  score: number;
}

export class HUD {
  private readonly stats: HTMLElement;
  private readonly speedEl: HTMLElement;
  private readonly distEl: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly comboEl: HTMLElement;
  private readonly bestEl: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly crash: HTMLElement;
  private readonly crashScore: HTMLElement;
  private readonly crashBest: HTMLElement;

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'hud';

    this.stats = el('div', 'hud-stats');
    this.speedEl = el('span', 'hud-stat');
    this.distEl = el('span', 'hud-stat');
    this.scoreEl = el('span', 'hud-stat');
    this.comboEl = el('span', 'hud-combo');
    this.bestEl = el('span', 'hud-best');
    this.stats.append(this.speedEl, this.distEl, this.scoreEl, this.comboEl, this.bestEl);

    this.menu = el('div', 'hud-screen hud-menu');
    this.menu.innerHTML =
      `<h1 class="hud-title">NEON DRIFT</h1>` +
      `<p class="hud-prompt">press <b>any key</b> / <b>tap</b> to start</p>`;

    this.crash = el('div', 'hud-screen hud-crash');
    const crashTitle = el('h1', 'hud-title hud-wipeout');
    crashTitle.textContent = 'WIPEOUT';
    this.crashScore = el('p', 'hud-crash-line');
    this.crashBest = el('p', 'hud-crash-line');
    const crashPrompt = el('p', 'hud-prompt');
    // Any keydown triggers restart (see Controls.onKey), so match the menu's
    // wording rather than implying only Enter works.
    crashPrompt.innerHTML = `press <b>any key</b> / <b>tap</b> to restart`;
    this.crash.append(crashTitle, this.crashScore, this.crashBest, crashPrompt);

    root.append(this.stats, this.menu, this.crash);
    parent.appendChild(root);
  }

  sync(game: GameState, best: BestDisplay): void {
    const playing = game.phase === Phase.Playing;
    this.stats.style.opacity = playing ? '1' : '0.25';
    this.menu.style.display = game.phase === Phase.Menu ? 'flex' : 'none';
    this.crash.style.display = game.phase === Phase.Crashed ? 'flex' : 'none';

    this.speedEl.textContent = `${Math.round(game.vehicle.speed)} km/s`;
    this.distEl.textContent = `${Math.round(game.distance)} m`;
    this.scoreEl.textContent = `${Math.round(game.score.score)}`;
    this.comboEl.textContent = `x${game.score.combo.toFixed(1)}`;
    this.comboEl.style.opacity = game.score.combo > 1 ? '1' : '0.6';
    this.bestEl.textContent = `best ${Math.round(best.score)}`;

    if (game.phase === Phase.Crashed) {
      this.crashScore.textContent = `score ${Math.round(game.score.score)} · ${Math.round(game.distance)} m`;
      this.crashBest.textContent = `best ${Math.round(best.score)} · ${Math.round(best.distance)} m`;
    }
  }

  /** The exact text currently shown by the combo element — for the ?debug=1
   *  funnel panel (step 6: what the HUD multiplier is actually bound to). */
  comboText(): string {
    return this.comboEl.textContent ?? '';
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
