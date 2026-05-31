/**
 * Pure math helpers. No dependencies, fully Node-testable.
 */

/** Clamp `value` into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Linear interpolation between `a` and `b` by factor `t` (unclamped). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse lerp — where does `value` sit between `a` and `b`, as 0..1. */
export function inverseLerp(a: number, b: number, value: number): number {
  if (a === b) return 0;
  return (value - a) / (b - a);
}

/** Wrap `value` into the half-open range [0, range). */
export function wrap(value: number, range: number): number {
  if (range <= 0) return 0;
  return ((value % range) + range) % range;
}

/**
 * Snap a continuous lateral position to the centre of the nearest lane.
 * Lanes are evenly distributed across `width`, centred on 0.
 */
export function laneCenter(laneIndex: number, laneCount: number, width: number): number {
  const laneWidth = width / laneCount;
  // Centre of lane 0 is at the left edge + half a lane, offset so the row is centred on 0.
  return (laneIndex - (laneCount - 1) / 2) * laneWidth;
}
