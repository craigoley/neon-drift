/**
 * Abstract input INTENT. PURE — and deliberately ignorant of how the intent was
 * produced: keyboard, touch, gamepad and tilt all map down to this same struct
 * in the rendering/input layer. The game layer only ever reads an InputIntent.
 *
 * No three, no DOM.
 */

export interface InputIntent {
  /** Steering magnitude in [-1, 1]: -1 = full left, +1 = full right, 0 = none. */
  steer: number;
  /** True while the handbrake (drift) control is held. */
  handbrake: boolean;
  /** True on the frame the player asks to (re)start a run. */
  restart: boolean;
}

export function createIntent(): InputIntent {
  return { steer: 0, handbrake: false, restart: false };
}

/** Clamp/normalise an intent into valid ranges (defensive; pure). */
export function normalizeIntent(intent: InputIntent): InputIntent {
  const steer = intent.steer < -1 ? -1 : intent.steer > 1 ? 1 : intent.steer;
  return { steer, handbrake: intent.handbrake, restart: intent.restart };
}
