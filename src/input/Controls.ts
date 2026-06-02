/**
 * Device input adapter. Translates keyboard AND touch into the pure
 * `InputIntent` the game layer consumes. This is the ONLY place that knows about
 * keys, pointers or touches — the game layer stays device-agnostic.
 *
 * Touch reaches the full steering range (parity with keyboard): a horizontal
 * drag from the touch origin maps linearly to [-1, 1] over `maxDragPx`. An
 * on-screen SLOW-MO button (deploy a banked charge) and tap-to-(re)start
 * complete parity.
 *
 * Lives outside src/game/ deliberately (it touches the DOM). No three imports.
 */

import { clamp } from '../utils/math';
import { TOUCH } from '../utils/constants';
import { createIntent, type InputIntent } from '../game/Input';

export class Controls {
  readonly intent: InputIntent = createIntent();

  // Keyboard steering (held keys).
  private leftHeld = false;
  private rightHeld = false;
  // Deploy key (Space) physical state, so key-repeat while held only arms the
  // one-shot deploy intent ONCE per press (the rising edge).
  private deployHeld = false;

  // Touch steering (continuous).
  private touchActive = false;
  private touchSteer = 0;
  private steerTouchId: number | null = null;
  private steerOriginX = 0;

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
        // DEPLOY a banked slow-mo charge — armed on the rising edge only (the
        // deployHeld guard makes OS key-repeat while held a no-op), so one press
        // can only ever spend one charge. The sim clears the intent when it acts.
        if (down) {
          if (!this.deployHeld) this.intent.deploySlowMo = true;
          this.deployHeld = true;
        } else {
          this.deployHeld = false;
        }
        break;
      default:
        break;
    }
    // NOTE: start/restart is driven by the shell (PLAY / crash screens), NOT by
    // raw key/tap here — otherwise tapping a menu button would start a run.
    this.resolveSteer();
  }

  /**
   * Wire touch steering on `surface` and build an on-screen SLOW-MO button
   * inside `uiParent`. Drag-to-steer; tap (no drag) acts as start/restart.
   */
  attachTouch(surface: HTMLElement, uiParent: HTMLElement): void {
    surface.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    surface.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    surface.addEventListener('touchend', (e) => this.onTouchEnd(e));
    surface.addEventListener('touchcancel', (e) => this.onTouchEnd(e));

    const btn = document.createElement('button');
    btn.className = 'touch-slowmo';
    btn.textContent = 'SLOW-MO';
    btn.setAttribute('aria-label', 'deploy slow-mo');
    // Each tap is its own rising edge → arms one deploy. The sim consumes it and
    // no-ops if the bank is empty or a slow-mo is already running.
    btn.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        this.intent.deploySlowMo = true;
      },
      { passive: false },
    );
    uiParent.appendChild(btn);
  }

  private onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    // start/restart is shell-driven (see onKey note); a canvas tap only steers.
    if (this.steerTouchId === null) {
      const t = e.changedTouches[0];
      this.steerTouchId = t.identifier;
      this.steerOriginX = t.clientX;
      this.touchActive = true;
      this.touchSteer = 0;
      this.resolveSteer();
    }
  }

  private onTouchMove(e: TouchEvent): void {
    if (this.steerTouchId === null) return;
    // Index loop over the indexable TouchList — avoids Array.from allocating on
    // every touch-move (~60 Hz during drag steering on mobile).
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier !== this.steerTouchId) continue;
      e.preventDefault();
      const dx = t.clientX - this.steerOriginX;
      // Subtract the deadzone and rescale so steer ramps continuously from 0 at
      // the deadzone edge to full lock at maxDragPx (no jump at the boundary).
      const sign = dx < 0 ? -1 : 1;
      const adjusted = Math.max(0, Math.abs(dx) - TOUCH.deadzonePx);
      this.touchSteer = clamp((sign * adjusted) / (TOUCH.maxDragPx - TOUCH.deadzonePx), -1, 1);
      this.resolveSteer();
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier !== this.steerTouchId) continue;
      this.steerTouchId = null;
      this.touchActive = false;
      this.touchSteer = 0;
      this.resolveSteer();
    }
  }

  private resolveSteer(): void {
    if (this.touchActive) {
      this.intent.steer = this.touchSteer;
    } else {
      this.intent.steer = (this.rightHeld ? 1 : 0) - (this.leftHeld ? 1 : 0);
    }
  }

  /**
   * Clear one-frame edge intents. Call once per rendered frame AFTER the fixed
   * update steps have consumed them, so `restart` fires for a single frame.
   */
  endFrame(): void {
    this.intent.restart = false;
  }
}
