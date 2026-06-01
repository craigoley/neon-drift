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
  /** Amplitude of the gentle deterministic curve, in world units. Raised (was 4)
   *  so the bend is actually visible: halfWidth(9) - amplitude(7) = ±2
   *  always-safe lane — the curve reads as flavor but is not a steering threat. */
  curveAmplitude: 7,
  /** Spatial frequency of the curve noise (lower = longer sweeps). */
  curveFrequency: 0.08,
} as const;

/** Player vehicle physics. */
export const VEHICLE = {
  /** Forward speed at the very start of a run. */
  startSpeed: 45,
  /** Speed cap floor (cap at distance 0). */
  baseSpeedCap: 70,
  /** Speed cap ceiling reached asymptotically with distance. REBALANCED (was 280,
   *  240 before that): 280 + the fast ramp made the run impossible by ~30s
   *  (diagnosis: ~230 u/s at the density floor left <0.3s per dodge). 235 is still
   *  genuinely fast but leaves a survivable dodge window. The whole curve is
   *  `baseSpeedCap + (maxSpeedCap-baseSpeedCap)*(1-e^(-distance/speedCapRampDistance))`. */
  maxSpeedCap: 235,
  /** Distance scale over which the cap ramps from base toward max. RAISED (was
   *  3200, 6000 before that): 3200 made top speed arrive by ~45s; 5200 spreads it
   *  over minutes. Tune this single number for how fast the run gets fast. */
  speedCapRampDistance: 5200,
  /** Forward acceleration toward the current cap. Eased (was 24) so the early ramp
   *  is gentle through the first ~20s learning phase before speed builds. */
  acceleration: 19,
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
  /** Extra speed (world units/s) a RAMP boost adds on top of the distance cap
   *  while the boost timer is live, so a boosted car can briefly out-run its
   *  normal top speed before settling back. */
  boostBonus: 55,
} as const;

/**
 * DRIFT (handbrake) tuning. Diagnosis (see PR): the old handbrake only loosened
 * lateral FRICTION, which raises the car's sustained lateral-velocity ceiling —
 * but the road is so narrow (2*ROAD.halfWidth) that the car hits the wall long
 * before that ceiling matters, and the dodge window is dominated by lateral
 * ACCELERATION (identical drift-or-not). So drift was real but imperceptible.
 *
 * The fix attacks the dodge window directly: while the handbrake is held, the
 * steering ACCELERATION is multiplied (scaled by the car's `drift` stat) for a
 * sharp juke normal steering can't match — at the cost of forward speed, so it's
 * a deliberate trade (dodge now, lose distance/score), not a free permanent hold.
 */
export const DRIFT = {
  /** Lateral-accel multiplier while drifting, scaled further by the car's `drift`
   *  stat. ~3x the lateral distance covered in the first 0.2s vs normal steering,
   *  so a last-second lane juke REQUIRES drift. */
  accelBoost: 2.4,
  /** Forward speed scrubbed per second while the handbrake is held (the trade).
   *  A quick juke costs little; holding it down bleeds speed toward the floor. */
  speedDrag: 42,
  /** Drift won't scrub forward speed below this fraction of the current cap, so
   *  the cost is felt but never tanks the run to a crawl. */
  minSpeedFraction: 0.6,
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
  baseSpawnInterval: 1.5,
  /**
   * Lowest spawn interval (the density FLOOR) as difficulty ramps. The
   * pacedSpawnInterval clamps to this, so it sets the DENSEST the game ever gets
   * (reached in the late game). History: 0.3 (~3.3/s, undodgeable) → 0.62 (~1.6/s).
   *
   * LEVER 2 (fix/near-miss-frequency-tuning): 0.62 → 0.8 (~1.25/s, ~22% fewer
   * obstacles/sec at peak) — late-game traffic felt constant/oppressive. This is
   * the single biggest lever on peak difficulty and ONLY affects late game (early
   * pacing + the OPP-01 opening seed are governed by base/rampStart, untouched).
   * Independently revertable from Lever 1.
   */
  minSpawnInterval: 0.8,
  /**
   * Difficulty ramp (spawn density). For the first `rampStartDistance` world
   * units the interval stays at `baseSpawnInterval` — a grace period (the first
   * ~20s) to let the player learn. Past that, the interval shrinks by
   * `spawnRampPerUnit` per unit toward `minSpawnInterval`. This is the spawn
   * DENSITY ramp; the spawn MIX (kinds) and PACING (waves, below) ramp separately.
   */
  rampStartDistance: 1100,
  /** How much the interval shrinks per world-unit travelled past the grace.
   *  REBALANCED (was 0.0003, 0.0001 before that): 0.0003 hit the floor by ~4.5k m
   *  (~30s) → impossible. 0.00008 reaches the floor at ~12k m (~90s), so density
   *  escalates steadily over minutes rather than collapsing in half a minute. */
  spawnRampPerUnit: 0.00008,
  /**
   * PACING WAVE — texture so a run isn't a uniform stream. A seeded sine over
   * distance multiplies the ramped interval, giving alternating dense GAUNTLETS
   * (factor < 1) and BREATHERS (factor > 1). The phase is derived from the run
   * seed so different runs place their gauntlets differently; the wave is clamped
   * by [minSpawnInterval, baseSpawnInterval] so it never beats the density cap and
   * never dumps a brutal gauntlet at second 5 (early ramped interval is high, so
   * even a dense wave there is mild). amplitude = peak ± fraction; wavelength is in
   * world units (≈ one gauntlet+breather cycle). */
  pacingAmplitude: 0.32,
  pacingWavelength: 2000,
  /** Obstacle forward-speed range (slower than the player, so they're overtaken). */
  minSpeed: 25,
  maxSpeed: 60,
  /** Obstacle collision box half-extents (lateral, forward). */
  halfWidth: 1.1,
  halfLength: 2.2,
  /** Fraction of the road half-width obstacles may occupy. */
  lateralSpread: 0.85,
  /**
   * Lane-changing "movers": a subset of obstacles sway laterally (sine) about
   * their spawn lane instead of holding a fixed line, so dodging requires
   * reading movement. Amplitude (world units) is randomised per mover; swayRate
   * is the phase advance (radians/second). Kept subtle so it reads as drifting
   * traffic, not teleporting. The spawn MIX (which kinds appear) is driven by
   * per-kind weights in OBSTACLE_DEFS, not a flat fraction.
   */
  swayAmplitudeMin: 1.5,
  swayAmplitudeMax: 3.0,
  swayRate: 1.1,
} as const;

/**
 * OPENING SEED — one easy obstacle placed at run start so the very first PLAY has
 * an immediate, low-stakes decision (steer around it), instead of ~6-11s of empty
 * road (the first timer-spawned obstacle spawns 420m ahead — TRAFFIC.spawnAhead —
 * and takes that long to close). This is a ONE-SHOT at run init only: it does NOT
 * touch spawnInterval / spawnAhead / rampStartDistance or the steady-state timer,
 * so encounter geometry past the opening is unchanged. A dead-centre STATIC
 * obstacle ~200m ahead is reached in ~3s and forces a trivial dodge (the road is
 * ~9 units half-width vs the obstacle's ~1.1, so there's huge clearance each side).
 */
