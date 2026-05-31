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
  /**
   * Hard ceiling on the per-car-scaled retained fraction. decay() needs a value
   * in [0, 1); a retained fraction of 1+ would mean lateral velocity never bleeds
   * (or grows), so an extreme drift multiplier can't make the car uncontrollable
   * or produce NaN/Infinity. Below 1 with margin.
   */
  maxRetainedFriction: 0.95,
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

/**
 * Collectible powerups. The four pickup kinds (erasable const-object, not a TS
 * enum — same style as Phase). Each has a config entry in `POWERUP_DEFS` below.
 */
export const PowerupKind = {
  Shield: 'shield',
  SlowMo: 'slowmo',
  ScoreBoost: 'scoreBoost',
  Magnet: 'magnet',
} as const;
export type PowerupKind = (typeof PowerupKind)[keyof typeof PowerupKind];

/** Renderer shape token for a pickup (maps to a geometry in PowerupRenderer). */
export type PowerupShape = 'ring' | 'diamond' | 'chevron' | 'horseshoe';

/**
 * Signature pickup colours. CLAUDE.md's named palette carries only two neons
 * (magenta + cyan); to keep four pickups instantly distinguishable we add two
 * more BRIGHT NEON hues here. All four read as GOOD — and the orange accent
 * (#ff6600) stays reserved for THREATS, never used on a pickup.
 */
export const POWERUP_COLORS = {
  shield: PALETTE.cyan, // 0x00ffff — cool/defensive
  slowmo: 0xb46bff, // neon purple — "time" feel, distinct from the deep-purple bg
  scoreBoost: PALETTE.magenta, // 0xff00ff — reward
  magnet: 0x39ff14, // neon green — clearly not a threat
} as const;

export interface PowerupDef {
  id: PowerupKind;
  displayName: string;
  /** Neon pickup colour (0xRRGGBB) — never the orange threat hue. */
  color: number;
  /** Renderer geometry token. */
  shape: PowerupShape;
  /** Single-character HUD glyph. */
  glyph: string;
  /** Active duration in seconds. 0 = a one-shot held CHARGE (SHIELD). */
  duration: number;
  /** Relative spawn weight (SHIELD is rarest → smallest weight). */
  spawnWeight: number;
  /** SCORE-BOOST: multiplier applied to score GAIN while active (1 otherwise). */
  scoreMultiplier: number;
  /** SLOW-MO: simulation time scale while active (1 otherwise). */
  timeScale: number;
}

/** Per-kind powerup configuration (the single source of truth for behaviour). */
export const POWERUP_DEFS: Readonly<Record<PowerupKind, PowerupDef>> = {
  shield: {
    id: PowerupKind.Shield,
    displayName: 'Shield',
    color: POWERUP_COLORS.shield,
    shape: 'ring',
    glyph: '⛨',
    duration: 0, // one-shot charge: held until a crash consumes it
    spawnWeight: 1, // rarest / most valuable
    scoreMultiplier: 1,
    timeScale: 1,
  },
  slowmo: {
    id: PowerupKind.SlowMo,
    displayName: 'Slow-Mo',
    color: POWERUP_COLORS.slowmo,
    shape: 'diamond',
    glyph: '◇',
    duration: 3.5,
    spawnWeight: 2,
    scoreMultiplier: 1,
    timeScale: 0.5, // half-speed sim to thread tight gaps
  },
  scoreBoost: {
    id: PowerupKind.ScoreBoost,
    displayName: 'Score x2',
    color: POWERUP_COLORS.scoreBoost,
    shape: 'chevron',
    glyph: '×2',
    duration: 8.0,
    spawnWeight: 3,
    scoreMultiplier: 2, // stacks MULTIPLICATIVELY on top of the combo
    timeScale: 1,
  },
  magnet: {
    id: PowerupKind.Magnet,
    displayName: 'Magnet',
    color: POWERUP_COLORS.magnet,
    shape: 'horseshoe',
    glyph: '∪',
    duration: 6.0,
    spawnWeight: 3,
    scoreMultiplier: 1,
    timeScale: 1,
  },
} as const;

