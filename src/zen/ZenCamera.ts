/**
 * ZEN chase-camera FRAMING — the pure speed→(distance, FOV) curve, split out of the
 * three.js renderer so it lives in ONE Node-testable place (Craig dials the feel on his
 * phone via the ZEN constants). PURE: no three, no DOM.
 *
 * GENTLE by design — a MOSTLY-STEADY camera with only a whisper of speed reactivity,
 * the OPPOSITE of the racing adrenaline cam (where FOV-punch / camera-closer / big swing
 * are speed-thrill tricks). Here the rest→max swing is just the small `*SpeedGain` knobs:
 * a comfortable resting FLOOR, then a SMALL eased pull-back + a SUBTLE FOV widen at speed.
 *
 * The EASING/smoothing of the speed factor (so brief throttle changes don't pump the
 * framing) happens in the renderer with dt; this is the steady-state mapping it feeds.
 */

import { clamp } from '../utils/math';
import { ZEN } from '../utils/constants';

export interface ZenFraming {
  /** Chase distance behind the car (world units). */
  distance: number;
  /** Camera field-of-view (degrees). */
  fov: number;
}

/**
 * Map a 0..1 speed factor (speed / maxSpeed) to the chase distance + FOV. MONOTONIC and
 * gentle: at 0 it sits at the resting floor (camDistance / camFov); at 1 it has pulled
 * back by exactly `camDistanceSpeedGain` and widened by `camFovSpeedGain` — the whole
 * swing. Set `camDistanceSpeedGain` to 0 for a fully steady camera.
 */
// Reused scratch object — avoids allocating a new object every frame.
const _scratch: ZenFraming = { distance: 0, fov: 0 };

export function zenFraming(speedFactor: number): ZenFraming {
  const s = clamp(speedFactor, 0, 1);
  _scratch.distance = ZEN.camDistance + ZEN.camDistanceSpeedGain * s;
  _scratch.fov = ZEN.camFov + ZEN.camFovSpeedGain * s;
  return _scratch;
}