export const OPENING_SEED = {
  /** Distance ahead of the player's start (distance 0) — ~3s of travel away. */
  distance: 200,
  /** Lane offset from the road centre (0 = dead centre → guarantees a steer). */
  laneOffset: 0,
  /** Stationary so it's reached promptly (and reads as a parked car to dodge). */
  speed: 0,
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
   * Must exceed the summed collision half-widths (2.2) or nothing would ever be a
   * near-miss without also colliding.
   *
   * LEVER 1 (fix/near-miss-frequency-tuning): was 6.5 — a ±6.5 (13-unit) band over
   * the player's ~15.8-unit reachable space, so ~82% of passes triggered one and
   * near-misses felt constant/meaningless. 4.0 (±4.0 = 8-unit band ≈ HALF the
   * prior qualifying width) means a near-miss is now a GENUINELY close pass.
   * Shared with the graze gradient (grazeMultiplier) — grazeInner is co-adjusted
   * below — and with the OPP-07b perk economy (fewer near-misses → see PR note).
   */
  nearMissLateral: 4.0,
  /** Combo weight for threading a MOVER (a lane-changing obstacle) — threading a
   *  moving target is harder, so it pays more than a static near-miss. */
  moverNearMissWeight: 2,
  /** Combo weight for threading a GATE's opening. */
  gateThreadWeight: 1.5,
  /** Multiplier applied to a near-miss's combo weight when it's threaded WHILE
   *  DRIFTING. A drifted dodge is committed/risky, so it pays more — a concrete
   *  reason to drift through the tightest gaps rather than play it safe. */
  driftNearMissBonus: 1.5,
  /**
   * GRAZE GRADIENT (OPP-14, Psyvariar model): within the binary near-miss window
   * (nearMissLateral, now 4.0, is the OUTER bound), the reward scales with how
   * close the pass was. grazeMultiplier(gap) = 1.0 at the outer edge, ramping
   * linearly up to grazeMax as the gap shrinks to grazeInner (capped at grazeMax
   * below it — no runaway). It MULTIPLIES the existing combo weight (mover/gate/
   * drift bonuses still apply).
   *
   * LEVER 1 co-adjust: grazeInner was 2.0. With the outer bound now 4.0 the ramp
   * band would be only 4.0-2.0 = 2.0 wide; but more importantly grazeInner MUST be
   * >= the 2.2 collision boundary (VEHICLE.halfWidth 1.1 + TRAFFIC.halfWidth 1.1),
   * or grazeMax is UNREACHABLE — at 2.0 the player would have to pass within 2.0
   * units to hit the cap, which is inside the 2.2 crash band (= crash). So
   * grazeInner is raised to 2.3, JUST above the collision boundary: grazeMax is
   * now earned in the thin paint-shave sliver gap ∈ [2.2, 2.3) (a non-crash pass),
   * over a 4.0-2.3 = 1.7-wide ramp. (NOTE: an earlier suggestion of 1.4 would have
   * been WRONG — 1.4 < 2.2 leaves grazeMax permanently unreachable.) */
  grazeInner: 2.3,
  grazeMax: 2.5,
} as const;

/**
 * Obstacle BEHAVIOR types. Erasable const-object (same style as Phase /
 * PowerupKind). The traffic pool is a single recycled pool whose slots each
 * carry a `kind`; per-type logic lives in Traffic/Scoring, never a forked pool.
 */
export const ObstacleKind = {
  /** Holds its lane — the classic obstacle. */
  Static: 'static',
  /** Drifts laterally (sine sway) — you must read its path. */
  Mover: 'mover',
  /** Full-width barrier with one passable opening — steer to the gap. */
  Gate: 'gate',
  /** Beneficial boost-strip — hit it on purpose for a speed + score burst. */
  Ramp: 'ramp',
} as const;
export type ObstacleKind = (typeof ObstacleKind)[keyof typeof ObstacleKind];

/**
 * Obstacle colours, COLOUR-CODED BY INTENT (consistent with powerups): warm
 * hues = THREAT, green = BENEFICIAL. Static is the classic orange; movers run a
 * hotter red so a moving threat reads as more urgent; gate bars are orange (the
 * gap is the safe cue); the ramp is spring-green like a "go" signal.
 */
export const OBSTACLE_COLORS = {
  static: PALETTE.accent, // 0xff6600 — classic orange threat
  mover: 0xff2d55, // hot red — a moving threat reads hotter / more urgent
  gate: PALETTE.accent, // 0xff6600 — barrier; the opening is the safe cue
  ramp: 0x00ff9f, // spring green — beneficial, "drive over this"
} as const;

export interface ObstacleDef {
  id: ObstacleKind;
  displayName: string;
  /** Render colour (0xRRGGBB). */
  color: number;
  /** True for THREATS (collidable), false for BENEFICIAL terrain (ramps). */
  threat: boolean;
  /**
   * Spawn-MIX weighting that ramps with distance. The kind is unavailable until
   * `startDistance`; past it the weight is
   *   clamp(weightBase + weightPerUnit * (distance - startDistance), 0, weightMax).
   * Density (how OFTEN anything spawns) is separate — see spawnInterval.
   */
  startDistance: number;
  weightBase: number;
  weightPerUnit: number;
  weightMax: number;
}

/** Per-kind obstacle configuration (single source of truth for spawn mix). */
export const OBSTACLE_DEFS: Readonly<Record<ObstacleKind, ObstacleDef>> = {
  static: {
    id: ObstacleKind.Static,
    displayName: 'Static',
    color: OBSTACLE_COLORS.static,
    threat: true,
    startDistance: 0,
    weightBase: 6,
    weightPerUnit: 0,
    weightMax: 6,
  },
  mover: {
    id: ObstacleKind.Mover,
    displayName: 'Mover',
    color: OBSTACLE_COLORS.mover,
    threat: true,
    startDistance: 0,
    weightBase: 2,
    weightPerUnit: 0.0008,
    weightMax: 6,
  },
  gate: {
    id: ObstacleKind.Gate,
    displayName: 'Gate',
    color: OBSTACLE_COLORS.gate,
    threat: true,
    startDistance: 1500,
    weightBase: 1.5,
    weightPerUnit: 0.0006,
    weightMax: 4,
  },
  ramp: {
    id: ObstacleKind.Ramp,
    displayName: 'Ramp',
    color: OBSTACLE_COLORS.ramp,
    threat: false,
    startDistance: 1000,
    weightBase: 1.0,
    weightPerUnit: 0.00025,
    weightMax: 2,
  },
} as const;

/** Stable kind ordering (weighted-pick iteration + renderer dispatch). */
export const OBSTACLE_ORDER: readonly ObstacleKind[] = [
  ObstacleKind.Static,
  ObstacleKind.Mover,
  ObstacleKind.Gate,
  ObstacleKind.Ramp,
] as const;

/** GATE (barrier-with-opening) tuning. */
export const GATE = {
  /** Half-width (world units) of the passable opening — must clear the car
   *  (VEHICLE.halfWidth 1.1) with margin. Randomised per gate in this range. */
  openingHalfWidthMin: 2.6,
  openingHalfWidthMax: 3.6,
  /** Forward half-thickness of the barrier band (collision + render depth). */
  halfLength: 1.4,
} as const;

/** RAMP (beneficial boost-strip) tuning. */
export const RAMP = {
  /** Contact box half-extents (lateral, forward) — generous so it's easy to hit
   *  on purpose. */
  halfWidth: 2.4,
  halfLength: 3.2,
  /** Flat score burst granted on contact (added once per ramp). */
  scoreBurst: 250,
  /** Seconds the over-cap speed boost stays live after a ramp (see
   *  VEHICLE.boostBonus). */
  boostDuration: 2.0,
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
  /** Seconds between spawns at the start of a run (much rarer than traffic).
   *  Slightly more available than before (was 5.5) — powerups are the pressure
   *  valve for the steeper difficulty curve, so the harder game stays fair. */
  baseSpawnInterval: 5.0,
  /** Lowest spawn interval as difficulty ramps (was 3.0) — the dense, fast late
   *  game is where the player most needs a shield / slow-mo. */
  minSpawnInterval: 2.5,
  /** Grace distance before the cadence tightens (shared feel with traffic). */
  rampStartDistance: 850,
  /** How much the interval shrinks per world-unit travelled past the grace.
   *  Steepened (was 0.0002) to track the steeper traffic ramp. */
  spawnRampPerUnit: 0.00035,
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
  /** Chevron (cone) height as a multiple of `size`. */
  chevronAspect: 1.7,
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
  /** Extra FOV degrees added at top speed for a sense of acceleration. Bumped
   *  (was 9) so the world visibly stretches as the (now faster) run speeds up. */
  fovSpeedBoost: 12,
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
  /** Yaw (radians) the car angles INTO the slide at full drift — the nose kicks
   *  out so a drift reads instantly as a slide, not a slide-step. Only applied
   *  while drifting (normal steering keeps the nose forward). */
  driftMaxYaw: 0.42,
  /** Lateral velocity that maps to driftMaxYaw. */
  driftYawReference: 55,
  /** Extra roll multiplier while drifting (the car leans harder into a slide). */
  driftRollBoost: 1.5,
  /** Glow colour the edge lines shift toward while drifting (hot magenta), so
   *  the car visibly changes state when you press DRIFT. */
  driftGlow: 0xff2d95,
  /** Lerp speed (0–1) for the per-frame glow colour transition into/out of drift. */
  driftGlowLerp: 0.25,
  /** Sum-of-channel distance (0–3) within which the glow snaps to its target, so
   *  the asymptotic lerp settles instead of running a tiny step every frame. */
  driftGlowSnap: 0.01,
} as const;

