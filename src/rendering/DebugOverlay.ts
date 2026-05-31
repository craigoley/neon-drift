/**
 * Debug telemetry overlay (HTML). Rendering-layer concern: it READS game state
 * and telemetry and never mutates the simulation. Toggled with the backtick key
 * and shown on load when the URL has `?debug=1`.
 *
 * Surfaces the pipeline funnel counts so a framerate drop can be diagnosed:
 * road segments (spawned / recycled / active), traffic (spawned / culled /
 * active), and frame time + rolling FPS.
 */

import { activeSegmentCount } from '../game/Road';
import { activeObstacleCount, activeObstacleCountByKind } from '../game/Traffic';
import { activePickupCount } from '../game/Powerups';
import type { GameState } from '../game/GameState';
import type { Telemetry } from '../utils/Telemetry';
import { CSS_PALETTE, ObstacleKind, SCORING } from '../utils/constants';

export class DebugOverlay {
  private readonly el: HTMLElement;
  private visible: boolean;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('pre');
    this.el.className = 'debug-overlay';
    Object.assign(this.el.style, {
      position: 'absolute',
      top: '8px',
      left: '8px',
      margin: '0',
      padding: '8px 10px',
      font: '11px/1.4 monospace',
      color: CSS_PALETTE.cyan,
      background: 'rgba(26, 0, 51, 0.7)',
      border: `1px solid ${CSS_PALETTE.magenta}`,
      borderRadius: '4px',
      pointerEvents: 'none',
      whiteSpace: 'pre',
      zIndex: '50',
    } satisfies Partial<CSSStyleDeclaration>);

    const params = new URLSearchParams(window.location.search);
    this.visible = params.get('debug') === '1';
    this.el.style.display = this.visible ? 'block' : 'none';
    parent.appendChild(this.el);

    window.addEventListener('keydown', (e) => {
      if (e.key === '`') this.toggle();
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  /**
   * Refresh the readout from current state. No-op work when hidden.
   * `hudComboText` is the LIVE text of the HUD's combo element (funnel step 6).
   */
  update(game: GameState, telemetry: Telemetry, hudComboText: string): void {
    if (!this.visible) return;
    const road = game.road;
    const traffic = game.traffic;
    const powerups = game.powerups;
    const fx = powerups.effects;
    const score = game.score;
    const ev = game.lastEvents;
    const scoreRatio = game.distance > 0 ? score.score / game.distance : 1;

    // Raw combo funnel — print each step so the exact break point is visible.
    const closeLat =
      ev.closestLateral === undefined || ev.closestLateral === Infinity
        ? '--'
        : ev.closestLateral.toFixed(2);
    const closeLon =
      ev.closestLongitudinal === undefined || ev.closestLongitudinal === Infinity
        ? '--'
        : ev.closestLongitudinal.toFixed(1);

    this.el.textContent =
      `NEON DRIFT · debug (\` to toggle)\n` +
      `fps ${telemetry.fps.toFixed(0).padStart(3)}  frame ${telemetry.lastMs.toFixed(1)}ms  avg ${telemetry.avgMs.toFixed(1)}ms\n` +
      `phase ${game.phase}  dist ${game.distance.toFixed(0)}  spd ${game.vehicle.speed.toFixed(0)}\n` +
      `road  active ${activeSegmentCount(road)}  spawned ${road.spawned}  recycled ${road.recycled}\n` +
      `traf  active ${activeObstacleCount(traffic)}/${traffic.pool.length}  spawned ${traffic.spawned}  culled ${traffic.culled}\n` +
      `  mix  S${activeObstacleCountByKind(traffic, ObstacleKind.Static)} ` +
      `M${activeObstacleCountByKind(traffic, ObstacleKind.Mover)} ` +
      `G${activeObstacleCountByKind(traffic, ObstacleKind.Gate)} ` +
      `R${activeObstacleCountByKind(traffic, ObstacleKind.Ramp)}  boost ${game.vehicle.boostTimer.toFixed(1)}s\n` +
      `pup   active ${activePickupCount(powerups)}/${powerups.pool.length}  spawned ${powerups.spawned}  got ${powerups.collected}  culled ${powerups.culled}\n` +
      `fx    shield ${fx.shield ? 'Y' : 'n'}${fx.invulnTimer > 0 ? `(iv ${fx.invulnTimer.toFixed(1)})` : ''}  slow ${fx.slowMoTimer.toFixed(1)}  x2 ${fx.scoreBoostTimer.toFixed(1)}  mag ${fx.magnetTimer.toFixed(1)}\n` +
      `-- COMBO FUNNEL (raw) ----------------\n` +
      `1 evaluated/frame   ${ev.evaluated ?? 0}\n` +
      `2 closest lat/lon    ${closeLat} / ${closeLon}\n` +
      `3 near-miss thresh   ${SCORING.nearMissLateral.toFixed(2)} (lat gap < this = hit)\n` +
      `4 near-miss events   ${score.nearMisses}\n` +
      `5 combo INTERNAL     ${score.combo.toFixed(3)}  (peak ${score.peakCombo.toFixed(2)})\n` +
      `6 combo HUD-bound    ${hudComboText}\n` +
      `7 combo timer        ${score.comboTimer.toFixed(2)}s\n` +
      `  score ${score.score.toFixed(0)}  score/dist ${scoreRatio.toFixed(2)}`;
  }
}
