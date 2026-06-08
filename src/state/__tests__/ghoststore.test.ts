/**
 * GhostStore — per-mode storage of the best rival-ghost recording (win metric =
 * score), with the resilient localStorage + in-memory-fallback idiom shared by the
 * other stores.
 */
import { describe, expect, it } from 'vitest';
import { GhostStore } from '../GhostStore';
import { GameMode } from '../../game/GameState';
import type { GhostRecording } from '../../game/Replay';
import { GHOST_STORAGE_KEY, SIM_MATH_VERSION } from '../../utils/constants';

/** Minimal in-memory StorageLike (mirrors the leaderboard tests). */
function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    _map: m,
  };
}

function rec(over: Partial<GhostRecording> = {}): GhostRecording {
  return {
    v: 1, mathVersion: SIM_MATH_VERSION, seed: 123, mode: GameMode.Classic, carId: 'pulse',
    steers: [0, 0.1, -0.2], deployFrames: [1], score: 1000, distance: 500, date: 0,
    ...over,
  };
}

describe('GhostStore — submit / get by mode', () => {
  it('stores a ghost and returns it for its mode only', () => {
    const gs = new GhostStore(memStorage());
    expect(gs.get(GameMode.Classic)).toBeNull();
    expect(gs.submit(rec())).toBe(true);
    expect(gs.get(GameMode.Classic)?.score).toBe(1000);
    expect(gs.get(GameMode.DailySlalom)).toBeNull(); // independent slot
  });

  it('replaces only when the new run out-scores the stored ghost', () => {
    const gs = new GhostStore(memStorage());
    gs.submit(rec({ score: 1000 }));
    expect(gs.submit(rec({ score: 900 })), 'lower score rejected').toBe(false);
    expect(gs.submit(rec({ score: 1000 })), 'equal score rejected').toBe(false);
    expect(gs.get(GameMode.Classic)?.score).toBe(1000);
    expect(gs.submit(rec({ score: 1500 })), 'higher score wins').toBe(true);
    expect(gs.get(GameMode.Classic)?.score).toBe(1500);
  });

  it('classic and daily ghosts are independent', () => {
    const gs = new GhostStore(memStorage());
    gs.submit(rec({ mode: GameMode.Classic, score: 100 }));
    gs.submit(rec({ mode: GameMode.DailySlalom, score: 200 }));
    expect(gs.get(GameMode.Classic)?.score).toBe(100);
    expect(gs.get(GameMode.DailySlalom)?.score).toBe(200);
  });

  it('persists across instances sharing storage', () => {
    const store = memStorage();
    new GhostStore(store).submit(rec({ score: 777 }));
    expect(new GhostStore(store).get(GameMode.Classic)?.score).toBe(777);
  });
});

describe('GhostStore — resilient load', () => {
  it('rejects malformed JSON (falls back to empty, no throw)', () => {
    const store = memStorage();
    store._map.set(GHOST_STORAGE_KEY, '{not json');
    const gs = new GhostStore(store);
    expect(gs.get(GameMode.Classic)).toBeNull();
  });

  it('rejects an old/invalid schema (wrong version, bad fields)', () => {
    const store = memStorage();
    store._map.set(GHOST_STORAGE_KEY, JSON.stringify({ classic: { v: 2, seed: 1, steers: [] } }));
    expect(new GhostStore(store).get(GameMode.Classic)).toBeNull();

    store._map.set(GHOST_STORAGE_KEY, JSON.stringify({ classic: { v: 1, seed: 'x', steers: 'nope' } }));
    expect(new GhostStore(store).get(GameMode.Classic)).toBeNull();
  });

  it('rejects a recording with a non-finite steer', () => {
    const gs = new GhostStore(memStorage());
    expect(gs.submit(rec({ steers: [0, NaN, 1] }))).toBe(false);
    expect(gs.get(GameMode.Classic)).toBeNull();
  });

  it('rejects a ghost from a DIFFERENT sim-math version (would desync on replay)', () => {
    const store = memStorage();
    // A stored ghost from the old math (mathVersion absent) or a future version must
    // not be raced — it would diverge from its own recorded path against the live sim.
    store._map.set(GHOST_STORAGE_KEY, JSON.stringify({ classic: { ...rec(), mathVersion: SIM_MATH_VERSION - 1 } }));
    expect(new GhostStore(store).get(GameMode.Classic)).toBeNull();
    store._map.set(GHOST_STORAGE_KEY, JSON.stringify({ classic: { ...rec(), mathVersion: undefined } }));
    expect(new GhostStore(store).get(GameMode.Classic)).toBeNull();
    // The CURRENT version loads fine.
    store._map.set(GHOST_STORAGE_KEY, JSON.stringify({ classic: rec() }));
    expect(new GhostStore(store).get(GameMode.Classic)).not.toBeNull();
  });

  it('works in-memory when storage is unavailable (null)', () => {
    const gs = new GhostStore(null);
    expect(gs.submit(rec({ score: 50 }))).toBe(true);
    expect(gs.get(GameMode.Classic)?.score).toBe(50); // in-memory within the instance
  });
});