/**
 * Procedural player-car geometry (rendering only — the collision box is still
 * CAR_VIS.width × .length, see VEHICLE). The car is built as a low-poly group:
 * a tapered lower hull, a smaller faceted cabin, four wheels, plus emissive neon
 * edge lines and a ground-glow blob. All dimensions are FRACTIONS of the CAR_VIS
 * footprint so the silhouette scales with the hitbox and the visible car keeps
 * reading as "what collides". The chase cam views it from behind/above, so detail
 * is biased to the top and rear.
 *
 * NOTE: there are deliberately NO headlights. Forward light cones/quads regressed
 * into opaque artifacts twice (#13, #42), so they were removed entirely — the car
 * reads cleanly without them.
 */
export const CAR_GEO = {
  /** Lower hull as a fraction of the full footprint. The nose tapers in (front
   *  narrower than rear) for a wedge/sleek read; values are 0..1 of width. */
  hull: {
    /** Hull height as a fraction of CAR_VIS.height (rest is headroom for cabin). */
    heightFraction: 0.5,
    /** Rear width as a fraction of CAR_VIS.width (the widest part). */
    rearWidthFraction: 1.0,
    /** Front width as a fraction of CAR_VIS.width (tapered nose). */
    frontWidthFraction: 0.66,
    /** Top deck inset vs the bottom (top narrower → subtle bevel), fraction. */
    topInsetFraction: 0.16,
  },
  /** Faceted cabin/greenhouse sitting on the hull, toward the rear (cockpit). */
  cabin: {
    /** Cabin height as a fraction of CAR_VIS.height above the hull top. */
    heightFraction: 0.5,
    /** Cabin width as a fraction of the hull top width. */
    widthFraction: 0.7,
    /** Cabin length as a fraction of CAR_VIS.length. */
    lengthFraction: 0.42,
    /** Cabin centre offset toward the REAR as a fraction of half-length (+ = back). */
    rearOffsetFraction: 0.18,
    /** Windshield rake: how far the cabin FRONT-top pulls back vs front-bottom,
     *  fraction of cabin length (a slanted windscreen, not a vertical wall). */
    windshieldRake: 0.55,
    /** Roof narrows inward by this fraction of cabin half-width per side. */
    roofInsetFraction: 0.18,
  },
  /** Wheels: short octagonal prisms (low-poly), one per corner. */
  wheels: {
    /** Radius as a fraction of CAR_VIS.height. */
    radiusFraction: 0.28,
    /** Width (axle length) as a fraction of CAR_VIS.width. */
    widthFraction: 0.18,
    /** Radial segments — low for the faceted low-poly look. */
    segments: 8,
    /** Corner inset from the hull edge, fraction of half-width / half-length. */
    lateralInset: 0.06,
    longitudinalInset: 0.26,
    /** Ride height as a fraction of wheel radius (axle sits this high). */
    rideHeightFraction: 0.55,
  },
  /** Ground glow: a flat additive blob under the car so it feels grounded. */
  groundGlow: {
    /** Radius as a multiple of CAR_VIS.width. */
    radiusMul: 1.35,
    /** Length stretch (z) vs width so the pool elongates with the car. */
    lengthMul: 1.5,
    /** Height above the road (just clear of z-fighting). */
    y: 0.03,
    /** Base opacity (additive; subtle). */
    opacity: 0.32,
    /** Circle geometry segments for the glow disc. */
    segments: 24,
  },
  /** Emissive accent strips along the body sides. */
  sideStrips: {
    /** Strip height as a fraction of hull height (measured from ride height). */
    heightFraction: 0.55,
    /** Lateral position as a fraction of hull half-width (slightly inset from edge). */
    lateralFraction: 0.98,
    /** Longitudinal extent as a fraction of half-length (slightly inside the tips). */
    longitudinalFraction: 0.96,
    /** Opacity of the side accent line. */
    opacity: 0.9,
  },
} as const;

/** Traffic obstacle visual tuning (rendering only). */
export const TRAFFIC_VIS = {
  /** Obstacle mesh height and its y-centre above the ground. */
  meshHeight: 1.2,
  meshY: 0.6,
  /**
   * Per-instance colouring (moving + typed obstacles) is done by tinting a
   * GREYSCALE box via instanceColor: body faces sit at `bodyShade`, the top +
   * leading edge at 1.0, so the hot-rim readability survives while each kind
   * gets its own colour (static orange, mover red, gate orange, ramp green).
   */
  bodyShade: 0.62,
  /** GATE barrier bars: full height + y-centre (taller than cars → reads as a
   *  wall); a bar thinner than this in world units is skipped (opening at edge). */
  gateHeight: 2.4,
  gateY: 1.2,
  gateMinBarWidth: 0.1,
  /** RAMP boost-strip: a low, wide flat slab on the road surface. */
  rampHeight: 0.35,
  rampY: 0.18,
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
  /**
   * Plane half-extent / disc radius (world units). Reduced (was 220) as part of
   * the readability pass: a smaller disc, raised well above the horizon (see
   * `y`), keeps the sun's bright banded body out of the road's vanishing point /
   * obstacle spawn zone so the playfield wins the contrast war. Tune with `y`.
   */
  radius: 150,
  /**
   * Vertical position of the sun centre (world units). Raised (was 120) so the
   * whole disc — including its bright lower bands — sits ABOVE the horizon line
   * (~y 9.5 at the backdrop). At radius 150 / y 250 the disc's bottom edge lands
   * roughly a sixth of the screen above the horizon, leaving dark sky at the
   * vanishing point where obstacles first appear. Raise/lower to frame on device.
   */
  y: 250,
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
  /**
   * Repaint rate (Hz) for the drifting scanlines. The phase advances on real
   * time every frame, but the canvas is only re-rasterised + re-uploaded this
   * often — the drift is slow enough that ~20 Hz is visually identical to 60
   * Hz while cutting the per-frame GPU texture upload to a third (mobile is a
   * hard requirement). Ignored when scrollSpeed is 0.
   */
  scrollRepaintHz: 20,
} as const;

/**
 * Roadside parallax scenery — layered neon props that stream past to sell speed
 * and depth. Each layer is a fixed, RECYCLED ring of `count` props per side
 * (left + right), spaced `gap` apart, sitting OUTSIDE the road at ±`offsetX`
 * (well clear of the drivable ROAD.halfWidth = 9 so they never read as
 * obstacles, and cyan/magenta-coded, never the orange threat hue). A layer's
 * `parallax` (<1) makes far layers drift slower than near ones; props fade with
 * the scene fog so they melt into the horizon haze.
 *
 * BOUNDED: total meshes = layers.length * count * 2 sides, allocated once; the
 * streaming is pure index math (utils/parallax.ts), so the active count is
 * constant for any distance (no per-frame allocation, no growth).
 */
export const SCENERY = {
  layers: [
    // Near: tall neon pylons just off the verge — the fastest parallax.
    // BUG-01 hazard-colour monopoly: desaturated from pure magenta (0xff00ff,
    // S100/L50) to a muted plum + lower opacity so the loudest, most-saturated
    // element on the field is always the orange/red hazard, never the decor.
    { kind: 'pylon', parallax: 1.0, offsetX: 13, count: 14, gap: 26, height: 7, width: 0.5, color: 0x6e3a73, opacity: 0.45 },
    // Mid: shorter light-poles set back — moderate sweep. Muted from pure cyan.
    { kind: 'pole', parallax: 0.6, offsetX: 22, count: 12, gap: 40, height: 11, width: 0.7, color: 0x2f6a73, opacity: 0.4 },
    // Far: a low distant city-silhouette band — drifts slowly, sits low + wide.
    // Dimmed a touch further so it reads as pure background haze.
    { kind: 'block', parallax: 0.28, offsetX: 46, count: 10, gap: 80, height: 26, width: 9, color: 0x281842, opacity: 0.35 },
  ],
  /** Slots kept behind the camera before a prop wraps to the front (the +z
   *  margin of the streaming window). */
  behind: 1,
  /** Y of each prop's base (on the grid plane). */
  baseY: 0,
} as const;

