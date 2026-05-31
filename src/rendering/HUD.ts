/**
 * In-play HUD stats bar. Pure DOM — no three. Shows live speed / distance /
 * score / combo / best while playing. The start, settings, car-picker and crash
 * screens live in the front-end shell (src/ui/Shell.ts), not here.
 *
 * Reads game state + the persisted best; owns no game state.
 */

import type { GameState } from '../game/GameState';
import { Phase } from '../game/GameState';
import type { PowerupEffects } from '../game/Powerups';
import {
  cssHex,
  JUICE,
  OBJECTIVES,
  type ObjectiveId,
  POWERUP_DEFS,
  POWERUP_ORDER,
  PowerupKind,
} from '../utils/constants';

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
  /** Active-powerup chip strip + a reused chip per kind (built once). */
  private readonly powerups: HTMLElement;
  private readonly chips: Record<PowerupKind, { root: HTMLElement; timer: HTMLElement }>;
  /** Subtle per-run objectives panel: one reused row per objective. */
  private readonly objectives: HTMLElement;
  private readonly objectiveRows: Record<ObjectiveId, { root: HTMLElement; label: HTMLElement }>;
  /** Transient milestone/biome toast. */
  private readonly toast: HTMLElement;
  /** Last combo shown, to detect tier-ups for the celebration pulse. */
  private lastCombo = 1;

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

    // Active-powerup chips — one reused chip per kind, shown only while active.
    this.powerups = el('div', 'hud-powerups');
    this.chips = {} as Record<PowerupKind, { root: HTMLElement; timer: HTMLElement }>;
    for (const kind of POWERUP_ORDER) {
      const def = POWERUP_DEFS[kind];
      const color = cssHex(def.color);
      const chip = el('div', 'hud-pup');
      chip.style.setProperty('--pup-color', color);
      chip.style.borderColor = color;
      chip.style.color = color;
      chip.style.textShadow = `0 0 5px ${color}, 0 1px 2px rgba(0,0,0,0.85)`;
      const glyph = el('span', 'hud-pup-glyph');
      glyph.textContent = def.glyph;
      const timer = el('span', 'hud-pup-timer');
      chip.append(glyph, timer);
      chip.style.display = 'none';
      this.powerups.appendChild(chip);
      this.chips[kind] = { root: chip, timer };
    }

    // Subtle objectives panel — one reused row per objective (built once).
    this.objectives = el('div', 'hud-objectives');
    this.objectiveRows = {} as Record<ObjectiveId, { root: HTMLElement; label: HTMLElement }>;
    for (const o of OBJECTIVES) {
      const row = el('div', 'hud-objective');
      const label = el('span', 'hud-objective-label');
      row.appendChild(label);
      this.objectives.appendChild(row);
      this.objectiveRows[o.id] = { root: row, label };
    }

    // Transient milestone toast (centred, upper area — clear of the road).
    this.toast = el('div', 'hud-toast');
    this.toast.style.opacity = '0';

    root.append(this.stats, this.powerups, this.objectives, this.toast);
    parent.appendChild(root);
  }

  /**
   * Flash a milestone / biome toast: a brief, non-intrusive centred banner in
   * the given palette colour. Uses the Web Animations API (guarded — absent in
   * jsdom/tests, where it's a no-op besides setting the text).
   */
  showToast(text: string, color: string): void {
    this.toast.textContent = text;
    this.toast.style.setProperty('--toast-color', color);
    if (typeof this.toast.animate !== 'function') return;
    this.toast.animate(
      [
        { opacity: 0, transform: 'translate(-50%, -6px) scale(0.96)' },
        { opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.15 },
        { opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.7 },
        { opacity: 0, transform: 'translate(-50%, -6px) scale(1)' },
      ],
      { duration: JUICE.milestoneToastMs, easing: 'ease-out' },
    );
  }

  sync(game: GameState, best: BestDisplay): void {
    // Show the stats bar only while playing (the shell overlays cover the menu /
    // crash states). The text is updated EVERY frame regardless of visibility so
    // it always mirrors the internal combo — including the crash frame where the
    // combo resets (locked by hud_combo_funnel.test.ts).
    const playing = game.phase === Phase.Playing;
    this.stats.style.display = playing ? 'flex' : 'none';
    this.powerups.style.display = playing ? 'flex' : 'none';
    this.objectives.style.display = playing ? 'flex' : 'none';

    this.speedEl.textContent = `${Math.round(game.vehicle.speed)} km/s`;
    this.distEl.textContent = `${Math.round(game.distance)} m`;
    this.scoreEl.textContent = `${Math.round(game.score.score)}`;
    this.comboEl.textContent = `x${game.score.combo.toFixed(1)}`;
    this.comboEl.style.opacity = game.score.combo > 1 ? '1' : '0.6';
    // Tier-up celebration: a brief scale/glow pulse when the multiplier climbs.
    if (game.score.combo > this.lastCombo + 1e-6) this.pulseCombo();
    this.lastCombo = game.score.combo;
    this.bestEl.textContent = `best ${Math.round(best.score)}`;

    this.syncPowerups(game.powerups.effects);
    this.syncObjectives(game);
  }

  /** Update the subtle objectives panel: progress count + a done state, read
   *  straight from the pure milestone state. */
  private syncObjectives(game: GameState): void {
    for (const o of OBJECTIVES) {
      const row = this.objectiveRows[o.id];
      const done = game.milestones.done[o.id];
      const have = Math.min(game.milestones.progress[o.id], o.target);
      row.label.textContent = done ? `✓ ${o.label}` : `${o.label} (${have}/${o.target})`;
      row.root.classList.toggle('done', done);
    }
  }

  /** Show a chip per active effect with its remaining time (SHIELD shows "1",
   *  the held charge count, since it has no duration). */
  private syncPowerups(effects: PowerupEffects): void {
    this.setChip(PowerupKind.Shield, effects.shield, effects.shield ? '1' : '');
    this.setChip(PowerupKind.SlowMo, effects.slowMoTimer > 0, secs(effects.slowMoTimer));
    this.setChip(PowerupKind.ScoreBoost, effects.scoreBoostTimer > 0, secs(effects.scoreBoostTimer));
    this.setChip(PowerupKind.Magnet, effects.magnetTimer > 0, secs(effects.magnetTimer));
  }

  private setChip(kind: PowerupKind, active: boolean, timerText: string): void {
    const chip = this.chips[kind];
    chip.root.style.display = active ? 'flex' : 'none';
    chip.timer.textContent = timerText;
  }

  /** Brief scale + glow pulse on the combo readout when it tiers up. Uses the
   *  Web Animations API (guarded — not present in jsdom/tests). */
  private pulseCombo(): void {
    if (typeof this.comboEl.animate !== 'function') return;
    this.comboEl.animate(
      [
        { transform: 'scale(1)' },
        { transform: `scale(${JUICE.comboPulseScale})`, filter: `brightness(${JUICE.comboPulseBrightness})` },
        { transform: 'scale(1)' },
      ],
      { duration: JUICE.comboPulseMs, easing: 'ease-out' },
    );
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

/** Remaining seconds as a compact "Ns" label (ceil so it never shows 0s while
 *  still active). */
function secs(remaining: number): string {
  return `${Math.ceil(remaining)}s`;
}