/** Stable kind ordering (HUD chip order + weighted-pick iteration). */
export const POWERUP_ORDER: readonly PowerupKind[] = [
  PowerupKind.Shield,
  PowerupKind.SlowMo,
  PowerupKind.ScoreBoost,
  PowerupKind.Magnet,
] as const;

/** Powerup spawning + recycled-pickup-pool tuning (mirrors TRAFFIC's pattern). */
export const POWERUPS = {
  /** Maximum simultaneous pickups (fixed pool size — never grows). */
  poolSize: 8,
  /** Distance ahead of the player at which pickups spawn. */
  spawnAhead: 420,
  /** Distance behind the player at which uncollected pickups are culled. */
  cullBehind: 30,
  /** Seconds between spawns at the start of a run (much rarer than traffic). */
  baseSpawnInterval: 5.5,
  /** Lowest spawn interval as difficulty ramps. */
  minSpawnInterval: 3.0,
  /** Grace distance before the cadence tightens (shared feel with traffic). */
  rampStartDistance: 850,
  /** How much the interval shrinks per world-unit travelled past the grace. */
  spawnRampPerUnit: 0.0002,
  /** Fraction of the road half-width a pickup may sit from centre. */
  lateralSpread: 0.8,
  /** Pickup collection box half-extents — generous so pickups are inviting. */
  halfWidth: 1.6,
  halfLength: 1.8,
  /** SHIELD: invulnerability window (s) after a shield absorbs a crash, so the
   *  car can clear the very obstacle it just survived instead of re-colliding. */
  shieldInvuln: 1.2,
  /** MAGNET: forward range (world units) within which pickups are pulled in. */
  magnetRange: 80,
  /** MAGNET: per-second easing factor pulling a pickup toward the player. */
  magnetPull: 4.0,
  /** Salt XORed into the run seed for the pickups' OWN rng stream, so adding
   *  powerups never perturbs the (shared-seed) traffic sequence. */
  rngSalt: 0x5bf03635,
} as const;

/** Powerup visual tuning (rendering only). */
export const POWERUP_VIS = {
  /** Pickup centre height above the road. */
  meshY: 1.5,
  /** Base size (world units) of a pickup glyph. */
  size: 1.1,
  /** Idle spin rate (radians/second). */
  spinRate: 1.6,
  /** Vertical bob amplitude (world units) and rate (radians/second). */
  bobAmplitude: 0.28,
  bobRate: 2.2,
  /** Torus tube radius as a fraction of `size` (ring + horseshoe thickness). */
  tubeFraction: 0.3,
  /** Shield protection ring around the car: radius, tube, height above road. */
  shieldRingRadius: 2.4,
  shieldRingTube: 0.16,
  shieldRingY: 0.5,
  /** Shield ring opacity while held vs while flashing during i-frames. */
  shieldRingOpacity: 0.55,
  shieldRingInvulnOpacity: 0.95,
  /** I-frame ring flash rate (radians/second). */
  shieldRingFlashRate: 22,
} as const;

/** Camera + chase-cam tuning (rendering layer). */
export const CAMERA = {
  fov: 70,
  /** Extra FOV degrees added at top speed for a sense of acceleration. */
  fovSpeedBoost: 9,
  near: 0.1,
  far: 2000,
  /**
   * Chase-cam offset behind/above the car. Pulled further back + a touch higher
   * (was 15 back / 8.5 up) — on device the car still sat large at the bottom
   * edge with cramped forward visibility at speed. Pulling BACK is the key
   * lever: it shrinks the car on screen AND lifts it off the bottom (the car's
   * angle below the look-centre shrinks faster than the look pitch), while
   * opening up the road ahead. The mesh itself can't shrink — it's the
   * collision box (see CAR_VIS) — so framing is all camera.
   */
  offsetBehind: 21,
  offsetUp: 9.5,
  /**
   * Look-at point ahead of the car. Pushed further down the road (was 42) so
   * the gaze sits well ahead, lifting the horizon and showing more drivable
   * road rather than framing the car.
   */
  lookAhead: 48,
  /** Height of the look-at point above the road (slightly up = more road ahead). */
  lookAtUp: 2.0,
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
} as const;