export type SceneryLayer = (typeof SCENERY.layers)[number];

/**
 * BIOMES — environmental variety so long runs feel like progress. A biome is a
 * pure palette + environment override; which one is active is driven by distance
 * in the pure layer (see game/Biome.ts), and the rendering layer lerps between
 * the current and next biome's palette for a SMOOTH transition (no hard pop).
 *
 * Each biome reuses the existing retrosun pipeline — it only swaps the gradient
 * STOPS (same `at` positions across all biomes so the transition lerps stop by
 * stop). Obstacle + powerup colours are deliberately NOT themed: threats stay
 * orange/red and pickups keep their hues in every biome, so intent-coding
 * readability is constant.
 */
export interface BiomeGradientStop {
  at: number;
  color: string;
}
export interface BiomeDef {
  id: string;
  displayName: string;
  /** Sun vertical gradient stops (top → base). SAME `at` positions in every
   *  biome so a transition is a per-stop colour lerp. */
  gradient: ReadonlyArray<BiomeGradientStop>;
  /** Ground-grid centre-cross colour (0xRRGGBB). */
  gridCenter: number;
  /** Ground-grid line colour (0xRRGGBB). */
  gridLine: number;
  /** Scene fog + background colour (0xRRGGBB). */
  fog: number;
  /** Wireframe mountain colour (0xRRGGBB). */
  mountain: number;
  /** Star-field brightness in this biome, 0 (none) .. 1 (full night sky). */
  starIntensity: number;
  /** Signature accent the traffic picks up a FAINT cast of (0xRRGGBB) — kept
   *  subtle (see BIOME_CYCLE.accentTintStrength) so threat intent-coding still
   *  reads. */
  accent: number;
  /** Engine-tone voicing 0 (dark) .. 1 (bright) for biome-aware audio. */
  audioTone: number;
}

export const BIOMES: readonly BiomeDef[] = [
  {
    id: 'sunset',
    displayName: 'Sunset',
    // The signature look — reuses the retrosun's own gradient verbatim.
    gradient: SUN.gradient,
    gridCenter: PALETTE.magenta,
    gridLine: PALETTE.cyan,
    fog: PALETTE.deepPurple,
    mountain: PALETTE.cyan,
    starIntensity: 0.0, // dusk — sun still up, no stars
    accent: 0xff66ff,
    audioTone: 0.7,
  },
  {
    id: 'midnight',
    displayName: 'Midnight',
    // Deep blue/purple, a dim cool glow instead of a hot core.
    gradient: [
      { at: 0.0, color: '#9fb6ff' },
      { at: 0.3, color: '#5566cc' },
      { at: 0.58, color: '#3a3a8a' },
      { at: 0.82, color: '#241a5a' },
      { at: 1.0, color: '#03001a' },
    ],
    gridCenter: 0x6a4cff,
    gridLine: 0x2b6fff,
    fog: 0x05001a,
    mountain: 0x3a66cc,
    starIntensity: 1.0, // full night sky
    accent: 0x6688ff,
    audioTone: 0.15, // darkest voicing
  },
  {
    id: 'toxic',
    displayName: 'Toxic',
    // Acid neon-green wasteland.
    gradient: [
      { at: 0.0, color: '#eaff8a' },
      { at: 0.3, color: '#9bff3a' },
      { at: 0.58, color: '#22e07a' },
      { at: 0.82, color: '#0a9f55' },
      { at: 1.0, color: '#02180a' },
    ],
    gridCenter: 0xccff33,
    gridLine: 0x00ff88,
    fog: 0x041a0c,
    mountain: 0x33ff99,
    starIntensity: 0.35, // a few stars through the haze
    accent: 0x88ff66,
    audioTone: 0.5,
  },
  {
    id: 'dawn',
    displayName: 'Dawn',
    // Warm orange/pink first light.
    gradient: [
      { at: 0.0, color: '#fff0c0' },
      { at: 0.3, color: '#ffb86b' },
      { at: 0.58, color: '#ff8aa6' },
      { at: 0.82, color: '#ff5e9c' },
      { at: 1.0, color: '#2a0a2a' },
    ],
    gridCenter: 0xff6aa8,
    gridLine: 0xffac66,
    fog: 0x2a0a24,
    mountain: 0xff99cc,
    starIntensity: 0.1, // last few stars fading at first light
    accent: 0xffaa88,
    audioTone: 0.85, // brightest voicing
  },
] as const;

/** Biome cycling cadence + transition tuning. */
export const BIOME_CYCLE = {
  /** World-units each biome holds before the set advances (then it cycles). */
  span: 2600,
  /** Fraction of a span (at its end) spent smoothly blending into the next
   *  biome — the make-or-break feel detail. 0.27 ≈ a ~700-unit blend zone. */
  transitionFraction: 0.27,
  /** Rendering throttle: re-apply the blended palette only once `blend` advances
   *  by at least this much, so the sun-texture repaint during a transition fires
   *  ~1/this times instead of every frame (mobile GPU headroom). The grid/fog
   *  recolour is cheap; idle frames (no transition) do nothing at all. */
  repaintBlendStep: 0.02,
  /** How strongly the traffic picks up the biome accent: 0 = none (pure intent
   *  colours), 1 = full accent. Kept LOW so threats stay clearly orange/red and
   *  ramps clearly green — a faint biome cast, not a recolour. */
  accentTintStrength: 0.18,
} as const;

/** Star-field backdrop (procedural points high in the night sky). Brightness is
 *  biome-driven (BiomeDef.starIntensity); positions are seeded + static. */
