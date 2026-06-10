/**
 * ZEN FREE-ROAM world streaming (PR2) — the PURE chunk grid + POSITION-DETERMINISTIC
 * prop placement + radius-based load/cull. No three, no DOM → Node-testable; the
 * three.js instancing lives in ZenScenery. Builds on PR1's ZenVehicle (x, z).
 *
 * Procedural-infinite-terrain best practices applied here:
 *  - Placement is keyed to WORLD chunk coords via a spatial hash (chunkKey), NOT to any
 *    path/chunk-local RNG state. Same seed + same chunk ALWAYS yields the same props,
 *    however you reach it — the world is consistent and seams are invisible (the 2D
 *    version of the #92 lesson).
 *  - Load/cull is a simple square (Chebyshev) radius of chunks around the car: generate
 *    on approach, drop when far. Research says this beats clever occlusion for
 *    procedural terrain; the bounded radius caps BOTH draw distance and the prop budget.
 */

import { hashNoise } from '../utils/rng';
import { ZEN } from '../utils/constants';

/** A placed scenery prop in WORLD space (visual only this PR — no collision until PR3). */
export interface ZenProp {
  /** Which reused scenery mesh (index into SCENERY.layers: palm / pole / block). */
  kind: number;
  x: number;
  z: number;
  /** Yaw (radians). */
  rotationY: number;
  /** Uniform scale multiplier on the reused mesh. */
  scale: number;
}

/** Hash-index slots reserved per prop (one per derived field, with headroom). */
const PROP_STRIDE = 8;

/** World coordinate → chunk index (floor division; correct for negatives). */
export function worldToChunk(coord: number, size: number): number {
  return Math.floor(coord / size);
}

/**
 * Flatten 2D chunk coords to a 32-bit key (the classic spatial-hash primes). Keying
 * placement to this — rather than to traversal order — is what makes the world
 * position-deterministic: chunk (cx, cz) hashes the same no matter how you got there.
 */
export function chunkKey(cx: number, cz: number): number {
  return (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) | 0;
}

/** One independent 0..1 value for (chunk key, slot), via the pure positional hash. */
function unit(seed: number, key: number, slot: number): number {
  const idx = (Math.imul(key, 0x9e3779b1) + slot) | 0;
  return (hashNoise(seed, idx) + 1) * 0.5;
}

/**
 * The deterministic prop list for one chunk. Depends ONLY on (seed, cx, cz) — repeatable
 * and path-independent. The per-chunk count varies 0..propsPerChunk (via the hash) so the
 * world has open chunks to cruise through rather than a uniform grid of props.
 */
export function chunkProps(seed: number, cx: number, cz: number, kinds: number): ZenProp[] {
  const key = chunkKey(cx, cz);
  const size = ZEN.chunkSize;
  const count = Math.floor(unit(seed, key, 0) * (ZEN.propsPerChunk + 1));
  const props: ZenProp[] = [];
  for (let i = 0; i < count; i++) {
    const base = 1 + i * PROP_STRIDE;
    props.push({
      kind: Math.min(kinds - 1, Math.floor(unit(seed, key, base + 2) * kinds)),
      x: cx * size + unit(seed, key, base + 0) * size,
      z: cz * size + unit(seed, key, base + 1) * size,
      rotationY: unit(seed, key, base + 3) * Math.PI * 2,
      scale: ZEN.propScaleMin + unit(seed, key, base + 4) * (ZEN.propScaleMax - ZEN.propScaleMin),
    });
  }
  return props;
}

/** Max chunks ever active for a Chebyshev radius — a (2R+1)² square. */
export function maxActiveChunks(radius: number): number {
  const side = 2 * radius + 1;
  return side * side;
}

interface LoadedChunk {
  cx: number;
  cz: number;
  props: ZenProp[];
}

/**
 * The active chunk set around the car: loads chunks on approach, culls them when far,
 * so the active prop count stays BOUNDED no matter how far you roam (no leak). Pure —
 * the renderer reads `forEachProp` to fill its instanced meshes.
 */
export class ZenChunkField {
  private readonly loaded = new Map<string, LoadedChunk>();
  private readonly seed: number;
  private readonly radius: number;
  private readonly kinds: number;
  private carCx = NaN;
  private carCz = NaN;

  constructor(seed: number, radius: number, kinds: number) {
    this.seed = seed;
    this.radius = radius;
    this.kinds = kinds;
  }

  /**
   * Recompute the active set for the car position. Returns true if the set CHANGED (the
   * caller should rebuild its instances); false when the car is still in the same chunk —
   * the cheap common case, so streaming work only happens on chunk-boundary crossings.
   */
  update(carX: number, carZ: number): boolean {
    const cx = worldToChunk(carX, ZEN.chunkSize);
    const cz = worldToChunk(carZ, ZEN.chunkSize);
    if (cx === this.carCx && cz === this.carCz && this.loaded.size > 0) return false;
    this.carCx = cx;
    this.carCz = cz;

    // Cull: drop chunks now outside the radius.
    for (const [id, c] of this.loaded) {
      if (Math.abs(c.cx - cx) > this.radius || Math.abs(c.cz - cz) > this.radius) {
        this.loaded.delete(id);
      }
    }
    // Load: generate chunks newly inside the radius (generate-on-approach).
    for (let dz = -this.radius; dz <= this.radius; dz++) {
      for (let dx = -this.radius; dx <= this.radius; dx++) {
        const ccx = cx + dx;
        const ccz = cz + dz;
        const id = `${ccx},${ccz}`;
        if (!this.loaded.has(id)) {
          this.loaded.set(id, { cx: ccx, cz: ccz, props: chunkProps(this.seed, ccx, ccz, this.kinds) });
        }
      }
    }
    return true;
  }

  /** Number of loaded chunks (bounded by maxActiveChunks once warmed up). */
  get activeChunkCount(): number {
    return this.loaded.size;
  }

  /** Total active props across loaded chunks (bounded; for the perf/test funnel). */
  get activePropCount(): number {
    let n = 0;
    for (const c of this.loaded.values()) n += c.props.length;
    return n;
  }

  /** Visit every active prop (the renderer buckets these into per-kind instances). */
  forEachProp(fn: (p: ZenProp) => void): void {
    for (const c of this.loaded.values()) {
      for (const p of c.props) fn(p);
    }
  }
}