/** Traffic obstacle visual tuning (rendering only). */
export const TRAFFIC_VIS = {
  /** Obstacle mesh height and its y-centre above the ground. */
  meshHeight: 1.2,
  meshY: 0.6,
} as const;

/** Horizon backdrop placement + wireframe mountains (procedural, fog-excluded). */
export const ENV = {
  /** Distance ahead of the camera the horizon backdrop sits. */
  distance: 900,
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
   * Mountain render order. The backdrop (sun + mountains) is drawn as a
   * guaranteed-background layer (depthTest/Write off) BEFORE all gameplay
   * geometry, so it can never paint over the car or traffic. Mountains sit
   * behind the sun (drawn first / most-negative order).
   */
  mountainRenderOrder: -2,
} as const;

/**
 * The signature synthwave "retrosun": a vertical colour gradient (warm hot top
 * → deep-purple base) overlaid with horizontal scanline bands that thin and
 * tighten toward the bottom — a sunset, not a flat striped disc. Rendered as a
 * CanvasTexture on a single background plane (no extra post-processing pass);
 * see rendering/Environment.ts. Every value here is tunable.
 */
export const SUN = {
  /** Plane half-extent / disc radius (world units). */
  radius: 220,
  /** Vertical position of the sun centre (world units, above the horizon). */
  y: 120,
  /** Square CanvasTexture resolution in pixels. */
  textureSize: 384,
  /**
   * Vertical gradient stops, top (at: 0) → bottom (at: 1), as CSS colour
   * strings drawn into a 2D linear gradient. A hot warm core blends down
   * through orange and hot pink to magenta, ending in the deep purple that
   * meets the night sky at the base.
   */
  gradient: [
    { at: 0.0, color: '#ffd24a' }, // hot warm core (top)
    { at: 0.3, color: '#ff7a18' }, // orange
    { at: 0.58, color: '#ff2d95' }, // hot pink
    { at: 0.82, color: '#ff00ff' }, // magenta
    { at: 1.0, color: '#1a0033' }, // deep purple base
  ] as ReadonlyArray<{ at: number; color: string }>,
  /** Number of horizontal scanline bands carved from the disc. */
  bandCount: 12,
  /**
   * Fraction of the disc height (from the top) where banding begins — bands
   * only cut the lower portion so the warm upper core stays a solid glow.
   */
  bandStartFraction: 0.4,
  /**
   * Thinning-curve exponent (> 1). Higher bunches the bands harder toward the
   * bottom: wide gaps near the top, tight scanlines down at the horizon.
   */
  bandThinningCurve: 2.6,
  /** Each band's carved thickness as a fraction of its local gap to the next. */
  bandThicknessRatio: 0.5,
  /** Minimum visible band thickness (canvas px) — thinner bands are skipped. */
  bandMinThickness: 0.25,
  /** Background render order (drawn before all gameplay geometry). */
  renderOrder: -1,
  /**
   * Phase 3 — slow downward drift of the scanlines, in band-spacings per
   * second. Set to 0 to disable motion entirely (and all per-frame texture
   * work). Subtle by design; tune during playtest.
   */
  scrollSpeed: 0.03,
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
  /** Powerup collection: brief screen glow flash (s) in the pickup's colour. */
  pickupFlash: 0.3,
  /** Optional near-miss micro slow-mo: duration (s) and simulation time scale. */
  nearMissSlowmo: 0.12,
  slowmoScale: 0.45,
  /** Combo tier-up celebration: a brief scale/glow pulse on the in-run HUD
   *  multiplier when it climbs a tier. Duration (ms) + peak scale. Subtle. */
  comboPulseMs: 280,
  comboPulseScale: 1.35,
  comboPulseBrightness: 1.6,
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
  /** Powerup pickup: a bright two-note ascending arpeggio (good-news chime). */
  pickupHzLow: 660,
  pickupHzHigh: 990,
  pickupGain: 0.14,
  /** Pickup blip note decay (s), stop (s), and the gap (s) before the 2nd note. */
  pickupDecay: 0.16,
  pickupStop: 0.18,
  pickupNoteGap: 0.07,
} as const;