export const STARFIELD = {
  /** Number of stars (fixed buffer — never grows). */
  count: 420,
  /** Half-width of the star box around the camera (world units). */
  halfWidth: 1200,
  /** Vertical band the stars occupy (world units above the horizon). */
  yMin: 60,
  yMax: 520,
  /** Depth ahead of the camera the star box is centred (matches the backdrop). */
  depth: 900,
  /** Half-depth of the star box. */
  halfDepth: 600,
  /** Point size (world units) and base (full-intensity) opacity. */
  size: 2.4,
  baseOpacity: 0.9,
  /** Render order — behind the sun + mountains (most-negative background layer). */
  renderOrder: -3,
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

/**
 * CINEMATIC POST-FX — chromatic aberration + scanlines + film/VHS grain +
 * vignette, ALL combined into ONE custom ShaderPass (one fullscreen pass, not
 * four — many separate passes tank mobile FPS). Inserted after bloom, before
 * OutputPass, so it filters the graded HDR composite and OutputPass still does
 * tone-mapping + sRGB last.
 *
 * Defaults are SUBTLE by design — seasoning, not the main course. Aberration +
 * grain in particular are kept low so obstacles + HUD text stay readable; the
 * vignette actually AIDS readability by focusing the centre. On touch the
 * intensities scale by `touchScale`, and a user "Retro FX" setting can disable
 * the whole pass (see Settings.lowFx).
 */
export const POSTFX = {
  /** RGB-split magnitude at the screen edge (UV units; grows with dist²). Tiny —
   *  ~1–2 px on a 1080p screen. */
  aberration: 0.0026,
  /** NEAR-MISS CRESCENDO (OPP-13+04, tier-3 only): a brief chromatic-aberration
   *  pulse ADDED on top of `aberration`, decaying back to baseline. Kept
   *  CONSERVATIVE — over-driven CA causes motion discomfort. `peak` is the added
   *  amount at impulse (≈2.5× the baseline edge split, momentary); `decay` is the
   *  per-second exponential falloff. This is the one new/vetoable render effect. */
  aberrationPulsePeak: 0.004,
  aberrationPulseDecay: 6,
  /** Scanline darkening depth (0..1) and how many lines span the screen height. */
  scanlineIntensity: 0.08,
  scanlineCount: 900,
  /** Slow vertical scanline drift (lines/second) — 0 = static. */
  scanlineDrift: 8,
  /** Film/VHS grain amount (added per pixel, ±this/2). Subtle. */
  grain: 0.06,
  /** Vignette: corner-darkening strength, and the radial start/end (0=centre,
   *  ~0.71=corner) over which it ramps in. */
  vignette: 0.42,
  vignetteStart: 0.5,
  vignetteEnd: 1.05,
  /** Touch multiplier applied to aberration/scanline/grain (mobile GPU + small
   *  screens where the effects read harsher). Vignette is left at full (it's
   *  cheap and helps readability). */
  touchScale: 0.6,
  /** Animation clock wrap (seconds): the grain/scanline uTime wraps here so it
   *  never grows large enough to lose float precision in the shader. */
  timeWrap: 1000,
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
  /**
   * NEAR-MISS CRESCENDO (OPP-13+04). Near-miss feedback escalates across 4 combo
   * BANDS so a high streak reads as an event while x1-2 stays slick — NO scoring
   * change, the combo/count logic is untouched. The band (tier 0..3) is derived
   * from the live combo by nearMissTier() in game/Scoring (pure + tested). All
   * arrays below are indexed by tier 0..3.
   */
  // combo >= threshold[i] → tier i+1 (so <3 → 0, 3-5 → 1, 6-9 → 2, >=10 → 3).
  nearMissTierThresholds: [3, 6, 10] as readonly number[],
  // Camera-shake impulse per tier (0 = none at low combo; all well below the
  // crash shakeMagnitude 1.4 so a crash still hits hardest).
  nearMissShake: [0, 0.35, 0.7, 1.1] as readonly number[],
  // Edge-pulse intensity (0..1 opacity scale) per tier — restrained low, bright high.
  nearMissEdge: [0.45, 0.65, 0.85, 1.0] as readonly number[],
  // Audio whoosh/blip pitch multiplier per tier (a riser as the streak climbs).
  nearMissPitch: [1.0, 1.12, 1.3, 1.5] as readonly number[],
  // "CLOSE!"-style callout fires at tier >= this; text is per-tier ('' = none).
  nearMissCalloutTier: 2,
  nearMissCalloutText: ['', '', 'CLOSE!', 'CLUTCH!'] as readonly string[],
  // Callout visible duration (ms) — short; near-misses fire often.
  nearMissCalloutMs: 650,
  // Chromatic-aberration pulse fires only at tier >= this (the loudest channel).
  nearMissCaTier: 3,
  // OPP-14 tie-in: a near-miss whose lateral gap is <= this (a tight GRAZE) bumps
  // the crescendo tier by +1, so a paint-shave at a low combo still punches above
  // its combo band. Captures roughly the tightest fifth of the 6.5 window.
  nearMissGrazeBumpGap: 2.8,
  /** Powerup collection: brief screen glow flash (s) in the pickup's colour. */
  pickupFlash: 0.3,
  /** Milestone / objective toast: total on-screen time (ms) including fades. */
  milestoneToastMs: 1900,
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
  /** Speed-line count on TOUCH devices (mobile GPU headroom; desktop uses
   *  speedLineCount). */
  speedLineCountTouch: 48,
  /** Near-miss SPEED-LINE BURST: opacity added instantly on a near-miss (on top
   *  of the speed-scaled base), then fading at `speedLineBurstFade` per second —
   *  a quick whoosh streak that reinforces the combo without lingering. */
  speedLineBurst: 0.5,
  speedLineBurstFade: 2.4,
  /**
   * TOP-SPEED CAMERA RUMBLE: a subtle CONTINUOUS jitter that grows from 0 at
   * `rumbleThreshold` (normalised speed) to `rumbleMagnitude` world units at full
   * speed, layered under the (larger, transient) crash shake. Kept small so it
   * adds high-speed tension without hurting readability of incoming obstacles.
   */
  rumbleThreshold: 0.55,
  rumbleMagnitude: 0.16,
  /**
   * CAR TRAIL — a light ribbon of the car's recent path that lengthens with
   * speed and burns brighter/hotter while DRIFTING (a drift leaves a visible
   * streak). A fixed ring buffer of points (bounded by construction — never
   * grows, no per-frame allocation); rendered additively so it reads as glow and
   * sits low behind the car, never over incoming obstacles.
   */
  trailPoints: 40,
  /** Trail point budget on touch devices (mobile GPU headroom). */
  trailPointsTouch: 20,
  /** Trail height above the road surface. */
  trailY: 0.3,
  /** Normalised speed below which the trail is invisible (parked/slow = none). */
  trailSpeedFloor: 0.12,
  /** Peak trail opacity at top speed when cruising vs while drifting. */
  trailMaxOpacity: 0.5,
  trailDriftOpacity: 1.0,
  /** Per-second ease rate for trail opacity (smooth fade in/out). */
  trailOpacityRate: 8,
  /** Intensity below which the trail is hidden (avoids near-invisible draws). */
  trailMinIntensity: 0.003,
  /** Trail colours: cruising (cool) vs drifting (hot). */
  trailColor: 0x00ffff,
  trailDriftColor: 0xff2db8,
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
  /** Biome tone: engine lowpass cutoff (Hz) at biome tone 0 (dark) → 1 (bright),
   *  and the glide time constant (s) so biome transitions never click. */
  biomeToneLowHz: 520,
  biomeToneHighHz: 1200,
  biomeToneGlide: 0.4,
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
  /** Milestone fanfare: a brighter THREE-note ascending arpeggio (a bigger
   *  "achievement" than a pickup). Frequencies (Hz), per-note gain, gap between
   *  notes (s), and note decay/stop (s). */
  milestoneHz: [660, 880, 1320] as readonly number[],
  milestoneGain: 0.16,
  milestoneNoteGap: 0.085,
  milestoneDecay: 0.2,
  milestoneStop: 0.22,
} as const;

/**
 * Distance MILESTONES — a sense of progress within a run. Each is a one-shot
 * distance threshold that fires a celebratory reward, granted through the
 * EXISTING powerup / score hooks (no new special-casing): a milestone just
 * calls grantPowerup() or adds to the score, exactly like a collected pickup or
 * a ramp burst. Kept celebratory, not nagging — sparse and escalating.
 *
 * MUST stay sorted ascending by `distance` (the tracker fires them in order).
 * Biome changes get their OWN celebration, detected from the biome system's
 * advance rather than a hardcoded distance (see Milestones.ts), so they always
 * line up with the actual environment transition regardless of BIOME_CYCLE.span.
 */
export type MilestoneReward =
  | { readonly kind: 'powerup'; readonly powerup: PowerupKind }
  | { readonly kind: 'score'; readonly amount: number };

export interface Milestone {
  /** Stable id (test/debug). */
  readonly id: string;
  /** Distance threshold in metres; fires once when distance first reaches it. */
  readonly distance: number;
  /** Toast text shown when hit. */
  readonly label: string;
  /** Reward, routed through the existing powerup/score systems. */
  readonly reward: MilestoneReward;
}

export const MILESTONES: ReadonlyArray<Milestone> = [
  { id: 'm1000', distance: 1000, label: '1000m — +1000!', reward: { kind: 'score', amount: 1000 } },
  { id: 'm2000', distance: 2000, label: '2000m — +2000!', reward: { kind: 'score', amount: 2000 } },
  { id: 'm3000', distance: 3000, label: '3000m — +3000!', reward: { kind: 'score', amount: 3000 } },
  { id: 'm4000', distance: 4000, label: '4000m — +4000!', reward: { kind: 'score', amount: 4000 } },
  { id: 'm5000', distance: 5000, label: '5000m — LEGEND', reward: { kind: 'score', amount: 5000 } },
  { id: 'm7500', distance: 7500, label: '7500m — +7500!', reward: { kind: 'score', amount: 7500 } },
  { id: 'm10000', distance: 10000, label: '10,000m — +10,000!', reward: { kind: 'score', amount: 10000 } },
];

/**
 * Optional per-run OBJECTIVES — small self-directed goals shown subtly in the
 * HUD. Each counts a kind of event over the run and latches when its target is
 * reached (a quiet toast, no extra reward — they exist for the sense of a goal,
 * not to double-dip on powerups). The three ids map to existing per-step events
 * (near-miss / pickup-collected / ramp), so no new tracking is invented.
 */
export type ObjectiveId = 'nearMiss' | 'collect' | 'ramp';

export interface Objective {
  readonly id: ObjectiveId;
  readonly label: string;
  readonly target: number;
}

export const OBJECTIVES: ReadonlyArray<Objective> = [
  { id: 'nearMiss', label: 'Thread 5 near-misses', target: 5 },
  { id: 'collect', label: 'Collect 3 powerups', target: 3 },
  { id: 'ramp', label: 'Ride 2 ramps', target: 2 },
];

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

/** localStorage key for the persisted best run. LEGACY (pre-OPP-15): the
 *  single-best store. Still READ once on first load to MIGRATE the existing best
 *  into the leaderboard so a player's record run is never lost. */
export const STORAGE_KEY = 'neon-drift.best';

/** localStorage key for the OPP-15 leaderboard (top runs + per-car bests). */
export const LEADERBOARD_STORAGE_KEY = 'neon-drift.leaderboard';

/** Max entries kept on the top-runs leaderboard (sorted by score, desc). */
export const LEADERBOARD_SIZE = 10;

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

/**
 * Per-car SCORING tradeoff (OPP-07b) — SEPARATE from handling: handling is
 * physics, this is the scoring/near-miss loop. Two MULTIPLIERS, both 1.0 =
 * neutral (identical to base scoring), expressed as multipliers so they stay
 * correct regardless of SCORING / graze tuning:
 *   - buildMul  scales the near-miss combo WEIGHT (the registerNearMiss weight),
 *     composing ON TOP of the mover / gate / drift / graze multipliers — it does
 *     NOT replace any of them. >1 builds the combo faster per near-miss.
 *   - windowMul scales the combo SURVIVAL WINDOW (the comboTimeout refresh) —
 *     <1 means the combo decays back to base sooner after a dry spell. (There is
 *     no gradual decay RATE in the sim; the window is the only decay lever.)
 *
 * The two axes are OPPOSED (see CAR_SCORING_TABLE): every non-pulse car gives up
 * one to gain the other, so NO car wins BOTH axes — the fairness invariant
 * (buildMul>=1 AND windowMul>=1 together would be a strict scoring win). These
 * balance in CHARACTER at a reference near-miss density, NOT in total on every
 * seed: a build-heavy car out-scores on a near-miss-dense run and loses on a
 * sparse one. That playstyle expression is the point, not a fairness bug.
 */
export interface CarScoring {
  /** Multiplier on the near-miss combo weight. >1 = combo builds faster. */
  buildMul: number;
  /** Multiplier on the combo survival window (comboTimeout). <1 = fades sooner. */
  windowMul: number;
}

/** Neutral scoring: identical to base behaviour on both axes. Used for any car
 *  with no `scoring` block or an unknown id — Pulse and the fallback are 1 / 1. */
export const BASE_SCORING: CarScoring = { buildMul: 1, windowMul: 1 };

/*
 * PER-CAR SCORING TRADEOFF (OPP-07b) — opposed build/window axis, reviewable:
 *
 *   car         buildMul  windowMul   playstyle
 *   Pulse         1.00      1.00      neutral baseline (the fair reference)
 *   Ghost         1.25      0.75      builds fast, fades fast — high-skill sustain
 *   Onyx          0.80      1.35      builds slow, lasts long — steady scorer
 *   Nova          1.30      0.70      fastest build, shortest window — boom or bust
 *   Vapor         0.85      1.25      patient build, forgiving window
 *   Ember         1.20      0.80      aggressive build, short fuse
 *   Slipstream    1.15      0.85      rally rhythm — mild aggressive
 *
 * Desirability (↑good): buildMul↑ (faster combo), windowMul↑ (combo lasts).
 * No row is ≥ Pulse on BOTH axes, and no car has buildMul>=1 AND windowMul>=1
 * together, so none nets a strict scoring win — each trades one axis for the
 * other. Pulse trades nothing but is beaten on each axis by that axis's
 * specialist (it simply never loses an axis either).
 */

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
  /** Body color — a DEEP but clearly-hued tint of the car's signature, so the
   *  whole silhouette carries the identity colour (not a near-black shape). The
   *  brighter emissive `glow` still reads as the neon edge on top of it. */
  body: number;
  /** Edge / wireframe glow color — the car's signature. */
  glow: number;
  /** Side-strip / accent color. */
  accent: number;
}

