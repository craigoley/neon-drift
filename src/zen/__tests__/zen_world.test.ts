/**
 * Zen world streaming — the keystone of PR2 (the FEEL of "driving through a populated
 * world" is a phone playtest, but the streaming SYSTEM is unit-testable): chunk math
 * (incl. negatives), POSITION-DETERMINISTIC placement (same seed+chunk → same props,
 * path-independent), and radius load/cull keeping the active set BOUNDED (no leak).
 */
import { describe, expect, it } from 'vitest';
import {
  ZenChunkField,
  chunkKey,
  chunkProps,
  maxActiveChunks,
  worldToChunk,
  type ZenProp,
} from '../ZenWorld';
import { ZEN } from '../../utils/constants';

const SEED = ZEN.worldSeed;
const KINDS = 3;

describe('Zen world — chunk grid math', () => {
  it('maps world coords to chunk indices by floor division (handles negatives)', () => {
    const s = ZEN.chunkSize;
    expect(worldToChunk(0, s)).toBe(0);
    expect(worldToChunk(s - 0.01, s)).toBe(0);
    expect(worldToChunk(s, s)).toBe(1);
    expect(worldToChunk(-0.01, s)).toBe(-1);
    expect(worldToChunk(-s, s)).toBe(-1);
    expect(worldToChunk(-s - 0.01, s)).toBe(-2);
  });

  it('chunkKey is deterministic and locally distinct (no shared keys in a neighborhood)', () => {
    expect(chunkKey(3, -5)).toBe(chunkKey(3, -5)); // pure function of the coords
    // Every chunk in a local window around an arbitrary origin hashes distinctly, so
    // neighbours never share placement (global collisions far away are fine + expected).
    const keys = new Set<number>();
    for (let cx = -8; cx <= 8; cx++) {
      for (let cz = -8; cz <= 8; cz++) keys.add(chunkKey(100 + cx, -40 + cz));
    }
    expect(keys.size).toBe(17 * 17);
  });

  it('maxActiveChunks is the (2R+1)² square', () => {
    expect(maxActiveChunks(0)).toBe(1);
    expect(maxActiveChunks(4)).toBe(81);
  });
});

describe('Zen world — position-deterministic placement', () => {
  it('same seed + chunk → identical props (repeatable, path-independent)', () => {
    const a = chunkProps(SEED, 3, -5, KINDS);
    const b = chunkProps(SEED, 3, -5, KINDS);
    expect(b).toEqual(a);
  });

  it('different chunks produce different placements', () => {
    const a = JSON.stringify(chunkProps(SEED, 0, 0, KINDS));
    const b = JSON.stringify(chunkProps(SEED, 10, 10, KINDS));
    expect(a).not.toBe(b);
  });

  it('every prop lies WITHIN its chunk bounds, with a valid kind/scale', () => {
    const s = ZEN.chunkSize;
    for (const [cx, cz] of [[0, 0], [5, -3], [-7, 12]] as const) {
      for (const p of chunkProps(SEED, cx, cz, KINDS)) {
        expect(p.x).toBeGreaterThanOrEqual(cx * s);
        expect(p.x).toBeLessThan((cx + 1) * s);
        expect(p.z).toBeGreaterThanOrEqual(cz * s);
        expect(p.z).toBeLessThan((cz + 1) * s);
        expect(p.kind).toBeGreaterThanOrEqual(0);
        expect(p.kind).toBeLessThan(KINDS);
        expect(p.scale).toBeGreaterThanOrEqual(ZEN.propScaleMin);
        expect(p.scale).toBeLessThanOrEqual(ZEN.propScaleMax);
      }
    }
  });

  it('per-chunk count never exceeds propsPerChunk and varies (open space exists)', () => {
    const counts: number[] = [];
    for (let cx = 0; cx < 40; cx++) {
      for (let cz = 0; cz < 40; cz++) {
        counts.push(chunkProps(SEED, cx, cz, KINDS).length);
      }
    }
    expect(Math.max(...counts)).toBeLessThanOrEqual(ZEN.propsPerChunk);
    expect(Math.min(...counts)).toBe(0); // some chunks are empty → cruising room
    expect(Math.max(...counts)).toBeGreaterThan(0); // but the world is populated
  });
});

describe('Zen world — radius load/cull keeps the active set bounded', () => {
  it('warms up to the full (2R+1)² active set, all within the Chebyshev radius', () => {
    const field = new ZenChunkField(SEED, ZEN.chunkRadius, KINDS);
    const changed = field.update(0, 0);
    expect(changed).toBe(true);
    expect(field.activeChunkCount).toBe(maxActiveChunks(ZEN.chunkRadius));
  });

  it('staying in the same chunk does NOT re-stream (cheap common case)', () => {
    const field = new ZenChunkField(SEED, ZEN.chunkRadius, KINDS);
    expect(field.update(0, 0)).toBe(true);
    expect(field.update(1, 1)).toBe(false); // same chunk → no rebuild
  });

  it('roaming far keeps the active chunk + prop count CAPPED (no leak)', () => {
    const field = new ZenChunkField(SEED, ZEN.chunkRadius, KINDS);
    const cap = maxActiveChunks(ZEN.chunkRadius);
    const budget = cap * ZEN.propsPerChunk;
    // Drive a long diagonal across hundreds of chunks.
    for (let step = 0; step < 500; step++) {
      field.update(step * ZEN.chunkSize, step * ZEN.chunkSize * 0.5);
      expect(field.activeChunkCount).toBe(cap); // never grows past the square
      expect(field.activePropCount).toBeLessThanOrEqual(budget); // bounded prop budget
    }
  });

  it('all loaded props sit within the active window around the car', () => {
    const field = new ZenChunkField(SEED, ZEN.chunkRadius, KINDS);
    const carX = 1234;
    const carZ = -987;
    field.update(carX, carZ);
    const reach = (ZEN.chunkRadius + 1) * ZEN.chunkSize; // window half-extent + a chunk
    const seen: ZenProp[] = [];
    field.forEachProp((p) => seen.push(p));
    expect(seen.length).toBe(field.activePropCount);
    for (const p of seen) {
      expect(Math.abs(p.x - carX)).toBeLessThanOrEqual(reach);
      expect(Math.abs(p.z - carZ)).toBeLessThanOrEqual(reach);
    }
  });
});
