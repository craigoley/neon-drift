/**
 * In-play HUD stats bar. Pure DOM — no three. Shows live speed / distance /
 * score / combo / best while playing. The start, settings, car-picker and crash
 * screens live in the front-end shell (src/ui/Shell.ts), not here.
 *
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

    root.append(this.stats);
    parent.appendChild(root);
  }

  sync(game: GameState, best: BestDisplay): void {
    // Show the stats bar only while playing (the shell overlays cover the menu /
    // crash states). The text is updated EVERY frame regardless of visibility so
    // it always mirrors the internal combo — including the crash frame where the
    // combo resets (locked by hud_combo_funnel.test.ts).
    this.stats.style.display = game.phase === Phase.Playing ? 'flex' : 'none';

    this.speedEl.textContent = `${Math.round(game.vehicle.speed)} km/s`;
    this.distEl.textContent = `${Math.round(game.distance)} m`;
    this.scoreEl.textContent = `${Math.round(game.score.score)}`;
    this.comboEl.textContent = `x${game.score.combo.toFixed(1)}`;
    this.comboEl.style.opacity = game.score.combo > 1 ? '1' : '0.6';
    this.bestEl.textContent = `best ${Math.round(best.score)}`;
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
