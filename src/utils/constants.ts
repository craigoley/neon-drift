/**
 * ALL tuning values live here. No magic numbers anywhere else in the codebase.
 *
 * Colors are exposed twice: as 0xRRGGBB numbers for three.js material/light use
 * (the rendering layer) and as CSS hex strings for the HTML HUD overlay.
 */

/** Synthwave palette — single source of truth for every color in the game. */
export const PALETTE = {
  magenta: 0xff00ff,
  cyan: 0x00ffff,
  deepPurple: 0x1a0033,
  accent: 0xff6600,
} as const;

/** Same palette as CSS hex strings for the HTML/HUD layer. */
export const CSS_PALETTE = {
  magenta: '#ff00ff',
  cyan: '#00ffff',
  deepPurple: '#1a0033',
  accent: '#ff6600',
} as const;

/** Camera configuration for the perspective view. */
export const CAMERA = {
  fov: 70,
  near: 0.1,
  far: 1000,
  /** Eye position behind/above the player vehicle. */
  position: { x: 0, y: 4, z: 10 },
  /** Look-at target ahead of the player. */
  lookAt: { x: 0, y: 0, z: -20 },
} as const;

/** Road geometry and generation tuning (pure-math layer in game/Road.ts). */
export const ROAD = {
  /** Width of the drivable surface in world units. */
  width: 12,
  /** Number of lanes the traffic/player snap to. */
  laneCount: 3,
  /** Length of a single road segment in world units. */
  segmentLength: 20,
  /** How many segments are kept "alive" ahead of the player. */
  visibleSegments: 30,
} as const;

/** Player vehicle physics (pure, in game/Vehicle.ts). All units are world-units / second. */
export const VEHICLE = {
  /** Forward speed the player starts at. */
  baseSpeed: 40,
  /** Maximum forward speed reachable through acceleration. */
  maxSpeed: 120,
  /** Forward acceleration applied while running. */
  acceleration: 6,
  /** Sideways (lateral) movement speed when steering. */
  lateralSpeed: 16,
  /** Half the road width minus the vehicle half-width — clamps lateral position. */
  lateralBound: 5,
} as const;

/** Traffic / obstacle generation tuning (pure, in game/Traffic.ts). */
export const TRAFFIC = {
  /** Seconds between obstacle spawns at base difficulty. */
  spawnInterval: 1.5,
  /** Lowest spawn interval as difficulty ramps. */
  minSpawnInterval: 0.5,
  /** How aggressively spawn interval shrinks per second of play. */
  difficultyRamp: 0.01,
} as const;

/** Scoring tuning (pure, in game/Scoring.ts). */
export const SCORING = {
  /** Score awarded per world-unit travelled. */
  distanceFactor: 0.1,
  /** Multiplier increment per obstacle cleanly passed. */
  multiplierStep: 0.1,
  /** Highest multiplier reachable. */
  maxMultiplier: 8,
} as const;

/** Fixed timestep for the deterministic game update, in seconds. */
export const TIMESTEP = 1 / 60;
