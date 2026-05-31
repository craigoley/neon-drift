/**
 * HTML overlay HUD. Pure DOM — no three, no WebGL. Sits above the canvas and
 * shows the title and (later) score/speed. Reads values handed to it; it owns
 * no game state.
 */

import { CSS_PALETTE } from '../utils/constants';

export class HUD {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';

    this.title = document.createElement('h1');
    this.title.className = 'hud-title';
    this.title.textContent = 'NEON DRIFT';
    this.title.style.color = CSS_PALETTE.cyan;

    this.root.appendChild(this.title);
    parent.appendChild(this.root);
  }

  /** Update score/speed readouts. No-op placeholder until gameplay exists. */
  sync(_score: number, _speed: number): void {
    // Intentionally empty in the scaffold render.
  }
}
