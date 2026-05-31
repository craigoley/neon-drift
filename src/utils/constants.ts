/**
 * ALL tuning values live here. No magic numbers anywhere else in the codebase.
 *
 * The pure game layer is axis-agnostic: it works in a forward `distance` scalar
 * (world units travelled) and a `lateral` scalar (left/right, 0 = centre). The
 * rendering layer maps those onto three.js axes (lateral -> x, and objects
 * ahead of the player onto -z). Speeds are world-units per second.
 */

/** Synthwave palette as 0xRRGGBB numbers for the three.js / rendering layer. */
export const PALETTE = {
  magenta: 0xff00ff,
  cyan: 0x00ffff,
  deepPurple: 0x1a0033,
  accent: 0xff6600,
} as const;

/** Same palette as CSS hex strings for the HTML HUD overlay. */
export const CSS_PALETTE = {
  magenta: '#ff00ff',
  /** Lighter magenta tint used for the top of the horizon-sun gradient. */
  magentaLight: '#ff66ff',
  cyan: '#00ffff',
  deepPurple: '#1a0033',
  accent: '#ff6600',
} as const;

/** Fixed simulation timestep, in seconds (the game updates at 60 Hz). */
export const TIMESTEP = 1 / 60;

/**
 * Maximum frame delta (seconds) fed to the loop. Caps catch-up after a
 * tab-switch / stall so the accumulator can't trigger a spiral of death.
 */
export const MAX_FRAME_DT = 0.25;

/** Road geometry + recycled-segment-pool tuning. */
export const ROAD = {
  /** Drivable half-width; lateral position is clamped to +/- this. */
  halfWidth: 9,
  /** Length of a single road segment in world units. */
  segmentLength: 40,
  /** Segments kept alive ahead of the player. */
  segmentsAhead: 12,
  /** Segments kept alive behind the player before recycling. */
  segmentsBehind: 2,
  /** Amplitude of the gentle deterministic curve, in world units. */
  curveAmplitude: 4,
  /** Spatial frequency of the curve noise (lower = longer sweeps). */
  curveFrequency: 0.08,
} as const;

/** Player vehicle physics. */
export const VEHICLE = {
  /** Forward speed at the very start of a run. */
  startSpeed: 45,
  /** Speed cap floor (cap at distance 0). */
  baseSpeedCap: 70,
  /** Speed cap ceiling reached asymptotically with distance. */
  maxSpeedCap: 240,
  /** Distance scale over which the cap ramps from base toward max. */
  speedCapRampDistance: 6000,
  /** Forward acceleration toward the current cap. */
  acceleration: 18,
  /** Lateral acceleration applied by full steer input. */
  lateralAccel: 90,
  /** Per-second retained fraction of lateral velocity under normal grip. */
  lateralFriction: 0.02,
  /** Per-second retained fraction while the handbrake is held (drift). */
  handbrakeFriction: 0.5,
  /** Vehicle collision box half-extents (lateral, forward). */
  halfWidth: 1.1,
  halfLength: 2.0,
} as const;