export interface CarDef {
  id: string;
  displayName: string;
  /** Short identity descriptor (<~6 words) shown in the picker so the car's
   *  handling tradeoff is READABLE, not just felt. */
  tagline?: string;
  /** Short SCORING-playstyle descriptor (OPP-07b) shown in the picker beneath
   *  the handling tagline, so the combo build/window tradeoff is READABLE too. */
  scoringTagline?: string;
  cosmetic: CarCosmetic;
  /** Optional — absent this PR; all cars share VEHICLE physics for now. */
  handling?: CarHandling;
  /** Optional per-car SCORING tradeoff (OPP-07b). Absent → BASE_SCORING (neutral
   *  1/1), so Pulse and any unset car score identically to the base loop. */
  scoring?: CarScoring;
  /** Per-car VISUAL silhouette (rendering only). Absent → BASE_CAR_SHAPE. The
   *  collision box stays CAR_VIS for every car (fairness lives in `handling`);
   *  this only changes how the car READS so its shape telegraphs its feel. */
  shape?: CarShape;
}

/**
 * Per-car VISUAL geometry profile (rendering only — NOT the collision box, which
 * is always CAR_VIS). Drives the procedural CarMesh builder so each car has a
 * distinct silhouette that telegraphs its handling: speed → long/low/sharp,
 * grip → wide/planted/blunt, drift → short/compact/tall. All values scale the
 * shared CAR_GEO base; the same builder produces the in-game car and the picker
 * preview, so what you preview is what you drive.
 */
export interface CarShape {
  /** Overall visual length scale vs CAR_VIS.length. >1 = longer. */
  lengthMul: number;
  /** Overall visual width scale vs CAR_VIS.width. >1 = wider. */
  widthMul: number;
  /** Overall visual height scale vs CAR_VIS.height. >1 = taller. */
  heightMul: number;
  /** Front hull width as a fraction of rear width — LOWER = sharper wedge nose. */
  noseFraction: number;
  /** Cabin length as a fraction of car length. */
  cabinLengthFraction: number;
  /** Cabin height as a fraction of car height. */
  cabinHeightFraction: number;
  /** Cabin centre offset toward the REAR, fraction of half-length (+ = back). */
  cabinRearOffset: number;
  /** Wheel radius scale vs the CAR_GEO base (bigger = beefier/kart-like). */
  wheelRadiusMul: number;
}

/** Fallback shape — the balanced "classic" silhouette (Pulse). Used for any car
 *  with no `shape` block or an unknown id, so the builder never sees undefined. */
export const BASE_CAR_SHAPE: CarShape = {
  lengthMul: 1.0,
  widthMul: 1.0,
  heightMul: 1.0,
  noseFraction: 0.66,
  cabinLengthFraction: 0.42,
  cabinHeightFraction: 0.5,
  cabinRearOffset: 0.18,
  wheelRadiusMul: 1.0,
};

/** Resolve a car's visual shape, falling back to the base silhouette. */
export function carShape(car: CarDef): CarShape {
  return car.shape ?? BASE_CAR_SHAPE;
}

