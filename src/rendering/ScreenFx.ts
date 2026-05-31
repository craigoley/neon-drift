/**
 * Full-screen DOM effects layer: a near-miss screen-edge glow pulse and a crash
 * flash. Pure DOM (no three). Driven by the main loop; owns no game state.
 */

import { JUICE } from '../utils/constants';

export class ScreenFx {
  private readonly edge: HTMLElement;
  private readonly flash: HTMLElement;
  private edgeTimer = 0;
  private flashTimer = 0;

  constructor(parent: HTMLElement) {
    this.edge = document.createElement('div');
    this.edge.className = 'fx-edge';
    this.flash = document.createElement('div');
    this.flash.className = 'fx-flash';
    parent.append(this.edge, this.flash);
  }

  /** Trigger the cyan edge-glow pulse (near-miss). */
  pulseNearMiss(): void {
    this.edgeTimer = JUICE.nearMissPulse;
  }

  /** Trigger the white crash flash. */
  flashCrash(): void {
    this.flashTimer = JUICE.freezeFrame * JUICE.crashFlashMultiplier;
  }

  update(dt: number): void {
    if (this.edgeTimer > 0) {
      this.edgeTimer -= dt;
      this.edge.style.opacity = String(Math.max(0, this.edgeTimer / JUICE.nearMissPulse));
    } else if (this.edge.style.opacity !== '0') {
      this.edge.style.opacity = '0';
    }

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      this.flash.style.opacity = String(
        Math.max(0, this.flashTimer / (JUICE.freezeFrame * JUICE.crashFlashMultiplier)),
      );
    } else if (this.flash.style.opacity !== '0') {
      this.flash.style.opacity = '0';
    }
  }
}