/** Traffic spawning + recycled-obstacle-pool tuning. */
export const TRAFFIC = {
  /** Maximum simultaneous obstacles (fixed pool size — never grows). */
  poolSize: 24,
  /** Distance ahead of the player at which obstacles spawn. */
  spawnAhead: 420,
  /** Distance behind the player at which obstacles are culled. */
  cullBehind: 30,
  /** Seconds between spawns at the start of a run. */
  baseSpawnInterval: 1.4,
  /** Lowest spawn interval as difficulty ramps. */
  minSpawnInterval: 0.35,
  /**
   * Difficulty ramp (spawn density). For the first `rampStartDistance` world
   * units the interval stays at `baseSpawnInterval` — a grace period (~the
   * first 15s at starting speed) to let the player learn. Past that, the
   * interval shrinks by `spawnRampPerUnit` per unit toward `minSpawnInterval`,
   * so traffic meaningfully escalates the further you get.
   */
  rampStartDistance: 850,
  /** How much the interval shrinks per world-unit travelled past the grace. */
  spawnRampPerUnit: 0.0001,
  /** Obstacle forward-speed range (slower than the player, so they're overtaken). */
  minSpeed: 25,
  maxSpeed: 60,
  /** Obstacle collision box half-extents (lateral, forward). */
  halfWidth: 1.1,
  halfLength: 2.2,
  /** Fraction of the road half-width obstacles may occupy. */
  lateralSpread: 0.85,
  /**
   * Lane-changing "movers": a fraction of obstacles sway laterally (sine) about
   * their spawn lane instead of holding a fixed line, so dodging requires
   * reading movement. Amplitude (world units) is randomised per mover; swayRate
   * is the phase advance (radians/second). Kept subtle so it reads as drifting
   * traffic, not teleporting.
   */
  moverFraction: 0.35,
  swayAmplitudeMin: 1.5,
  swayAmplitudeMax: 3.0,
  swayRate: 1.1,
} as const;

/** Scoring, combo, and near-miss / collision thresholds. */
export const SCORING = {
  /** Score per (world-unit * combo-multiplier). */
  distanceFactor: 1,
  /** Combo multiplier increment per near-miss. */
  comboStep: 0.5,
  /** Starting / minimum combo multiplier. */
  baseCombo: 1,
  /** Maximum combo multiplier. */
  maxCombo: 10,
  /** Seconds a combo survives without a fresh near-miss before resetting. */
  comboTimeout: 5,
  /**
   * Lateral gap (centre-to-centre) below which a pass counts as a near-miss.
   * Must exceed the summed collision half-widths (2.2) or nothing would ever
   * be a near-miss without also colliding. Tuned generously: traces showed the
   * 4.8 window only fired for players who threaded within ~2.6 units of clear
   * space — a cautious player giving obstacles a normal berth almost never
   * triggered one, so the combo sat at x1.0 the whole run despite the loop
   * working. 6.5 (~4.3 units of clear space) makes a normal close pass register,
   * so the multiplier visibly climbs in ordinary play while hugging the far wall
   * still earns nothing.
   */
  nearMissLateral: 6.5,
} as const;

/** Camera + chase-cam tuning (rendering layer). */
export const CAMERA = {
  fov: 70,
  /** Extra FOV degrees added at top speed for a sense of acceleration. */
  fovSpeedBoost: 9,
  near: 0.1,
  far: 2000,
  /**
   * Chase-cam offset behind/above the car. Raised and pulled back from the
   * original (4.5 up / 11 back) so the car drops to the lower quarter of the
   * screen and far more road ahead is visible — essential reaction time at
   * speed in a dodging game.
   */
  offsetBehind: 15,
  offsetUp: 8.5,
  /**
   * Look-at point ahead of the car. Pushed well forward (was 24) so the gaze
   * sits down the road, lifting the horizon and opening up the drivable area
   * ahead rather than framing the car itself.
   */
  lookAhead: 42,
  /** Height of the look-at point above the road (slightly up = more road ahead). */
  lookAtUp: 1.5,
  /** Smoothing factor (per-second) for camera follow. */
  followLerp: 6,
} as const;

/** Exponential fog — tuned so the segment spawn horizon hides behind fog. */
export const FOG = {
  /** Exponential fog density. */
  density: 0.0042,
} as const;

/** Synthwave grid ground plane. */
export const GRID = {
  size: 4000,
  // Fewer divisions = wider line spacing, so the lines don't stack into a dense
  // bright band where they converge at the horizon (was 160).
  divisions: 120,
  /** Y offset below the road surface. */
  y: -0.05,
  /** Opacity of the grid lines. Lowered (was 0.55) so the grid reads as a depth
   *  cue that fades back into the fog rather than competing at the horizon. */
  opacity: 0.4,
} as const;