/** Front-end shell / overlay UI tuning. */
export const UI = {
  /** How long the "link copied" toast stays visible (ms). */
  toastDurationMs: 1800,
  /** Horizontal swipe distance (px) to cycle cars in the picker. */
  carSwipeThresholdPx: 40,
  /** Car-picker 3D preview: gentle auto-rotate speed (radians/second). */
  carPreviewSpinPerSec: 0.6,
  /** Preview camera field-of-view (degrees). Narrow for a flattering close-up. */
  carPreviewFov: 34,
  /** Preview camera near / far clip planes. */
  carPreviewNear: 0.1,
  carPreviewFar: 100,
  /** Camera height = CAR_VIS.height * this. */
  carPreviewCamHeightMul: 2.2,
  /** Camera distance back along Z. */
  carPreviewCamZ: 8.5,
  /** Look-at height = CAR_VIS.height * this. */
  carPreviewLookAtMul: 0.4,
  /** Fixed X-axis tilt (radians) so the rotation reads as 3D. */
  carPreviewTilt: 0.18,
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
 * Per-car handling, expressed as MULTIPLIERS against the base VEHICLE tuning
 * (never absolute replacements) so the base game stays the single source of
 * truth: retuning VEHICLE rescales every car proportionally and per-car balance
 * survives. 1.0 = identical to base on that axis.
 *
 * The four axes form a tradeoff triangle — every car is strong on one and pays
 * on another, so there is NO strictly-best car (verified in CAR_HANDLING_TABLE
 * below). Higher is "more" of the axis; for `lateralFriction`, higher = more
 * slide / less settle (lower = more planted/control).
 */
export interface CarHandling {
  /** Multiplier on the forward speed cap (top speed). >1 = faster. */
  speedCap: number;
  /** Multiplier on lateral acceleration — steering responsiveness / grip. */
  lateralAccel: number;
  /** Multiplier on the NORMAL retained-friction fraction. <1 settles quicker
   *  (planted/precise); >1 holds lateral velocity longer (looser/slidier). */
  lateralFriction: number;
  /** Multiplier on the handbrake slide (drift effectiveness). >1 = longer slide.
   *  Scales the drift; never removes it — handbrake always loosens grip. */
  drift: number;
}

/** Fallback handling: identical to base on every axis (the pre-stats behaviour).
 *  Used for any car with no `handling` block or an unknown id — never crashes. */
export const BASE_HANDLING: CarHandling = {
  speedCap: 1,
  lateralAccel: 1,
  lateralFriction: 1,
  drift: 1,
};

/*
 * TRADEOFF-TRIANGLE BALANCE (reviewable at a glance — feel confirmed on device):
 *
 *   car     speedCap  lateralAccel  lateralFriction  drift   identity
 *   Pulse     1.00       1.00           1.00          1.00    balanced all-rounder
 *   Vapor     0.90       1.25           0.70          0.85    grip / precise, slow
 *   Ember     1.18       0.85           1.20          1.00    fast / twitchy, sluggish steer
 *   Ghost     0.95       0.95           1.10          1.45    drift specialist
 *
 * Desirability (↑good): speedCap↑, lateralAccel↑, lateralFriction↓, drift↑.
 * No row is ≥ another on all four axes, so no car strictly dominates:
 *   - Pulse trades nothing but is beaten on each axis by that axis's specialist.
 *   - Vapor wins steer+control, loses speed+drift.
 *   - Ember wins speed, loses steer+control.
 *   - Ghost wins drift, loses speed+steer.
 * NOTE: base lateralFriction is already very low (0.02), so the lateralFriction
 * multiplier is a subtle settle difference; lateralAccel is the dominant control
 * lever and `drift` the dominant slide lever.
 */

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
    cosmetic: { body: 0x140a2e, glow: 0x00ffff, accent: 0xff00ff },
    // Balanced all-rounder: no weakness, no specialty. The reference point.
    handling: { speedCap: 1.0, lateralAccel: 1.0, lateralFriction: 1.0, drift: 1.0 },
  },
  {
    id: 'vapor',
    displayName: 'Vapor',
    cosmetic: { body: 0x2e0a24, glow: 0xff00ff, accent: 0x00ffff },
    // Grip / precision: snappy, planted steering — but the slowest, and its
    // handbrake barely slides (you place it, you don't drift it).
    handling: { speedCap: 0.9, lateralAccel: 1.25, lateralFriction: 0.7, drift: 0.85 },
  },
  {
    id: 'ember',
    displayName: 'Ember',
    cosmetic: { body: 0x2e1605, glow: 0xff6600, accent: 0xff00ff },
    // Speed / twitchy: highest top speed, but sluggish steering and a loose tail
    // — fast in a straight line, a handful to place laterally.
    handling: { speedCap: 1.18, lateralAccel: 0.85, lateralFriction: 1.2, drift: 1.0 },
  },
  {
    id: 'ghost',
    displayName: 'Ghost',
    cosmetic: { body: 0x06261f, glow: 0xffffff, accent: 0x00ffff },
    // Drift specialist: massive handbrake slide for stylish dodges, at the cost
    // of a little top speed and steering bite vs the balanced Pulse.
    handling: { speedCap: 0.95, lateralAccel: 0.95, lateralFriction: 1.1, drift: 1.45 },
  },
] as const;

