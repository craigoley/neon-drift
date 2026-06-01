import { describe, expect, it } from 'vitest';
import { SettingsStore, DEFAULT_SETTINGS } from '../Settings';

/** In-memory Storage stand-in (vitest runs in Node — no real localStorage). */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

/** Storage whose every access throws — models Safari Private Mode / blocked. */
const throwingStorage = {
  getItem(): string | null {
    throw new Error('blocked');
  },
  setItem(): void {
    throw new Error('blocked');
  },
};

describe('SettingsStore — persistence', () => {
  it('persists a changed setting across reloads (same backing storage)', () => {
    const storage = memoryStorage();
    const a = new SettingsStore(storage);
    a.set('soundEnabled', false);
    a.set('selectedCarId', 'ember');

    const b = new SettingsStore(storage); // fresh instance, same storage
    expect(b.get('soundEnabled')).toBe(false);
    expect(b.get('selectedCarId')).toBe('ember');
  });

  it('writes JSON to the backing storage', () => {
    const storage = memoryStorage();
    const s = new SettingsStore(storage);
    s.set('soundEnabled', false);
    expect([...storage._map.values()][0]).toContain('"soundEnabled":false');
  });
});

describe('SettingsStore — default fallback', () => {
  it('uses defaults when storage is empty', () => {
    const s = new SettingsStore(memoryStorage());
    expect(s.all()).toEqual(DEFAULT_SETTINGS);
  });

  it('uses defaults when no storage is available (null)', () => {
    const s = new SettingsStore(null);
    expect(s.all()).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults on corrupt JSON', () => {
    const storage = memoryStorage();
    storage.setItem('neon-drift.settings', '{ not valid json');
    const s = new SettingsStore(storage);
    expect(s.all()).toEqual(DEFAULT_SETTINGS);
  });

  it('coerces a malformed blob field-by-field to defaults', () => {
    const storage = memoryStorage();
    storage.setItem('neon-drift.settings', JSON.stringify({ soundEnabled: 'yes', extra: 1 }));
    const s = new SettingsStore(storage);
    expect(s.get('soundEnabled')).toBe(DEFAULT_SETTINGS.soundEnabled); // 'yes' rejected
    expect(s.get('selectedCarId')).toBe(DEFAULT_SETTINGS.selectedCarId); // missing -> default
    expect(s.get('lowFx')).toBe(DEFAULT_SETTINGS.lowFx); // missing -> default (full FX)
  });

  it('persists the Retro FX (lowFx) setting across reloads', () => {
    const storage = memoryStorage();
    expect(DEFAULT_SETTINGS.lowFx).toBe(false); // full cinematic FX by default
    const a = new SettingsStore(storage);
    a.set('lowFx', true);
    const b = new SettingsStore(storage);
    expect(b.get('lowFx')).toBe(true);
  });
});

describe('SettingsStore — storage exceptions never throw', () => {
  it('construct + set + get do not throw when storage throws', () => {
    expect(() => {
      const s = new SettingsStore(throwingStorage);
      s.set('soundEnabled', false); // setItem throws internally — must be swallowed
      expect(s.get('soundEnabled')).toBe(false); // in-memory value still updates
      expect(s.get('selectedCarId')).toBe(DEFAULT_SETTINGS.selectedCarId);
    }).not.toThrow();
  });
});
