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

/**
 * Frame-rate-independent exponential decay toward 0. Returns the fraction of a
 * quantity that REMAINS after `dt` seconds, given that `retainedPerSecond` of
 * it would remain after one full second. Used for weighty steering friction.
 */
export function decay(retainedPerSecond: number, dt: number): number {
  return Math.pow(retainedPerSecond, dt);
}

/** Smooth follow factor for lerping toward a target at `rate` per second. */
export function smoothFollow(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/**
 * Per-channel linear blend of two 0xRRGGBB colours by `t` (clamped to [0, 1]).
 * Returns a valid 0xRRGGBB integer — every channel stays in [0, 255], so the
 * result is always a well-formed colour (used for smooth biome transitions).
 * Pure; no three / no DOM.
 */
export function mixHex(a: number, b: number, t: number): number {
  const u = clamp(t, 0, 1);
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * u);
  const g = Math.round(ag + (bg - ag) * u);
  const bl = Math.round(ab + (bb - ab) * u);
  return (r << 16) | (g << 8) | bl;
}

/**
 * 1-D axis-aligned overlap test between two centred intervals. Returns true if
 * the intervals [a - aHalf, a + aHalf] and [b - bHalf, b + bHalf] overlap.
 */
export function intervalsOverlap(a: number, aHalf: number, b: number, bHalf: number): boolean {
  return Math.abs(a - b) < aHalf + bHalf;
}

/**
 * 2-D axis-aligned bounding-box overlap in (lateral, forward) space. Each box
 * is a centre plus half-extents. Pure — used for collision detection.
 */
export function aabbOverlap(
  lateralA: number,
  forwardA: number,
  halfWidthA: number,
  halfLengthA: number,
  lateralB: number,
  forwardB: number,
  halfWidthB: number,
  halfLengthB: number,
): boolean {
  return (
    intervalsOverlap(lateralA, halfWidthA, lateralB, halfWidthB) &&
    intervalsOverlap(forwardA, halfLengthA, forwardB, halfLengthB)
  );
}
