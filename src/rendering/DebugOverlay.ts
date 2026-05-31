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
import { activeObstacleCount } from '../game/Traffic';
import type { GameState } from '../game/GameState';
import type { Telemetry } from '../utils/Telemetry';
import { CSS_PALETTE } from '../utils/constants';

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

  /** Refresh the readout from current state. No-op work when hidden. */
  update(game: GameState, telemetry: Telemetry): void {
    if (!this.visible) return;
    const road = game.road;
    const traffic = game.traffic;
    const score = game.score;
    // Scoring funnel: if combo stays 1.00 and score==dist, near-misses never fire.
    const scoreRatio = game.distance > 0 ? score.score / game.distance : 1;
    this.el.textContent =
      `NEON DRIFT · debug (\` to toggle)\n` +
      `fps ${telemetry.fps.toFixed(0).padStart(3)}  frame ${telemetry.lastMs.toFixed(1)}ms  avg ${telemetry.avgMs.toFixed(1)}ms\n` +
      `phase ${game.phase}  dist ${game.distance.toFixed(0)}  spd ${game.vehicle.speed.toFixed(0)}\n` +
      `road  active ${activeSegmentCount(road)}  spawned ${road.spawned}  recycled ${road.recycled}\n` +
      `traf  active ${activeObstacleCount(traffic)}/${traffic.pool.length}  spawned ${traffic.spawned}  culled ${traffic.culled}\n` +
      `score ${score.score.toFixed(0)}  combo x${score.combo.toFixed(2)}  near-miss ${score.nearMisses}  score/dist ${scoreRatio.toFixed(2)}`;
  }
}
