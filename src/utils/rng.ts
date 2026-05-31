/**
 * Seeded pseudo-random number generation. PURE and deterministic: a given seed
 * always produces the same sequence, so road/traffic behaviour is reproducible
 * and unit-testable. No three, no DOM, no global Math.random.
 */

/** A small, fast, stateful PRNG (mulberry32). */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Coerce to a 32-bit unsigned integer so the same numeric seed is stable.
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Next float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Snapshot the internal state (for save/replay/debugging). */
  getState(): number {
    return this.state;
  }
}

/**
 * Deterministic value noise in [-1, 1] from two integers, independent of any
 * traversal order. Used for road curvature so segment `index` always maps to
 * the same curve for a given seed (reproducible regardless of how the player
 * drives). This is a pure hash, NOT a sequential RNG.
 */
export function hashNoise(seed: number, index: number): number {
  let h = (seed ^ Math.imul(index, 0x27d4eb2f)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 4294967296) * 2 - 1;
}
