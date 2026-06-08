/**
 * Player settings, persisted to localStorage. Plain TS — NO three import — so it
 * stays usable from any layer.
 *
 * Resilience: every storage access is wrapped. Safari Private Mode can throw on
 * `localStorage.setItem` (and some sandboxes throw even reading the global), so
 * a storage failure must NEVER crash the game — it falls back to in-memory
 * defaults that persist for the session. Storage is injectable so the store is
 * unit-testable in Node (where `localStorage` doesn't exist).
 *
 * Extensibility: settings are a single object merged over DEFAULT_SETTINGS on
 * load, so a new key (e.g. `difficulty`, `reducedMotion`) is added by extending
 * the interface + defaults — existing stored blobs gain the new default for
 * free, no migration.
 */

import { DEFAULT_CAR_ID, SETTINGS_STORAGE_KEY } from '../utils/constants';

export interface Settings {
  soundEnabled: boolean;
  selectedCarId: string;
  /** "Retro FX" = the graphics-quality HIGH/LOW lever. OFF (LOW) skips the WHOLE post
   *  pipeline — bloom glow AND the cinematic pass (aberration / scanlines / grain /
   *  vignette) — and renders direct: a genuinely cheap frame for weaker GPUs (bloom is
   *  the main GPU cost). ON (HIGH) = the full neon glow. Default ON (lowFx false). */
  lowFx: boolean;
  /** "Rival Ghost" on → race a translucent replay of your best run for the mode.
   *  Off by default so the seed/course behaviour is unchanged until opted in. */
  ghostRace: boolean;
  // Future (not built this PR): difficulty?: 'chill' | 'normal' | 'intense';
}

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  selectedCarId: DEFAULT_CAR_ID,
  lowFx: false,
  ghostRace: false,
};

/** The slice of the Storage API this module needs. */
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Resolve a usable Storage, or null if none/blocked. Reading the `localStorage`
 * global can itself throw (disabled storage), so the access is guarded.
 */
function resolveStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export class SettingsStore {
  private values: Settings;
  private readonly storage: StorageLike | null;

  /** `storage` is injectable for tests; defaults to localStorage when present. */
  constructor(storage: StorageLike | null = resolveStorage()) {
    this.storage = storage;
    this.values = this.load();
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.values[key];
  }

  /** Update one setting and persist. A storage failure is swallowed. */
  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.values[key] = value;
    this.persist();
  }

  /** Read-only snapshot of all settings. */
  all(): Readonly<Settings> {
    return this.values;
  }

  private load(): Settings {
    if (!this.storage) return { ...DEFAULT_SETTINGS };
    try {
      const raw = this.storage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw) as Partial<Settings>;
      // Merge over defaults + coerce types so a malformed/old blob can't poison
      // the running config; unknown keys are ignored, missing keys defaulted.
      return {
        soundEnabled:
          typeof parsed.soundEnabled === 'boolean'
            ? parsed.soundEnabled
            : DEFAULT_SETTINGS.soundEnabled,
        selectedCarId:
          typeof parsed.selectedCarId === 'string'
            ? parsed.selectedCarId
            : DEFAULT_SETTINGS.selectedCarId,
        lowFx: typeof parsed.lowFx === 'boolean' ? parsed.lowFx : DEFAULT_SETTINGS.lowFx,
        ghostRace:
          typeof parsed.ghostRace === 'boolean' ? parsed.ghostRace : DEFAULT_SETTINGS.ghostRace,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      // Private mode / quota / blocked storage — keep the in-memory value only.
    }
  }
}