/** Road visual tuning (rendering only — geometry is reused per pool slot). */
export const ROAD_VIS = {
  /** Half-width of the glowing edge strip. */
  edgeHalfWidth: 0.18,
  /** Height of edge/stripe geometry above the ground. */
  edgeHeight: 0.06,
  /** Centre lane stripes per segment. */
  stripesPerSegment: 2,
  /** Stripe length (world units) along the segment. */
  stripeLength: 6,
  /** Stripe half-width. */
  stripeHalfWidth: 0.12,
} as const;

/** Player car visual tuning. */
export const CAR_VIS = {
  // The rendered car IS its collision box: width/length are derived from the
  // VEHICLE half-extents so the neon wireframe the player sees is exactly what
  // collides. Previously the mesh (1.7 wide) was narrower than the hitbox (2.2),
  // causing deaths with a visible gap and obstacles clipping the body at impact.
  width: VEHICLE.halfWidth * 2,
  height: 0.7,
  length: VEHICLE.halfLength * 2,
  /** Roll (radians) at full lateral velocity, for steering feel. */
  maxRoll: 0.25,
  /** Lateral velocity that maps to maxRoll. */
  rollReference: 30,
  /** Headlight cone length + offset. */
  headlightLength: 8,
  headlightInset: 0.6,
  /** Headlight cone radius, additive-glow intensity and radial segment count.
   *  Opacity is low because the beam uses additive blending (reads as light). */
  headlightConeRadius: 0.5,
  headlightOpacity: 0.18,
  headlightConeSegments: 8,
  /** Render order for the additive headlight glow — drawn after opaque geometry
   *  (sits alongside ENV.sunRenderOrder / mountainRenderOrder in the stack). */
  headlightRenderOrder: 1,
} as const;

/** Traffic obstacle visual tuning (rendering only). */
export const TRAFFIC_VIS = {
  /** Obstacle mesh height and its y-centre above the ground. */
  meshHeight: 1.2,
  meshY: 0.6,
} as const;

/** Horizon sun + wireframe mountains (procedural, fog-excluded). */
export const ENV = {
  /** Distance ahead of the camera the horizon backdrop sits. */
  distance: 900,
  sunRadius: 220,
  sunY: 120,
  /** Horizontal band count carved out of the sun disc. */
  sunBands: 9,
  mountainCount: 28,
  mountainSpread: 1400,
  // Lowered (was 140) so the ridge sits below the sun's banded core instead of
  // spiking up through it.
  mountainMaxHeight: 110,
  mountainBaseY: 0,
  /** Opacity of the waveform-mountain line — faint so it doesn't fight the sun. */
  mountainOpacity: 0.5,
  /** Fraction of `distance` the mountains sit behind the backdrop origin (the
   *  sun), so the silhouette reads clearly behind the sun's framing. */
  mountainDepthFactor: 0.4,
  /**
   * Backdrop render order. Sun + mountains are drawn as a guaranteed-background
   * layer (depthTest/Write off) BEFORE all gameplay geometry, so they can never
   * paint over the car or traffic. Mountains sit behind the sun (drawn first).
   */
  sunRenderOrder: -1,
  mountainRenderOrder: -2,
} as const;

/** Bloom / post-processing (see Step 1 findings: RenderPass -> Bloom -> OutputPass). */
export const BLOOM = {
  // Tamed from the original (strength 0.9 / threshold 0.2 / exposure 1.1) which
  // blew the sun out toward white and washed out the HUD. Lower strength + a
  // higher luminance threshold mean only the brightest neon cores bloom; the
  // synthwave glow stays but the sun no longer clips to white.
  strength: 0.6,
  radius: 0.5,
  threshold: 0.45,
  /** Tone-mapping exposure applied by the renderer (OutputPass reads this). */
  exposure: 1.0,
  /** Bloom internal-resolution divisor on touch devices (GPU headroom). */
  mobileResolutionScale: 0.5,
} as const;