export const CARS: readonly CarDef[] = [
  {
    id: 'pulse',
    displayName: 'Pulse',
    tagline: 'Balanced — no weakness, no edge.',
    scoringTagline: 'Combo scores by the book.',
    // Neutral scoring baseline — the fair reference every other car deviates from.
    scoring: { buildMul: 1.0, windowMul: 1.0 },
    cosmetic: { body: 0x0a5560, glow: 0x00ffff, accent: 0xff00ff },
    // Balanced all-rounder: no weakness, no specialty. The 1.0 reference point —
    // unchanged by OPP-07a (the others widen away from it).
    handling: { speedCap: 1.0, lateralAccel: 1.0, lateralFriction: 1.0, drift: 1.0 },
    // Classic mid silhouette — the visual reference the others deviate from.
    shape: {
      lengthMul: 1.0, widthMul: 1.0, heightMul: 1.0, noseFraction: 0.66,
      cabinLengthFraction: 0.42, cabinHeightFraction: 0.5, cabinRearOffset: 0.18, wheelRadiusMul: 1.0,
    },
  },
  {
    id: 'vapor',
    displayName: 'Vapor',
    tagline: 'Razor grip, low top speed.',
    scoringTagline: 'Patient combo, forgiving window.',
    // Grip identity carried into scoring: builds slower but the combo lingers —
    // a precise, unhurried scorer that doesn't punish a quiet stretch.
    scoring: { buildMul: 0.85, windowMul: 1.25 },
    cosmetic: { body: 0x6e1a60, glow: 0xff00ff, accent: 0x00ffff },
    // Grip / precision: snappy, planted steering — but the slowest, and its
    // handbrake barely slides (you place it, you don't drift it).
    // OPP-07a widen (was 0.90/1.25/0.70/0.85): sharpen the grip+slow identity.
    handling: { speedCap: 0.84, lateralAccel: 1.4, lateralFriction: 0.55, drift: 0.78 },
    // GRIP look: wide, low, planted, blunt nose, beefy wheels — reads stable.
    shape: {
      lengthMul: 0.95, widthMul: 1.15, heightMul: 0.82, noseFraction: 0.82,
      cabinLengthFraction: 0.46, cabinHeightFraction: 0.44, cabinRearOffset: 0.1, wheelRadiusMul: 1.15,
    },
  },
  {
    id: 'ember',
    displayName: 'Ember',
    tagline: 'Fast and loose — hard to place.',
    scoringTagline: 'Aggressive combo, short fuse.',
    // Fast-and-loose identity: combo builds quick but the window is short — you
    // have to keep feeding near-misses or it slips away (matches the twitchy feel).
    scoring: { buildMul: 1.2, windowMul: 0.8 },
    cosmetic: { body: 0x6e3208, glow: 0xff6600, accent: 0xff00ff },
    // Speed / twitchy: high top speed, but sluggish steering and a loose tail
    // — fast in a straight line, a handful to place laterally.
    // OPP-07a widen (was 1.18/0.85/1.20/1.00): sharpen the fast+loose identity.
    handling: { speedCap: 1.28, lateralAccel: 0.78, lateralFriction: 1.35, drift: 1.0 },
    // SPEED look: long, low, sleek, sharp nose, long hood (cabin set back).
    shape: {
      lengthMul: 1.18, widthMul: 0.92, heightMul: 0.82, noseFraction: 0.5,
      cabinLengthFraction: 0.36, cabinHeightFraction: 0.46, cabinRearOffset: 0.3, wheelRadiusMul: 0.95,
    },
  },
  {
    id: 'ghost',
    displayName: 'Ghost',
    tagline: 'Holds drifts forever. Commits hard.',
    scoringTagline: 'Combo builds fast, fades fast.',
    // Drift-commit identity in scoring: the strongest build of any car, paid for
    // with the shortest survival window — a high-skill sustain car that rewards
    // relentless near-misses and punishes coasting.
    scoring: { buildMul: 1.25, windowMul: 0.75 },
    cosmetic: { body: 0x46606e, glow: 0xffffff, accent: 0x00ffff },
    // Drift specialist: massive handbrake slide for stylish dodges, at the cost
    // of a little top speed and steering bite vs the balanced Pulse.
    // OPP-07a widen (was 0.95/0.95/1.10/1.45): sharpen the drift identity.
    handling: { speedCap: 0.92, lateralAccel: 0.92, lateralFriction: 1.2, drift: 1.65 },
    // DRIFT look: short, compact, tall kart with big wheels — reads tossable.
    shape: {
      lengthMul: 0.82, widthMul: 0.95, heightMul: 1.08, noseFraction: 0.7,
      cabinLengthFraction: 0.48, cabinHeightFraction: 0.62, cabinRearOffset: 0.05, wheelRadiusMul: 1.18,
    },
  },
  {
    id: 'nova',
    displayName: 'Nova',
    tagline: 'All top speed, no grip.',
    scoringTagline: 'Boom or bust — feed it or lose it.',
    // Glass-cannon identity in scoring: the fastest combo build AND the shortest
    // window — the most extreme of the boom-or-bust pair (vs Ghost). Spikes hard
    // when you're threading, collapses the instant you stop.
    scoring: { buildMul: 1.3, windowMul: 0.7 },
    cosmetic: { body: 0x202e7e, glow: 0x4d6bff, accent: 0x00ffff },
    // GLASS CANNON: the speed-cap ceiling, but almost no steering authority and a
    // loose tail — a straight-line terror you can barely place. Ember is only
    // mildly fast and stays controllable; Nova trades nearly all grip for the top end.
    // OPP-07a widen (was 1.25/0.70/1.25/0.90): sharpen the glass-cannon identity.
    handling: { speedCap: 1.38, lateralAccel: 0.6, lateralFriction: 1.4, drift: 0.88 },
    // SPEED EXTREME look: longest, lowest, sharpest — a dragster with a tiny
    // canopy set far back. The most extreme of the long-low pair (vs Ember).
    shape: {
      lengthMul: 1.3, widthMul: 0.86, heightMul: 0.72, noseFraction: 0.4,
      cabinLengthFraction: 0.3, cabinHeightFraction: 0.42, cabinRearOffset: 0.34, wheelRadiusMul: 0.92,
    },
  },
  {
    id: 'onyx',
    displayName: 'Onyx',
    tagline: 'Surgical grip. Pins any gap.',
    scoringTagline: 'Slow to build, hard to lose.',
    // Surgical identity in scoring: the slowest combo build, but by far the
    // longest window — the steady-scorer extreme (vs Vapor). Forgives dry
    // stretches; rewards patient, consistent placement over spikes.
    scoring: { buildMul: 0.8, windowMul: 1.35 },
    cosmetic: { body: 0x4a1f70, glow: 0xb84dff, accent: 0x00ffaa },
    // SURGICAL: maxes grip (sharpest accel + tightest settle) and kills the slide,
    // paying with the lowest top speed — pin it in any gap. The precision extreme
    // beyond Vapor.
    // OPP-07a widen (was 0.88/1.45/0.60/0.80): sharpen the surgical-grip identity.
    handling: { speedCap: 0.82, lateralAccel: 1.62, lateralFriction: 0.45, drift: 0.74 },
    // GRIP EXTREME look: widest, lowest, bluntest — a planted brick with big
    // wheels. The most extreme of the wide-low pair (vs Vapor).
    shape: {
      lengthMul: 0.9, widthMul: 1.22, heightMul: 0.76, noseFraction: 0.9,
      cabinLengthFraction: 0.5, cabinHeightFraction: 0.42, cabinRearOffset: 0.08, wheelRadiusMul: 1.2,
    },
  },
  {
    id: 'slipstream',
    displayName: 'Slipstream',
    tagline: 'Fast and slidey — rally power-slides.',
    scoringTagline: 'Rally rhythm — keep it flowing.',
    // Rally-hybrid identity in scoring: a mild build-aggressive lean with a
    // slightly short window — rewards a steady flow of near-misses without the
    // knife-edge of Nova/Ghost. Sits between the aggressive and steady camps.
    scoring: { buildMul: 1.15, windowMul: 0.85 },
    cosmetic: { body: 0x3c5e0a, glow: 0xaaff00, accent: 0xff0066 },
    // RALLY HYBRID: fast AND slidey with loose grip — power-slides through gaps,
    // but committed steering. Fills the empty speed+drift corner (Ghost drifts but
    // is slow; Ember is fast but doesn't slide).
    // OPP-07a widen (was 1.10/0.90/1.15/1.40): sharpen the rally-hybrid identity.
    handling: { speedCap: 1.16, lateralAccel: 0.86, lateralFriction: 1.28, drift: 1.58 },
    // RALLY look: tall, chunky, big wheels, medium nose — speed+drift hybrid that
    // reads as a beefy rally car, distinct from sleek Ember and compact Ghost.
    shape: {
      lengthMul: 1.08, widthMul: 1.06, heightMul: 1.08, noseFraction: 0.64,
      cabinLengthFraction: 0.44, cabinHeightFraction: 0.58, cabinRearOffset: 0.16, wheelRadiusMul: 1.12,
    },
  },
] as const;

/** Default selected car — the first in the list. */
export const DEFAULT_CAR_ID = CARS[0].id;

/** The starter car: always unlocked, can never be gated. */
export const STARTER_CAR_ID = CARS[0].id;

/** localStorage key for cross-run progression (lifetime stats + unlocked cars). */
export const PROGRESS_STORAGE_KEY = 'neon-drift.progress';

/**
 * Lifetime (cross-run) stats that drive unlocks. Accumulated at the end of each
 * run and persisted; the unlock evaluation is a pure function of these.
 */
