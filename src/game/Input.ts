/**
 * Keyboard + touch input abstraction.
 *
 * PURE: this module imports nothing from three and never touches WebGL. The
 * input *state* is a plain object that can be driven directly in Node tests via
 * the `apply*` methods. The optional `attach()` binds real DOM events to those
 * same methods, so the browser and the test harness share one code path.
 */

/** Normalised, frame-readable input state. The game layer reads only this. */
export interface InputState {
  /** -1 = full left, 0 = none, +1 = full right. */
  steer: number;
  /** True while the accelerate control is held. */
  accelerate: boolean;
  /** True while the brake control is held. */
  brake: boolean;
}

export function createInputState(): InputState {
  return { steer: 0, accelerate: false, brake: false };
}

export class Input {
  readonly state: InputState = createInputState();

  /** Tracks which steer keys are currently down so we can resolve `steer`. */
  private leftHeld = false;
  private rightHeld = false;

  applyKeyDown(key: string): void {
    this.setKey(key, true);
  }

  applyKeyUp(key: string): void {
    this.setKey(key, false);
  }

  /**
   * Apply a touch/pointer in viewport-normalised X (0 = left edge, 1 = right
   * edge). The lower third of the screen accelerates; left/right halves steer.
   */
  applyTouch(normalizedX: number, active: boolean): void {
    if (!active) {
      this.leftHeld = false;
      this.rightHeld = false;
      this.state.accelerate = false;
      this.resolveSteer();
      return;
    }
    this.leftHeld = normalizedX < 0.5;
    this.rightHeld = normalizedX >= 0.5;
    this.state.accelerate = true;
    this.resolveSteer();
  }

  private setKey(key: string, pressed: boolean): void {
    switch (key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        this.leftHeld = pressed;
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        this.rightHeld = pressed;
        break;
      case 'ArrowUp':
      case 'w':
      case 'W':
        this.state.accelerate = pressed;
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        this.state.brake = pressed;
        break;
      default:
        return;
    }
    this.resolveSteer();
  }

  private resolveSteer(): void {
    this.state.steer = (this.rightHeld ? 1 : 0) - (this.leftHeld ? 1 : 0);
  }

  /**
   * Wire real DOM events to the pure `apply*` methods. Only called in the
   * browser; never imported into Node tests, which drive `apply*` directly.
   */
  attach(target: EventTarget): () => void {
    const onKeyDown = (e: Event) => this.applyKeyDown((e as KeyboardEvent).key);
    const onKeyUp = (e: Event) => this.applyKeyUp((e as KeyboardEvent).key);
    const onTouch = (e: Event) => {
      const touch = (e as TouchEvent).touches[0];
      if (!touch) {
        this.applyTouch(0, false);
        return;
      }
      this.applyTouch(touch.clientX / window.innerWidth, true);
    };
    const onTouchEnd = () => this.applyTouch(0, false);

    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
    target.addEventListener('touchstart', onTouch);
    target.addEventListener('touchmove', onTouch);
    target.addEventListener('touchend', onTouchEnd);

    return () => {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('touchstart', onTouch);
      target.removeEventListener('touchmove', onTouch);
      target.removeEventListener('touchend', onTouchEnd);
    };
  }
}