/** Renderer device tuning. */
export const RENDER = {
  /** Pixel-ratio cap on desktop. */
  maxPixelRatio: 2,
  /** Pixel-ratio cap on touch devices. */
  maxPixelRatioTouch: 1.5,
} as const;

/** Game-feel / juice tuning. */
export const JUICE = {
  /** Speed-line streak count. */
  speedLineCount: 80,
  /** Normalised speed (0..1) above which speed lines appear. */
  speedLineThreshold: 0.45,
  /** Length of each speed-line streak (world units). */
  speedLineLength: 6,
  /** Radius of the streak field around the camera. */
  speedLineFieldRadius: 26,
  /** Depth of the streak field ahead of the camera. */
  speedLineFieldDepth: 120,
  /** Base streak travel speed toward the camera. */
  speedLineForwardSpeed: 240,
  /** Vertical centre offset of the streak field. */
  speedLineHeightOffset: 4,
  /** Z past the camera at which a streak respawns. */
  speedLinePastMargin: 4,
  /** Per-second rate at which speed-line opacity eases toward its target. */
  speedLineOpacityRate: 6,
  /** Base fraction of forward speed applied to streaks at zero normalised speed. */
  speedLineBaseSpeedScale: 0.5,
  /** Crash screen-shake magnitude (world units) and decay (per second). */
  shakeMagnitude: 1.4,
  shakeDecay: 4,
  /** Crash freeze-frame duration in seconds. */
  freezeFrame: 0.12,
  /** Crash white-flash duration as a multiple of the freeze frame. */
  crashFlashMultiplier: 2,
  /** Neon-shard burst count on crash and the burst's vertical (y) origin. */
  shardCount: 36,
  shardBurstY: 1,
  /** Shard initial speed, lifetime (s), gravity, per-second drag and point size. */
  shardSpeed: 26,
  shardLifetime: 0.9,
  shardGravity: 18,
  shardDrag: 0.6,
  shardSize: 0.5,
  /** Near-miss screen-edge glow pulse duration in seconds. */
  nearMissPulse: 0.35,
  /** Optional near-miss micro slow-mo: duration (s) and simulation time scale. */
  nearMissSlowmo: 0.12,
  slowmoScale: 0.45,
  /**
   * Minimum fraction of the full magnitude for randomised spreads (shard speed,
   * speed-line radius): value = spreadMinFraction + (1 - spreadMinFraction)*rand.
   * Shared so both particle systems stay visually consistent.
   */
  spreadMinFraction: 0.4,
} as const;

/** Synthesized audio tuning (Web Audio API — no files). */
export const AUDIO = {
  masterGain: 0.5,
  /** Ramp time (s) for muting/unmuting the master bus on the sound toggle. */
  muteRamp: 0.05,
  /** Noise-buffer duration in seconds (how long before the pattern repeats). */
  noiseBufferSeconds: 2,
  /** Engine oscillator pitch range mapped from normalised speed. */
  engineBaseHz: 60,
  engineTopHz: 220,
  engineGain: 0.06,
  /** Engine lowpass cutoff (Hz), detune ratio between the two oscillators, and
   *  the pitch-glide time constant (s) for setTargetAtTime. */
  engineLowpassHz: 800,
  engineDetune: 1.01,
  enginePitchGlide: 0.08,
  /** Tyre-screech filtered-noise gain on handbrake, bandpass centre (Hz), Q,
   *  gain ramp time constant (s), and the min speed at which it's audible. */
  screechGain: 0.05,
  screechBandHz: 2200,
  screechQ: 2,
  screechMinSpeed: 1,
  screechRamp: 0.05,
  /** Near-miss whoosh + combo-tick blip. */
  whooshHz: 520,
  whooshGain: 0.08,
  /** Whoosh envelope: attack (s), tail/decay (s), stop (s), and the upward
   *  frequency-sweep multiplier. */
  whooshAttack: 0.04,
  whooshDecay: 0.3,
  whooshStop: 0.32,
  whooshSweep: 2.5,
  comboBlipHz: 880,
  /** Combo blip: gain, decay (s) and stop (s). */
  comboBlipGain: 0.12,
  comboBlipDecay: 0.12,
  comboBlipStop: 0.14,
  /** Crash hit: noise burst + low sine thump. */
  crashNoiseGain: 0.25,
  /** Crash noise envelope: decay (s) and stop (s). */
  crashNoiseDecay: 0.4,
  crashNoiseStop: 0.42,
  crashThumpHz: 55,
  /** Crash thump: start-pitch multiplier, gain, pitch glide (s), gain decay (s)
   *  and stop (s). */
  crashThumpStartMul: 2,
  crashThumpGain: 0.6,
  crashThumpGlide: 0.5,
  crashThumpDecay: 0.6,
  crashThumpStop: 0.62,
} as const;

