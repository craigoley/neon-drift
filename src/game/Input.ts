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
  /** One-shot DEPLOY request for a banked slow-mo charge: set true on the rising
   *  edge of the button (Space / touch), and CONSUMED (cleared) by the sim the
   *  first time it acts on it. A latch, not a held level — so holding the button
   *  or running several fixed-update sub-steps in one frame can only ever spend
   *  ONE charge per press (see GameState.update). */
  deploySlowMo: boolean;
  /** True on the frame the player asks to (re)start a run. */
  restart: boolean;
}

export function createIntent(): InputIntent {
  return { steer: 0, deploySlowMo: false, restart: false };
}
