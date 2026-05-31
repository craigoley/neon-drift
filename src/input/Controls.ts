/**
 * Device input adapter. Translates keyboard AND touch into the pure
 * `InputIntent` the game layer consumes. This is the ONLY place that knows about
 * keys, pointers or touches — the game layer stays device-agnostic.
 *
 * Touch reaches the full steering range (parity with keyboard): a horizontal
 * drag from the touch origin maps linearly to [-1, 1] over `maxDragPx`. An
 * on-screen handbrake button and tap-to-(re)start complete parity.
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
        this.intent.handbrake = down;
        break;
      default:
        break;
    }
    if (down) this.intent.restart = true; // "press any key" to start/restart
    this.resolveSteer();
  }

  /**
   * Wire touch steering on `surface` and build an on-screen handbrake button
   * inside `uiParent`. Drag-to-steer; tap (no drag) acts as start/restart.
   */
  attachTouch(surface: HTMLElement, uiParent: HTMLElement): void {
    surface.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    surface.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    surface.addEventListener('touchend', (e) => this.onTouchEnd(e));
    surface.addEventListener('touchcancel', (e) => this.onTouchEnd(e));

    const btn = document.createElement('button');
    btn.className = 'touch-handbrake';
    btn.textContent = 'DRIFT';
    btn.setAttribute('aria-label', 'handbrake');
    const press = (v: boolean) => (e: Event) => {
      e.preventDefault();
      this.intent.handbrake = v;
    };
    btn.addEventListener('touchstart', press(true), { passive: false });
    btn.addEventListener('touchend', press(false));
    btn.addEventListener('touchcancel', press(false));
    uiParent.appendChild(btn);
  }

  private onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    this.intent.restart = true; // tap to start/restart
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
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== this.steerTouchId) continue;
      e.preventDefault();
      const dx = t.clientX - this.steerOriginX;
      const mag = Math.abs(dx) < TOUCH.deadzonePx ? 0 : dx;
      this.touchSteer = clamp(mag / TOUCH.maxDragPx, -1, 1);
      this.resolveSteer();
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
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
