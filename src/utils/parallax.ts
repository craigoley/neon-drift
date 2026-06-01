/**
 * Pure parallax-window math for the roadside scenery (no three, no DOM —
 * Node-testable). The camera is effectively fixed and the world streams past via
 * `distance`; a scenery layer is an evenly-spaced, RECYCLED ring of `count`
 * slots spaced `gap` apart. `parallaxRenderZ` maps a slot to its camera-relative
 * z each frame; the result is bounded to a fixed window regardless of how far
 * the player has driven (that boundedness is the pool guarantee), and a layer
 * with a smaller `parallax` factor sweeps more slowly (the depth cue).
 */

/**
 * Camera-relative z for scenery slot `index` of a layer, at the given travelled
 * `distance`. Negative = ahead of the camera (−z), positive = behind it. The
 * value stays within [(behind − count + 1)·gap, (behind + 1)·gap] for ALL
 * distances, so the layer is a fixed-size streaming window that never runs away.
 *
 * `parallax` scales how fast the layer reacts to travel: 1 = streams at true
 * world speed (near layer), <1 = drifts slower (far layer).
 */
export function parallaxRenderZ(
  distance: number,
  parallax: number,
  gap: number,
  index: number,
  behind: number,
): number {
  const d = distance * parallax;
  const frac = d - Math.floor(d / gap) * gap; // [0, gap)
  return frac + (behind - index) * gap;
}

/** The fixed z-window [min, max] a layer's slots occupy (for tests / culling). */
export function parallaxZRange(
  gap: number,
  count: number,
  behind: number,
): { min: number; max: number } {
  return { min: (behind - count + 1) * gap, max: (behind + 1) * gap };
}