export interface LifetimeStats {
  /** Cumulative distance driven across all runs (world units ≈ metres). */
  totalDistance: number;
  /** Highest combo multiplier ever reached. */
  bestCombo: number;
  /** Total powerups collected across all runs. */
  powerupsCollected: number;
  /** Most distinct biomes seen in a single run (1..BIOMES.length). */
  biomesSeen: number;
}
export type LifetimeStatKey = keyof LifetimeStats;

/** A fresh, zeroed lifetime-stats record (the "new player" baseline). */
export const EMPTY_LIFETIME_STATS: LifetimeStats = {
  totalDistance: 0,
  bestCombo: 0,
  powerupsCollected: 0,
  biomesSeen: 0,
};

/** An unlock condition: a lifetime stat meeting a threshold, with a player-facing
 *  label. `null` condition = always unlocked (the starter). */
export interface UnlockCondition {
  stat: LifetimeStatKey;
  atLeast: number;
  label: string;
}
export interface CarUnlock {
  carId: string;
  condition: UnlockCondition | null;
}

/**
 * UNLOCK TABLE — the long-term progression hook. The starter is always free; the
 * rest unlock from lifetime achievements spanning three different stats, so a
 * player always has a next goal and no single play style gates everything.
 * Thresholds are tuned to be reachable in a handful of runs (not grindy).
 */
export const CAR_UNLOCKS: readonly CarUnlock[] = [
  { carId: 'pulse', condition: null }, // starter — balanced all-rounder
  {
    carId: 'vapor',
    condition: { stat: 'totalDistance', atLeast: 2500, label: 'Drive 2,500m total' },
  },
  {
    carId: 'ember',
    condition: { stat: 'powerupsCollected', atLeast: 30, label: 'Collect 30 powerups' },
  },
  {
    carId: 'ghost',
    condition: { stat: 'bestCombo', atLeast: 6, label: 'Hit an ×6 combo' },
  },
  // New cars unlock from deeper achievements. They reuse the existing three
  // stats at higher tiers and add the one stat nothing used yet (biomesSeen),
  // so all four lifetime stats now drive progression and each new car has a
  // distinct, harder goal than the original it extends.
  {
    carId: 'onyx',
    condition: { stat: 'powerupsCollected', atLeast: 75, label: 'Collect 75 powerups' },
  },
  {
    carId: 'nova',
    condition: { stat: 'bestCombo', atLeast: 10, label: 'Hit an ×10 combo' },
  },
  {
    carId: 'slipstream',
    condition: { stat: 'biomesSeen', atLeast: 4, label: 'See all 4 biomes in one run' },
  },
] as const;

/**
 * ACROSS-RUN MISSION + RANK PROGRESSION — the layered meta-progression. This is
 * NEVER a gameplay gate: the endless run is fully playable from Rookie, and every
 * reward here is COSMETIC / OPTIONAL (a title, or an optional starting-biome
 * visual). Missions accrue across runs and commit at run end (crash included);
 * rank advances as missions complete. See state/Missions.ts for the pure logic.
 */
export const MISSIONS_STORAGE_KEY = 'neon-drift.missions';

/** How many missions are active (and shown) at once. */
export const MISSION_ACTIVE_COUNT = 3;

/** Minimum speed (world units/s) at which a held handbrake counts as drifting,
 *  for the drift-time missions. */
export const DRIFT_MIN_SPEED = 1;

/** Cumulative lifetime counters the missions read (the store's own accumulators,
 *  independent of the car-unlock LifetimeStats). */
export interface MissionStats {
  nearMisses: number;
  powerups: number;
  shields: number;
  driftSeconds: number;
  midnightReaches: number;
  distance: number;
}
export type CumulativeMetric = keyof MissionStats;

export const EMPTY_MISSION_STATS: MissionStats = {
  nearMisses: 0,
  powerups: 0,
  shields: 0,
  driftSeconds: 0,
  midnightReaches: 0,
  distance: 0,
};

/**
 * A mission definition. `cumulative` missions track a lifetime counter from a
 * baseline snapped when the mission activates ("do N more"); `perRun` missions
 * complete when a single run's value meets the target.
 */
export type MissionDef =
  | { id: string; label: string; target: number; kind: 'cumulative'; metric: CumulativeMetric }
  | { id: string; label: string; target: number; kind: 'perRun'; metric: 'score' | 'distance' };

/** The mission pool. Active missions are drawn in order and the pool WRAPS, so
 *  there is always a next short-term goal (endless). Ordered to escalate. */
export const MISSION_POOL: readonly MissionDef[] = [
  { id: 'nm25', label: 'Thread 25 near-misses', target: 25, kind: 'cumulative', metric: 'nearMisses' },
  { id: 'pu15', label: 'Collect 15 powerups', target: 15, kind: 'cumulative', metric: 'powerups' },
  { id: 'sh5', label: 'Collect 5 shields', target: 5, kind: 'cumulative', metric: 'shields' },
  { id: 'dr20', label: 'Drift for 20s', target: 20, kind: 'cumulative', metric: 'driftSeconds' },
  { id: 'mid3', label: 'Reach the Midnight biome 3×', target: 3, kind: 'cumulative', metric: 'midnightReaches' },
  { id: 'run6k', label: 'Score 6,000 in one run', target: 6000, kind: 'perRun', metric: 'score' },
  { id: 'nm60', label: 'Thread 60 near-misses', target: 60, kind: 'cumulative', metric: 'nearMisses' },
  { id: 'pu40', label: 'Collect 40 powerups', target: 40, kind: 'cumulative', metric: 'powerups' },
  { id: 'dr60', label: 'Drift for 60s', target: 60, kind: 'cumulative', metric: 'driftSeconds' },
  { id: 'rd3k', label: 'Drive 3,000m in one run', target: 3000, kind: 'perRun', metric: 'distance' },
] as const;

/** A rank tier. `reward.startBiome` (a biome index) is an OPTIONAL cosmetic
 *  starting-visual unlock; `title` is bragging rights. Neither gates gameplay. */
export interface RankDef {
  name: string;
  /** Total missions that must be completed to hold this rank. */
  missionsRequired: number;
  reward: { title: string; startBiome?: number };
}

/** The rank ladder (ascending). Every MISSION_PER_RANK missions = one rank up. */
export const RANKS: readonly RankDef[] = [
  { name: 'Rookie', missionsRequired: 0, reward: { title: 'Rookie' } },
  { name: 'Cruiser', missionsRequired: 3, reward: { title: 'Cruiser', startBiome: 1 } }, // Midnight
  { name: 'Drifter', missionsRequired: 6, reward: { title: 'Drifter', startBiome: 2 } }, // Toxic
  { name: 'Veteran', missionsRequired: 9, reward: { title: 'Veteran', startBiome: 3 } }, // Dawn
  { name: 'Legend', missionsRequired: 12, reward: { title: 'Legend' } },
] as const;

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
 * Resolve the SCORING tradeoff for a car id (OPP-07b). Falls back to BASE_SCORING
 * (neutral 1/1) for an unknown id or a car with no `scoring` block — so the pure
 * sim always gets a complete, finite profile and Pulse scores like the base loop.
 */
export function scoringFor(id: string): CarScoring {
  return CARS.find((c) => c.id === id)?.scoring ?? BASE_SCORING;
}

/**
 * Normalisation ranges for the picker's Speed / Grip / Drift bars. The bars are
 * DERIVED from the same `handling` multipliers the sim uses (see carStats) — the
 * single source of truth — so they can never be hand-authored out of sync with
 * the physics. Chosen to span the roster's spread with a little headroom.
 */
export const CAR_STAT_RANGE = {
  // Widened alongside the OPP-07a handling spread (was 0.85-1.25 / 0.6-2.0 /
  // 0.8-1.5): the sharpened roster now spans wider raw values, and these ranges
  // must enclose it with headroom or multiple cars would clamp to identical
  // full/empty bars — defeating the legibility goal. Span the new extremes
  // (speedCap 0.82-1.38; grip ratio 0.43-3.6; drift 0.74-1.65) so every car's
  // bars stay distinct.
  speed: { min: 0.8, max: 1.4 },
  /** Grip = steering authority / how loose the car is = lateralAccel / lateralFriction. */
  grip: { min: 0.4, max: 3.7 },
  drift: { min: 0.72, max: 1.7 },
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
