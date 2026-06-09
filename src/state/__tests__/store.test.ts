/**
 * PROG-1 PR2 — the STORE (spend credits). Buying decrements the balance and grants
 * the item (dual-unlock for cars via the SAME unlocked[]; cosmetics into owned[]);
 * can't overspend or double-buy; equip requires ownership; everything persists and
 * migrates from a PR1 (no-owned) blob.
 */
import { describe, expect, it } from 'vitest';
import { ProgressStore } from '../Progress';
import { COSMETICS, PROGRESS_STORAGE_KEY, STORE_CARS } from '../../utils/constants';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function memStorage(seed?: string): StorageLike & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  if (seed !== undefined) raw.set(PROGRESS_STORAGE_KEY, seed);
  return {
    raw,
    getItem: (k: string) => raw.get(k) ?? null,
    setItem: (k: string, v: string) => void raw.set(k, v),
  };
}

/** A fresh store with `credits` already in the wallet. */
function richStore(credits: number, storage = memStorage()): ProgressStore {
  const p = new ProgressStore(storage);
  p.addCredits(credits);
  return p;
}

const ONYX = STORE_CARS.find((c) => c.carId === 'onyx')!; // a stat-gated tier-2 car
const TRAIL = COSMETICS.find((c) => c.id === 'trail-magenta')!;

describe('Store — cosmetics are HORIZONTAL (zero gameplay fields)', () => {
  it('every cosmetic carries ONLY visual/price metadata — no stat/handling field', () => {
    const allowed = new Set(['id', 'name', 'slot', 'price', 'color']);
    for (const c of COSMETICS) {
      for (const key of Object.keys(c)) expect(allowed.has(key)).toBe(true);
    }
  });
});

describe('Store — buying a car (dual-unlock purchase path)', () => {
  it('decrements credits and unlocks the car (into the same unlocked[] the stat path fills)', () => {
    const p = richStore(2000);
    expect(p.isUnlocked('onyx')).toBe(false);
    expect(p.buyCar('onyx', ONYX.price)).toBe(true);
    expect(p.isUnlocked('onyx')).toBe(true); // now raceable everywhere
    expect(p.getCredits()).toBe(2000 - ONYX.price);
  });

  it('refuses when unaffordable (no charge, stays locked)', () => {
    const p = richStore(100);
    expect(p.buyCar('onyx', ONYX.price)).toBe(false);
    expect(p.isUnlocked('onyx')).toBe(false);
    expect(p.getCredits()).toBe(100); // untouched
  });

  it('refuses a double-buy (already unlocked → no second charge)', () => {
    const p = richStore(5000);
    expect(p.buyCar('onyx', ONYX.price)).toBe(true);
    const after = p.getCredits();
    expect(p.buyCar('onyx', ONYX.price)).toBe(false); // already owned
    expect(p.getCredits()).toBe(after); // not charged again
  });

  it('a starting-set car is already unlocked → buying is a no-op', () => {
    const p = richStore(5000);
    expect(p.isUnlocked('vapor')).toBe(true); // widened starting set (free)
    expect(p.buyCar('vapor', 600)).toBe(false);
    expect(p.getCredits()).toBe(5000);
  });
});

describe('Store — buying + equipping cosmetics (purely visual)', () => {
  it('buying adds to owned[] and decrements credits', () => {
    const p = richStore(1000);
    expect(p.isOwned(TRAIL.id)).toBe(false);
    expect(p.buyCosmetic(TRAIL.id, TRAIL.price)).toBe(true);
    expect(p.isOwned(TRAIL.id)).toBe(true);
    expect(p.getCredits()).toBe(1000 - TRAIL.price);
  });

  it('refuses unaffordable / double-buy', () => {
    const broke = richStore(10);
    expect(broke.buyCosmetic(TRAIL.id, TRAIL.price)).toBe(false);
    expect(broke.isOwned(TRAIL.id)).toBe(false);

    const p = richStore(1000);
    p.buyCosmetic(TRAIL.id, TRAIL.price);
    const after = p.getCredits();
    expect(p.buyCosmetic(TRAIL.id, TRAIL.price)).toBe(false);
    expect(p.getCredits()).toBe(after);
  });

  it('equip requires ownership; equipping persists; null unequips', () => {
    const p = richStore(1000);
    expect(p.equip('trail', TRAIL.id)).toBe(false); // not owned yet
    expect(p.getEquipped('trail')).toBeNull();

    p.buyCosmetic(TRAIL.id, TRAIL.price);
    expect(p.equip('trail', TRAIL.id)).toBe(true);
    expect(p.getEquipped('trail')).toBe(TRAIL.id);

    expect(p.equip('trail', null)).toBe(true); // unequip
    expect(p.getEquipped('trail')).toBeNull();
  });
});

describe('Store — persistence + PR1 migration', () => {
  it('purchases + equips survive a reload on the same storage', () => {
    const storage = memStorage();
    const a = richStore(3000, storage);
    a.buyCar('onyx', ONYX.price);
    a.buyCosmetic(TRAIL.id, TRAIL.price);
    a.equip('trail', TRAIL.id);
    const balance = a.getCredits();

    const b = new ProgressStore(storage); // "next session"
    expect(b.isUnlocked('onyx')).toBe(true);
    expect(b.isOwned(TRAIL.id)).toBe(true);
    expect(b.getEquipped('trail')).toBe(TRAIL.id);
    expect(b.getCredits()).toBe(balance);
  });

  it('a PR1 blob (no owned/equipped) loads with empty cosmetics + keeps credits', () => {
    // PR1-era blob: has credits + unlocked, but no `owned`/`equipped` keys.
    const storage = memStorage(JSON.stringify({ version: 1, stats: {}, unlocked: ['pulse'], credits: 500 }));
    const p = new ProgressStore(storage);
    expect(p.getCredits()).toBe(500);
    expect(p.ownedIds()).toEqual([]);
    expect(p.getEquipped('trail')).toBeNull();
    // ...and the store still works on the migrated blob.
    expect(p.buyCosmetic(TRAIL.id, TRAIL.price)).toBe(true);
    expect(p.isOwned(TRAIL.id)).toBe(true);
  });

  it('a wrong-typed owned/equipped blob is coerced safely', () => {
    const storage = memStorage(JSON.stringify({ stats: {}, unlocked: ['pulse'], credits: 100, owned: 'nope', equipped: 7 }));
    const p = new ProgressStore(storage);
    expect(p.ownedIds()).toEqual([]);
    expect(p.getEquipped('trail')).toBeNull();
    expect(p.getCredits()).toBe(100);
  });
});