/** Default selected car — the first in the list. */
export const DEFAULT_CAR_ID = CARS[0].id;

/** Resolve a car by id, falling back to the default if the id is unknown. */
export function carById(id: string): CarDef {
  return CARS.find((c) => c.id === id) ?? CARS[0];
}

/**
 * Resolve the handling profile for a car id. Falls back to BASE_HANDLING for an
 * unknown id or a car with no `handling` block — so the pure sim always gets a
 * complete, finite profile and never crashes.
 */
export function handlingFor(id: string): CarHandling {
  return CARS.find((c) => c.id === id)?.handling ?? BASE_HANDLING;
}

/**
 * Normalisation ranges for the picker's Speed / Grip / Drift bars. The bars are
 * DERIVED from the same `handling` multipliers the sim uses (see carStats) — the
 * single source of truth — so they can never be hand-authored out of sync with
 * the physics. Chosen to span the roster's spread with a little headroom.
 */
export const CAR_STAT_RANGE = {
  speed: { min: 0.85, max: 1.25 },
  /** Grip = steering authority / how loose the car is = lateralAccel / lateralFriction. */
  grip: { min: 0.6, max: 2.0 },
  drift: { min: 0.8, max: 1.5 },
} as const;

export interface CarStats {
  /** 0..1 bar fills. */
  speed: number;
  grip: number;
  drift: number;
}

function norm01(v: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (v - min) / (max - min)));
}

/**
 * Derive the 0..1 Speed / Grip / Drift bars from a car's handling multipliers.
 * The picker MUST read its bars from here so a change to a handling number moves
 * both the physics and the displayed bar together. Grip combines steering
 * authority (lateralAccel) with how fast the car settles (lower lateralFriction
 * = grippier), i.e. lateralAccel / lateralFriction.
 */
export function carStats(h: CarHandling): CarStats {
  return {
    speed: norm01(h.speedCap, CAR_STAT_RANGE.speed.min, CAR_STAT_RANGE.speed.max),
    grip: norm01(h.lateralAccel / h.lateralFriction, CAR_STAT_RANGE.grip.min, CAR_STAT_RANGE.grip.max),
    drift: norm01(h.drift, CAR_STAT_RANGE.drift.min, CAR_STAT_RANGE.drift.max),
  };
}

/** CSS hex string for a 0xRRGGBB color (for HTML/CSS previews of car colors). */
export function cssHex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}