/** Front-end shell / overlay UI tuning. */
export const UI = {
  /** How long the "link copied" toast stays visible (ms). */
  toastDurationMs: 1800,
  /** Horizontal swipe distance (px) to cycle cars in the picker. */
  carSwipeThresholdPx: 40,
} as const;

/** Touch-control tuning. */
export const TOUCH = {
  /** Horizontal drag (px) from the touch origin that maps to full steer lock. */
  maxDragPx: 140,
  /** Drag deadzone (px) before steering registers. */
  deadzonePx: 8,
} as const;

/** localStorage key for the persisted best run. */
export const STORAGE_KEY = 'neon-drift.best';

/** localStorage key for player settings (sound, selected car, future toggles). */
export const SETTINGS_STORAGE_KEY = 'neon-drift.settings';

/** Default RNG seed when none is supplied (keeps runs reproducible in tests). */
export const DEFAULT_SEED = 0x9e3779b9;

/**
 * Cosmetic-only car definitions. COSMETIC for now — `body`/`glow`/`accent` are
 * 0xRRGGBB colors the VehicleRenderer applies. The type carries an OPTIONAL
 * `handling` block so a follow-up PR can add speed/grip/drift stats per car
 * WITHOUT touching the picker UI or the selection plumbing (both read only
 * id/displayName/cosmetic). All cars handle identically until that lands.
 */
export interface CarHandling {
  /** Multipliers on the shared VEHICLE tuning; added in a follow-up PR. */
  speed: number;
  grip: number;
  drift: number;
}

export interface CarCosmetic {
  /** Dark body color (kept deep so the emissive edges read as neon). */
  body: number;
  /** Edge / wireframe glow color — the car's signature. */
  glow: number;
  /** Headlight / accent color. */
  accent: number;
}

export interface CarDef {
  id: string;
  displayName: string;
  cosmetic: CarCosmetic;
  /** Optional — absent this PR; all cars share VEHICLE physics for now. */
  handling?: CarHandling;
}

export const CARS: readonly CarDef[] = [
  {
    id: 'pulse',
    displayName: 'Pulse',
    cosmetic: { body: 0x1a0033, glow: 0x00ffff, accent: 0xff00ff },
  },
  {
    id: 'vapor',
    displayName: 'Vapor',
    cosmetic: { body: 0x1a0033, glow: 0xff00ff, accent: 0x00ffff },
  },
  {
    id: 'ember',
    displayName: 'Ember',
    cosmetic: { body: 0x1a0033, glow: 0xff6600, accent: 0xff00ff },
  },
  {
    id: 'ghost',
    displayName: 'Ghost',
    cosmetic: { body: 0x1a0033, glow: 0xffffff, accent: 0x00ffff },
  },
] as const;

/** Default selected car — the first in the list. */
export const DEFAULT_CAR_ID = CARS[0].id;

/** Resolve a car by id, falling back to the default if the id is unknown. */
export function carById(id: string): CarDef {
  return CARS.find((c) => c.id === id) ?? CARS[0];
}

/** CSS hex string for a 0xRRGGBB color (for HTML/CSS previews of car colors). */
export function cssHex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}
