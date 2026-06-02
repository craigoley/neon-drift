import { describe, expect, it } from 'vitest';
import { MissionStore } from '../MissionStore';
import { MISSIONS_STORAGE_KEY, MISSION_ACTIVE_COUNT } from '../../utils/constants';
import { createGameState, Phase, startRun, update } from '../../game/GameState';
import { createIntent } from '../../game/Input';
import { TIMESTEP } from '../../utils/constants';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function memStorage(seed?: string): StorageLike & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  if (seed !== undefined) raw.set(MISSIONS_STORAGE_KEY, seed);
  return {
    raw,
    getItem: (k: string) => raw.get(k) ?? null,
    setItem: (k: string, v: string) => void raw.set(k, v),
  };
}

const RUN = {
  nearMisses: 25,
  powerups: 15,
  shields: 5,
  slowMosDeployed: 0,
  distance: 1000,
  score: 0,
  reachedMidnight: false,
};

describe('MissionStore — fresh + commit', () => {
  it('a fresh store is Rookie with 3 missions', () => {
    const m = new MissionStore(memStorage());
    expect(m.state().rank).toBe(0);
    expect(m.state().active).toHaveLength(MISSION_ACTIVE_COUNT);
  });

  it('commitRun folds a run in and returns completions (the crash-commit path)', () => {
    const m = new MissionStore(memStorage());
    const res = m.commitRun(RUN);
    expect(res.completedMissions).toHaveLength(3);
    expect(res.rankUps).toEqual(['Cruiser']);
    expect(m.state().completed).toBe(3);
  });
});

describe('MissionStore — persistence round-trips across sessions', () => {
  it('progress saved in one store is present in a fresh store on the same storage', () => {
    const storage = memStorage();
    const a = new MissionStore(storage);
    a.commitRun(RUN);
    expect(a.state().rank).toBe(1);

    const b = new MissionStore(storage); // "next session"
    expect(b.state().rank).toBe(1);
    expect(b.state().completed).toBe(3);
    expect(b.state().stats.shields).toBe(5);
  });
});

describe('MissionStore — corruption + storage failure never crash', () => {
  it('a corrupt blob falls back to a fresh Rookie progression', () => {
    const m = new MissionStore(memStorage('}{ not json'));
    expect(m.state().rank).toBe(0);
    expect(m.state().active).toHaveLength(MISSION_ACTIVE_COUNT);
  });

  it('a wrong-sized active list falls back to fresh', () => {
    const m = new MissionStore(memStorage(JSON.stringify({ active: [{ defId: 'nm25' }] })));
    expect(m.state().active).toHaveLength(MISSION_ACTIVE_COUNT);
    expect(m.state().active.map((x) => x.defId)).toEqual(['nm25', 'pu15', 'sh5']);
  });

  it('null + throwing storage never throw', () => {
    expect(() => new MissionStore(null).commitRun(RUN)).not.toThrow();
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    let m!: MissionStore;
    expect(() => (m = new MissionStore(throwing))).not.toThrow();
    expect(() => m.commitRun(RUN)).not.toThrow();
    expect(m.state().rank).toBe(1); // still reflected in memory
  });
});

describe('MissionStore — start-biome is cosmetic-gated, blocked when locked', () => {
  it('cannot select a locked starting biome; can once the rank is earned', () => {
    const m = new MissionStore(memStorage());
    expect(m.startBiomeUnlocked(1)).toBe(false);
    m.setStartBiome(1); // Midnight — locked at Rookie
    expect(m.startBiome()).toBe(0); // blocked, stays default

    m.commitRun(RUN); // → Cruiser unlocks Midnight start
    expect(m.startBiomeUnlocked(1)).toBe(true);
    m.setStartBiome(1);
    expect(m.startBiome()).toBe(1);
  });

  it('a persisted start-biome that is no longer unlocked resets to default on load', () => {
    // completed 0 (Rookie) but startBiome 2 persisted → must reset to 0.
    const storage = memStorage(
      JSON.stringify({
        stats: {},
        active: [{ defId: 'nm25', baseline: 0, best: 0 }, { defId: 'pu15', baseline: 0, best: 0 }, { defId: 'sh5', baseline: 0, best: 0 }],
        completed: 0,
        poolCursor: 3,
        startBiome: 2,
      }),
    );
    expect(new MissionStore(storage).startBiome()).toBe(0);
  });
});

describe('Missions NEVER gate gameplay — the core run is always startable', () => {
  it('a fresh Rookie and a maxed-rank player both start + advance a run identically', () => {
    // The pure game has zero knowledge of missions/rank; startRun ignores them.
    const rookie = new MissionStore(memStorage());
    expect(rookie.state().rank).toBe(0);

    const maxed = new MissionStore(memStorage());
    for (let i = 0; i < 6; i++) maxed.commitRun({ ...RUN, score: 6000, slowMosDeployed: 100, reachedMidnight: true });
    expect(maxed.state().rank).toBeGreaterThan(0);

    const intent = createIntent();
    for (const store of [rookie, maxed]) {
      const game = startRun(createGameState(7), undefined, store.startBiome());
      expect(game.phase).toBe(Phase.Playing); // startable at ANY rank
      update(game, intent, TIMESTEP);
      expect(game.distance).toBeGreaterThan(0); // and it advances
    }
  });
});
