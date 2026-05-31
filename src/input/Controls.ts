/**
 * Device input adapter. Translates keyboard (and, from Step 7, touch) into the
 * pure `InputIntent` the game layer consumes. This is the ONLY place that knows
 * about keys, pointers or touches — the game layer stays device-agnostic.
 *
 * Lives outside src/game/ deliberately (it touches the DOM). It does not import
 * three.
 */

import { createIntent, type InputIntent } from '../game/Input';

export class Controls {
  readonly intent: InputIntent = createIntent();

  private leftHeld = false;
  private rightHeld = false;

  attachKeyboard(target: Window): void {
    target.addEventListener('keydown', (e) => this.onKey(e, true));
    target.addEventListener('keyup', (e) => this.onKey(e, false));
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    switch (e.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        this.leftHeld = down;
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        this.rightHeld = down;
        break;
      case ' ':
        this.intent.handbrake = down;
        break;
      default:
        break;
    }
    // Any key-down acts as the start/restart confirm ("press any key").
    if (down) this.intent.restart = true;
    this.resolveSteer();
  }

  private resolveSteer(): void {
    this.intent.steer = (this.rightHeld ? 1 : 0) - (this.leftHeld ? 1 : 0);
  }

  /**
   * Clear one-frame edge intents. Call once per rendered frame AFTER the fixed
   * update steps have consumed them, so `restart` fires for a single frame.
   */
  endFrame(): void {
    this.intent.restart = false;
  }
}
