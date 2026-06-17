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
  ahead: '#39ff14',
  behind: '#ff3b5c',
} as const;

/** Fixed simulation timestep, in seconds (the game updates at 60 Hz). */
export const TIMESTEP = 1 / 60;

/**
 * Maximum frame delta (seconds) fed to the loop. Caps catch-up after a
 * tab-switch / stall so the accumulator can't trigger a spiral of death.
 */
export const MAX_FRAME_DT = 0.25;

/**
 * SIM-MATH version (MP fix PR-B). Bumped whenever a change alters what a given seed +
 * input stream produces — so a SEED is only reproducible within the same version.
 * v1 = the de-floated transcendentals (detSin/detExp/detPow): the first build whose
 * sim is bit-identical across JS engines (V8/JSC). Stamped onto ghost recordings
 * (refused for replay if mismatched — an old-math ghost would desync from the live
 * sim), daily records, and leaderboard entries, so old-math artifacts are detectable
 * and never replayed/compared as if same-course.
 */
export const SIM_MATH_VERSION = 1;

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
  // (gateThreadWeight removed: gates no longer produce a near-miss — a gate is a
  //  pure obstacle now, thread-or-crash, in both classic and slalom. See Scoring
  //  resolveTraffic gate case.)
  /**
   * GRAZE GRADIENT (OPP-14, Psyvariar model): within the binary near-miss window
   * (nearMissLateral, now 4.0, is the OUTER bound), the reward scales with how
   * close the pass was. grazeMultiplier(gap) = 1.0 at the outer edge, ramping
   * linearly up to grazeMax as the gap shrinks to grazeInner (capped at grazeMax
   * below it — no runaway). It MULTIPLIES the existing combo weight (mover/drift
   * bonuses still apply).
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

/**
 * MP SHARED-COURSE spawning (2P race only). In a live race both cars must meet the
 * IDENTICAL obstacle/powerup field, so MP replaces the path-dependent spawner
 * (timer + spawn-ahead-of-this-car) with a POSITION-DETERMINISTIC one: the field is a
 * pure function of (seed, distance band) via hashNoise, so any car at distance D sees
 * the same thing regardless of speed/path. Single-player (classic/slalom) is UNTOUCHED
 * — this is a separate code path gated on state.mpRace. Obstacles are STATIONARY in MP
 * (movers-with-drift would need a shared frame clock — a follow-up); the kind mix still
 * uses the per-distance weights so the course still ramps. Density here is MP's own
 * (it intentionally does NOT reproduce classic's tuned time-based curve).
 */
export const MP_SPAWN = {
  /** Distance band width (world units). One obstacle slot per band, spawned-or-not. */
  bandWidth: 90,
  /** Powerups are rarer → a wider band. */
  powerupBandWidth: 220,
  /** Per-band spawn probability for traffic: ramps with distance for difficulty. */
  spawnProbBase: 0.62,
  spawnProbRamp: 0.00006,
  spawnProbMax: 0.9,
  /** Per-band spawn probability for powerups (flat — they're an occasional reward). */
  powerupSpawnProb: 0.5,
  /** Clear opening (world units) at the very start so the race doesn't begin on top
   *  of an obstacle (mirrors classic's spawn-ahead grace). */
  startGrace: 420,
} as const;

/**
 * MP RACE rules (2P race completion — MP-1 PR3-pt2). Win = FIRST to the finish
 * distance. The winner is decided in SHARED SIM TIME (the lowest frame at which a
 * car's distance >= finishDistance) — both peers simulate both cars in lockstep, so
 * they compute the identical result by construction (no UI check / no network race).
 */
export const MP_RACE = {
  /** Finish line distance (world units). First car to reach it wins. Tunable. */
  finishDistance: 10000,
  /** Lead-change deadband (world units): the rival must be ahead by more than this to
   *  flip the leader, so a near-dead-heat gap jittering around 0 doesn't spam the
   *  overtake alert. */
  leadChangeDeadband: 3,
  /** Duration (ms) the overtake/passed toast stays visible before fading. */
  toastDurationMs: 900,
  /** Past this fraction of the race, the leading finish-bar marker gets a subtle
   *  emphasis (the "approaching finish" climax). */
  progressNearFinishFraction: 0.9,
} as const;

/** Finish-line visual tuning (render-only — the actual finish is decided in MpRace). */
export const FINISH_LINE_VIS = {
  barHeight: 0.4,
  barDepth: 3,
  barY: 0.2,
  barOpacity: 0.85,
  pylonWidth: 0.8,
  pylonHeight: 9,
  pylonOpacity: 0.8,
  roadExtension: 2,
} as const;

/**
 * DAILY SLALOM mode tuning (Daily Slalom PR 1 — mode skeleton). The slalom is an
 * endless gates-only course at a CONSTANT speed (no distance ramp), so its feel
 * is set by two numbers: the fixed speed and the gate spacing. Reuses the GATE
 * opening width/position randomisation for the course itself.
 */
export const SLALOM = {
  /** Fixed forward speed (world units/s). A touch under the classic baseSpeedCap
   *  (70) so the course is brisk but readable; it never ramps. Tunable by feel. */
  constantSpeed: 64,
  /** Distance between consecutive gates (world units). The spawn cadence is
   *  DERIVED as gateSpacing / constantSpeed (≈ 1 gate/second at the values above),
   *  so the spatial spacing stays fixed regardless of the timestep. Tunable. */
  gateSpacing: 64,
  /** Lives (Daily Slalom PR 3): a gate-WALL miss costs one; the run ends only on
   *  the last. The "nursing a terrified streak" tension. */
  lives: 3,
} as const;

/**
 * DAILY SLALOM scoring (Daily Slalom PR 2). Per gate threaded:
 *   gatePoints = base × accuracyBonus × cleanMultiplier
 * where accuracyBonus = 1 + accuracyMaxBonus × centeredness (1.0 at the opening
 * edge → 1+accuracyMaxBonus dead-centre), and cleanMultiplier climbs by cleanStep
 * per consecutive clean gate (capped at cleanMax) and RESETS to cleanStart on a
 * miss. Clean-survival is the dominant (multiplicative) term — the reason to keep
 * a streak alive. The final daily score is the sum of gatePoints. No magic numbers.
 */
export const DAILY_SCORING = {
  /** Flat per-gate floor — the endurance points you bank for simply surviving. */
  base: 100,
  /** Max accuracy bonus: a dead-centre thread scores (1 + this)× a scrape. */
  accuracyMaxBonus: 1.0,
  /** cleanMultiplier starts here (first clean gate scores at this). */
  cleanStart: 1,
  /** Increment to cleanMultiplier per consecutive clean gate. */
  cleanStep: 1,
  /** Cap on cleanMultiplier — a long clean streak tops out here. */
  cleanMax: 8,
  /** A streak MILESTONE is crossed each time cleanMultiplier passes a multiple of
   *  this (e.g. ×4 and ×8 at step 1 / cap 8) — the rare, earned escalation point.
   *  A scoring-state fact (the pure layer flags the crossing); the feedback layer
   *  reacts with SLALOM_FX intensities. */
  milestoneStep: 4,
} as const;

/**
 * DAILY SLALOM feedback (Daily Slalom PR 2/3). Deliberately split: PER-GATE feedback
 * is SUBTLE (it fires every ~second — heavy feedback here was the noise problem we
 * removed with gate near-misses), while STREAK MILESTONES are pronounced (rare,
 * earned). A MISS (PR 3: lost a life, run continues) is a pronounced sting; the
 * FATAL miss is the full crash. No per-gate shake or slow-mo.
 */
export const SLALOM_FX = {
  /** Per-gate edge-glow pulse intensity (0..1), lerped by centeredness — a
   *  dead-centre thread reads a touch brighter than a scrape. Kept LOW. */
  gatePulseMin: 0.16,
  gatePulseMax: 0.42,
  /** Per-gate chime pitch, lerped by centeredness (crisper/higher dead-centre). */
  gatePitchMin: 1.0,
  gatePitchMax: 1.5,
  /** Streak-MILESTONE cue (crossing DAILY_SCORING.milestoneStep): a brighter edge
   *  pulse + a small one-off shake. This is where intensity belongs — rare/earned. */
  milestonePulse: 0.85,
  milestoneShake: 0.4,
  /** Non-fatal MISS sting (lost a life, run continues): a pronounced shake. Below
   *  the full crash shake (JUICE.shakeMagnitude) — the run isn't over. */
  missShake: 0.8,
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
 * (magenta + cyan); we add neon green to fill out the set. Three distinct hues
 * cover four pickups — slow-mo and magnet share green (distinguished by SHAPE:
 * octahedron vs horseshoe). All read as GOOD — the orange accent (#ff6600)
 * stays reserved for THREATS, never used on a pickup.
 */
export const POWERUP_COLORS = {
  shield: PALETTE.cyan, // 0x00ffff — cool/defensive
  slowmo: 0x39ff14, // neon green (matches magnet) — the old purple (0xb46bff) was
  // near-invisible on the deep-purple backdrop; distinguished from magnet by SHAPE
  // (slow-mo octahedron vs magnet horseshoe), not colour.
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
  /** SLOW-MO: most charges the player can BANK at once. Collecting a slow-mo
   *  pickup adds one (capped here); the DEPLOY control spends one on demand. */
  slowMoMaxCharges: 3,
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
  /**
   * HERO taillight bar (gfx PR2, player car only) — a bright emissive bar across the
   * rear in the car's glow colour. This is the signature outrun/Testarossa rear light
   * and, being a SOLID bright surface (not a 1px edge line), it catches the bloom
   * (#95) strongly so the player car reads as a glowing neon supercar. Render-only.
   */
  taillight: {
    /** Bar width as a fraction of the rear hull width. */
    widthFraction: 0.86,
    /** Bar thickness (world units, y). */
    height: 0.11,
    /** Bar depth (world units, z) — sits just proud of the rear face. */
    depth: 0.1,
    /** Bar centre height as a fraction of CAR_VIS.height (up the rear). */
    yFraction: 0.62,
    /** Emissive opacity (additive) — bright enough to bloom. */
    opacity: 0.95,
  },
  /** HERO underglow: the player car's ground glow is brighter than the rival's
   *  (visual focus on the hero). The simple (rival) build uses the base opacity. */
  heroGroundGlowMul: 1.7,
} as const;

/** Car render detail: 'hero' = the full detailed glowing supercar (the PLAYER); 'simple'
 *  = a stripped low-poly wedge (the RIVAL — distinct + cheaper, and the LOW-quality
 *  fallback for the player). */
export type CarDetail = 'hero' | 'simple';

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
  /** RAMP boost ramp: a low rising wedge on the road surface. */
  rampHeight: 0.5,
  rampY: 0.25,
  /**
   * DETAILED obstacle silhouettes (HIGH quality). Each kind gets its own SHARED
   * instanced geometry, authored in a normalized [-0.5,0.5]^3 cube and instance-
   * scaled to the collision footprint — so a richer SHAPE reads as a believable
   * object WITHOUT ever exceeding the hitbox. Detail is geometry (vertex cost,
   * cheap at scale) + per-face vertex shading; NO glow/bloom fill (#99's neon edge
   * outline was pulled back — detail comes from FORM, not luminance). Per-face
   * shades multiply the per-instance threat tint: top brightest → underside
   * darkest, so each object reads as lit and solid. Sides reuse `bodyShade`.
   */
  shadeTop: 1.0,
  shadeFront: 0.92,
  shadeBack: 0.5,
  shadeBottom: 0.32,
  /** STATIC = flared road barrier (jersey-ish): full-width base tapering to a
   *  narrower top (inset half-extents in the normalized cube). */
  barrierTopHalfX: 0.34,
  barrierTopHalfZ: 0.42,
  /** MOVER = low vehicle: a body slab up to bodyTopY with a set-back cabin
   *  (greenhouse) above it — reads as moving traffic, not a block. */
  vehicleBodyTopY: 0.0,
  vehicleCabinHalfX: 0.34,
  vehicleCabinZ0: -0.34,
  vehicleCabinZ1: 0.16,
  vehicleCabinTopY: 0.42,
  /** GATE bar = capped barrier post: a vertical body up to shoulderY, then a
   *  chamfered cap tapering to capHalf — reads as a built gate structure. */
  postShoulderY: 0.36,
  postCapHalf: 0.36,
  /** RAMP = rising wedge: a low lip at the near (+z) edge climbing to full height
   *  at the far (-z) edge, so it reads as a launch ramp instead of a flat slab. */
  rampLipY: -0.3,
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
  /**
   * HIGH-quality silhouettes/accents (gfx). Each layer keeps its MUTED body colour +
   * low opacity (BUG-01: decor must stay quieter than the orange/red hazards); the only
   * bright bits are SMALL accents (a lamp cap, a few windows) that read as light without
   * out-shouting obstacles. LOW falls back to the plain box pillar. Cheap: richer SHARED
   * geometry per layer (1 instanced draw call each, unchanged) — no extra meshes.
   */
  detail: {
    /** Near 'pylon' → an outrun PALM silhouette (trunk + a fan of frond triangles),
     *  all in the layer's muted colour — a recognisable shape, NOT a glowing thing. */
    palm: {
      trunkWidth: 0.32,
      trunkHeightFrac: 0.6, // of layer.height
      frondLenFrac: 0.36, // of layer.height
      frondHalfWidth: 0.16,
      /** Frond tips as [dx, dy] fractions of frond length, fanned around the crown. */
      frondTips: [
        [-1.0, 0.25], [-0.6, 0.8], [0.0, 1.0], [0.6, 0.8], [1.0, 0.25],
      ],
    },
    /** Mid 'pole' → a thin light-pole + a SMALL bright cap (a lit lamp) that catches
     *  the bloom — a tiny accent, kept small so it stays subordinate. */
    pole: {
      shaftWidthFrac: 0.4, // of layer.width
      shaftHeightFrac: 0.94, // of layer.height (cap sits on top)
      capColor: 0x00ffff, // bright on-palette cyan lamp
      capWidthFrac: 0.9, // of layer.width
      capHeight: 0.6,
    },
    /** Far 'block' → a city block + a few DIM window dots (subtle — it's background
     *  haze; deliberately under-bright so it never competes with hazards). */
    block: {
      windowColor: 0x2f8fb0, // muted lit-window blue-cyan (NOT full bright)
      windowSize: 0.9,
      windowZOffset: 0.05, // just proud of the +z face to avoid z-fighting
      /** Window centres as [xFrac, yFrac] of the block's half-width / height, on +z. */
      windows: [
        [-0.45, 0.7], [0.4, 0.55], [-0.2, 0.35], [0.5, 0.85],
      ],
    },
  },
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

/**
 * ZEN-LOCAL biome palettes — the free-roam world's themed REGIONS. Distinct from
 * the racing `BIOMES` on purpose: Zen is about SERENITY, so every biome here reads
 * calm. The big change is the old acid-green "Toxic" wasteland → a CALM aurora-green
 * (slot 2, `aurora`): same green family, but desaturated + deepened so it glows
 * gently instead of buzzing. Keeping a Zen-local copy (rather than mutating `BIOMES`)
 * leaves the racing look untouched AND lets Zen tune any biome for calm independently.
 *
 * ORDER MATTERS: `biomeAt` maps a low-frequency noise field's AMPLITUDE to these
 * indices (valleys → slot 0, peaks → slot 3), and value-noise spends most of its
 * time mid-range — so the two everyday-calm biomes (Midnight night, Aurora) sit in
 * the common middle slots (1, 2) and the two "special" looks (Sunset basins, Dawn
 * summits) sit at the rarer extremes (0, 3). The cycle's 3↔0 seam (Dawn↔Sunset) thus
 * never borders directly in space (peaks don't touch valleys) — no jarring jump.
 */
export const ZEN_BIOMES: readonly BiomeDef[] = [
  {
    id: 'sunset',
    displayName: 'Sunset',
    gradient: SUN.gradient,
    gridCenter: PALETTE.magenta,
    gridLine: PALETTE.cyan,
    fog: PALETTE.deepPurple,
    mountain: PALETTE.cyan,
    starIntensity: 0.0,
    accent: 0xff66ff,
    audioTone: 0.7,
  },
  {
    id: 'midnight',
    displayName: 'Midnight',
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
    starIntensity: 1.0,
    accent: 0x6688ff,
    audioTone: 0.15,
  },
  {
    id: 'aurora',
    displayName: 'Aurora',
    // RETINTED from racing 'Toxic': the acid wasteland (#9bff3a / 0x00ff88) softened
    // to a serene forest-aurora green — desaturated + deepened so it reads as a calm
    // green night with a gentle glow, not a hazard zone.
    gradient: [
      { at: 0.0, color: '#bdf5d6' },
      { at: 0.3, color: '#79d9a6' },
      { at: 0.58, color: '#3fae84' },
      { at: 0.82, color: '#1c6f56' },
      { at: 1.0, color: '#04130d' },
    ],
    gridCenter: 0x66e6a8,
    gridLine: 0x33b98a,
    fog: 0x07180f,
    mountain: 0x4ec99a,
    starIntensity: 0.55, // aurora night — stars glow through
    accent: 0x8af0bf,
    audioTone: 0.5,
  },
  {
    id: 'dawn',
    displayName: 'Dawn',
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
    starIntensity: 0.1,
    accent: 0xffaa88,
    audioTone: 0.85,
  },
] as const;

/**
 * Zen SECRET-AREA palette — a distinct, dreamlike VIOLET VOID look forced while you're inside a
 * secret area (NOT part of the cycling ZEN_BIOMES, so it doesn't affect region selection). PR1's
 * "you can SEE you're somewhere else": the same world streams around you, but tinted to this
 * ethereal palette so the secret region reads as a place apart. Same BiomeDef shape as ZEN_BIOMES.
 */
export const ZEN_SECRET_BIOME: BiomeDef = {
  id: 'secret-void',
  displayName: 'Secret Void',
  gradient: [
    { at: 0.0, color: '#f3ecff' },
    { at: 0.3, color: '#cbb8ff' },
    { at: 0.58, color: '#9d8aff' },
    { at: 0.82, color: '#5a4a9a' },
    { at: 1.0, color: '#0a0420' },
  ],
  gridCenter: 0xe0d0ff,
  gridLine: 0xb0a0ff,
  fog: 0x100a2a,
  mountain: 0x9080d0,
  starIntensity: 0.95, // a dreamy full sky
  accent: 0xd0c0ff,
  audioTone: 0.6,
};

/**
 * Zen SECRET AREAS (PR1 vertical slice). Reaching a portal (a GATEWAY) TELEPORTS the car to a far,
 * deterministic coordinate band — the infinite position-deterministic world simply regenerates
 * around you (existing streaming) — hidden under a FADE so there's no in-world transition to
 * mis-render (the #127 tunnel-camera lesson). The only world state is the ZenVehicle, so save/
 * restore is ~7 numbers. PR1 = ONE fixed region (placeholder palette); beauty/variety come later.
 */
/**
 * Zen TUNNEL-PAYOFF palette — a distinct DEEP-AMBER/GOLD void forced while inside the tunnel's bottom
 * payoff space (Stage 4 of docs/zen-tunnel-interesting-recon.md). Deliberately DIFFERENT from the
 * gateway secret area's violet (ZEN_SECRET_BIOME) so the two hidden spaces read as distinct places. It
 * echoes the tunnel's deep-end gold. (Slice palette — a plain distinct look; beauty is a follow-up.)
 */
export const ZEN_TUNNEL_SECRET_BIOME: BiomeDef = {
  id: 'tunnel-deep',
  displayName: 'Deep Tunnel',
  gradient: [
    { at: 0.0, color: '#fff3d6' },
    { at: 0.3, color: '#ffcc66' },
    { at: 0.58, color: '#cc7a1f' },
    { at: 0.82, color: '#5a2f0a' },
    { at: 1.0, color: '#150a02' },
  ],
  gridCenter: 0xffd98a,
  gridLine: 0xffaa44,
  fog: 0x1a0f04,
  mountain: 0xb87a30,
  starIntensity: 0.2,
  accent: 0xffb050,
  audioTone: 0.35,
};

/**
 * Zen TUNNEL BOTTOM-PAYOFF (Stage 4 vertical slice). Descending a tunnel to its DEEP POINT warps the
 * car to a NEW distinct tunnel-themed region (a far coordinate band, separate from the gateway secret
 * area), explore it, then a return portal (its nearest GATEWAY) brings you back NEAR THE TUNNEL
 * ENTRANCE (re-runnable). Reuses the #129/#130 fade/teleport/safe-arrival machinery. Slice: a plain
 * distinct space (the beautiful tunnel-themed build is a follow-up).
 */
export const ZEN_TUNNEL_SECRET = {
  /** Far base coordinate the tunnel-payoff region sits near — a DIFFERENT band from the gateway
   *  secret region (640000, -480000), so the two spaces are distinct places. Its nearest GATEWAY is
   *  the arrival + return portal. */
  regionX: -520000,
  regionZ: 600000,
  /** After arriving back near the tunnel entrance, ignore re-triggers until driven this far clear —
   *  a bit larger than the gateway guard so a fresh descent is deliberate, not an instant re-loop. */
  returnGuardDistance: 160,
} as const;

/**
 * Zen TUNNEL CAVERN — the BEAUTIFUL build of the tunnel payoff space (Stage 4 follow-up). A vast
 * amber/gold underground cavern you EMERGE into: a striking CENTERPIECE spire straight ahead (the awe
 * moment), MONUMENTS scattered around the open floor to drive toward + carve around, and a distant
 * enclosing SHELL of pillars + an overhead ceiling dome that sells the "huge enclosed space". ALL
 * visual/decorative neon line-work on the EXISTING flat drivable ground (anchored to heightAt) — NO
 * terrain sculpting, NO new drivable surface (surfaceUnder untouched). Bloom-lit (#128); fog:false so
 * the gold reads across the haze. Built once, shown only while inside the tunnel space.
 */
export const ZEN_TUNNEL_CAVERN = {
  /** Centerpiece distance from the return portal along its through-axis (the inward direction the car
   *  FACES on arrival — arrivalPose) so you emerge looking straight at it. (Arrival sits 80u in.) */
  centerDist: 460,
  /** The CENTERPIECE spire: a tall tapering stack of amber rings + vertical edges + a base halo. */
  centerpieceHeight: 130,
  centerpieceBaseRadius: 34,
  centerpieceRings: 7,
  centerpieceSegments: 16,
  centerpieceHaloRadius: 60,
  /** MONUMENTS: structures scattered (seeded) around the centerpiece — landmarks to weave through. */
  monumentCount: 12,
  monumentMinRadius: 180, // keep them off the centerpiece...
  monumentMaxRadius: 760, // ...and within the open inner floor
  monumentMinHeight: 30,
  monumentMaxHeight: 92,
  monumentSegments: 6, // a faceted obelisk cross-section
  /** Enclosing SHELL: a far ring of tall pillars that walls the vast space (visual only — no collision). */
  shellCount: 28,
  shellRadius: 1900,
  shellHeight: 260,
  /** Overhead CEILING dome (line arcs converging above the centre) — the "roof" of the cavern. */
  ceilingRadius: 2000,
  ceilingHeight: 640,
  ceilingRings: 4, // latitude arcs
  ceilingMeridians: 16, // longitude arcs
  ceilingSegments: 24,
  /** Monument cross-section radius range (the footprint of each scattered obelisk). */
  monumentMinBaseRadius: 8,
  monumentMaxBaseRadius: 18,
  /** Enclosing shell pillar cross-section radius + ring segment count. */
  shellPillarRadius: 14,
  shellPillarSegments: 5,
  /** Meridian arc subdivision steps (how many segments each longitude arc uses). */
  ceilingMeridianSteps: 6,
  /** A bright halo ring around the RETURN PORTAL so it READS as the clear way back amid the amber. */
  portalMarkerRadius: 62,
  portalMarkerSegments: 24,
  portalMarkerUprights: 8,
  portalMarkerHeight: 16,
  portalMarkerColor: 0x00ffff, // cyan — pops against the all-amber cavern (= "the exit")
  /** Amber/gold palette the cavern neon is drawn from (per-structure pick, bloom-lit). */
  amberPalette: [0xffcc33, 0xff9a3c, 0xffe08a],
} as const;

export const ZEN_SECRET = {
  /** Far base coordinate the secret region sits near — well beyond normal roam (its nearest
   *  GATEWAY becomes the arrival + return portal). Fixed for the slice. */
  regionX: 640000,
  regionZ: -480000,
  /** Distance (world units) the car arrives OFF the portal (it faces AWAY, into the region, so you
   *  drive deeper to explore — the portal is behind you). */
  arrivalApproach: 80,
  /** After a warp, ignore gateway crossings until the car has travelled this far from where it
   *  arrived — so you can't instantly re-cross the portal you just used (the bounce guard). */
  returnGuardDistance: 130,
  /** Fade-to-opaque (entering the warp) + fade-back (arriving) durations (seconds). The teleport +
   *  one-frame chunk reload happen at the opaque midpoint, fully hidden. */
  fadeOutSeconds: 0.35,
  fadeInSeconds: 0.55,
  /** Fade overlay colour (a soft luminous white — a gentle whiteout, not a harsh cut). */
  fadeColor: '#f3ecff',
} as const;

/**
 * Per-biome TERRAIN CHARACTER params (indexed parallel to ZEN_BIOMES). heightAt blends
 * these by the SAME biomeAt weight that drives the look, so the world FEELS different to
 * drive per region — not just looks different. PRONOUNCED contrast (really flat plains vs
 * really peaky mountains) but all CALM-compatible: even Dawn's peaks are smooth gentle arcs,
 * never treacherous. Craig dials each biome's feel here on his phone.
 *
 * Mapping (ZEN_BIOMES order — sunset, midnight, aurora, dawn):
 *   SUNSET  → rolling hills  : the current baseline ("home" feel, unchanged).
 *   MIDNIGHT→ flat plains    : low relief, no mountains — a serene near-flat night cruise.
 *   AURORA  → gentle dunes   : broad soft swells (bigger amplitude, lower frequency), no peaks.
 *   DAWN    → peaky mountains: taller + more-frequent peaks — the most crest-air, still calm.
 */
export interface ZenBiomeTerrain {
  /** Rolling-hills amplitude (world units) — the octave-0 relief height. Low = flat plains,
   *  high = big dune swells. (Replaces the global terrainAmplitude per biome.) */
  hillAmplitude: number;
  /** Multiplier on the hill base frequency (× ZEN.terrainFrequency). <1 = broader, smoother
   *  swells (dunes); 1 = the baseline rolling-hill wavelength. */
  hillFrequencyMul: number;
  /** Multiplier on the mountain term (mask × mountainAmplitude × ridged). 0 = NO mountains
   *  (flat/dune biomes); 1 = the baseline occasional peaks; >1 = taller, more dramatic. */
  mountainAmount: number;
  /** Added to the mountain mask before its threshold — widens mountain COVERAGE. 0 = the
   *  baseline rarity; >0 = mountains appear more often (Dawn's frequent ranges). */
  mountainBias: number;
  /** Multiplier on the ridged-peak frequency (× ZEN.mountainFrequency). <1 = BROADER peaks
   *  you arc over for a long gentle launch (vs buzzing over many narrow ridges at cruise —
   *  the calm-vs-chaotic lever for a peaky biome); 1 = the baseline ridge wavelength. */
  ridgeFrequencyMul: number;
}

export const ZEN_BIOME_TERRAIN: readonly ZenBiomeTerrain[] = [
  // SUNSET — rolling hills (the current baseline; keep the "home" feel).
  { hillAmplitude: 3.5, hillFrequencyMul: 1.0, mountainAmount: 1.0, mountainBias: 0.0, ridgeFrequencyMul: 1.0 },
  // MIDNIGHT — flat serene plains: low relief, no mountains (gentle undulation, not dead-flat).
  { hillAmplitude: 1.1, hillFrequencyMul: 0.9, mountainAmount: 0.0, mountainBias: 0.0, ridgeFrequencyMul: 1.0 },
  // AURORA — gentle dunes: broad soft swells (bigger amplitude, lower frequency), no peaks.
  { hillAmplitude: 6.5, hillFrequencyMul: 0.5, mountainAmount: 0.0, mountainBias: 0.0, ridgeFrequencyMul: 1.0 },
  // DAWN — peaky mountains: TALL + somewhat broad peaks (ridge freq 0.65 → ~150u peaks) so you
  //   launch off a big peak for a long gentle arc rather than buzzing narrow ridges. Higher
  //   coverage (bias) makes mountains DOMINATE the biome (it reads as a mountain range, not the
  //   occasional Sunset peak) — the MOST air, but flowing + calm. mountainAmount TEMPERED 2.0→1.4
  //   (still the airiest biome, > Sunset's 1.0) so its peaks stop producing the rare OUTLIER crests
  //   (the jarring big-launch tail) while keeping Dawn's identity — peaky, not flattened.
  { hillAmplitude: 4.0, hillFrequencyMul: 1.0, mountainAmount: 1.4, mountainBias: 0.08, ridgeFrequencyMul: 0.65 },
] as const;

/**
 * Zen BIOME REGION selection + transition cadence. `biomeAt(x, z)` samples ONE
 * low-frequency value-noise octave (world-keyed → seamless + deterministic) and
 * amplitude-bands it into the 4 ZEN_BIOMES, blending smoothly across band edges.
 * Tuned so a region reads as a PLACE you drive into (~2500u ≈ 25s at cruise), not a
 * flicker. (See ZenBiome.ts — reuses the racing updateBiome slot/from/to/blend math.)
 */
export const ZEN_BIOME = {
  /** Region-selection noise frequency (1 / wavelength). LOW → broad regions; tuned with
   *  the 4-way amplitude banding so a single biome holds for ~2500u of roaming. */
  noiseFrequency: 0.00033,
  /** Seed offset so biome regions are decorrelated from terrain/mask/ramp noise. */
  seedOffset: 0x10937,
  /** Fraction of a band (at its top edge) spent blending into the next biome — the
   *  smooth ~hundreds-of-units cross-fade so a region change is a glide, not a pop. */
  transitionFraction: 0.35,
  /** Rendering throttle: re-apply the blended palette only once `blend` advances by at
   *  least this much. Higher than the racing 0.02 — a Zen apply repaints TWO canvas
   *  textures (sky + sun), so we coalesce a touch harder for mobile headroom. */
  repaintBlendStep: 0.03,
  /** How strongly props/scenery pick up the biome accent (multiplicative cast). LOW —
   *  a faint tint, never a recolour. */
  accentTintStrength: 0.2,
  /** How much darker the sky's TOP is than the horizon (mix toward black). Gives each
   *  biome a natural overhead-dark → horizon-lit gradient derived from its fog colour. */
  skyTopDarken: 0.55,
} as const;

/** Zen free-roam STARFIELD — a 360° dome of seeded points around the camera, brightness
 *  driven by the active biome's starIntensity (Midnight full, Sunset none). Distinct from
 *  the racing STARFIELD (forward-locked box) — Zen's camera faces any direction. */
export const ZEN_STARS = {
  /** Number of stars (fixed buffer — allocated once, never grows). */
  count: 480,
  /** Radius (world units) of the star dome around the camera — just inside the far plane,
   *  well beyond the mountain ring so stars read as the deep sky. */
  radius: 1500,
  /** Lowest the dome dips toward the horizon, as a fraction of radius (0 = horizon plane,
   *  1 = straight up). Keeps stars in the UPPER sky, none below the mountains. */
  minHeightFraction: 0.12,
  /** Point size (world units) and base (full-intensity) opacity. */
  size: 2.6,
  baseOpacity: 0.9,
  /** Render order — behind the sun + mountains. */
  renderOrder: -3,
} as const;

/**
 * Zen MINIMAP — a small, calm, always-on corner RADAR for navigating the infinite
 * procedural world. ME-CENTERED + ROTATES with heading (car marker always points UP); the
 * world has no stored map, so the radar is LIVE-SAMPLED each frame: biomeAt on a grid →
 * coloured biome regions, plus ramp markers found in range. A 2D canvas DOM overlay (not
 * 3D). Tunable here so Craig can dial size/opacity/reach on his phone.
 */
export const ZEN_MINIMAP = {
  /** World-units radius the radar shows around the car (the inscribed circle of the grid).
   *  MATCHED to the landmark beacon draw range (ZEN_LANDMARK.drawRadius 2600) so the radar no
   *  longer shows LESS than the eye already sees in-world — a tunnel beacon you can spot is also
   *  on the radar. */
  worldRadius: 2600,
  /** On-screen diameter (CSS px) — tucked in a corner, sized for a phone (not intrusive). */
  sizePx: 124,
  /** Inset (CSS px) from the screen corner. */
  margin: 14,
  /** Biome sample grid resolution (N×N biomeAt samples → the coloured region wash). Coarse
   *  = cheap; fine enough to read ~2800u regions. */
  gridSamples: 28,
  /** Frames between biome/ramp RESAMPLES. Regions are ~2800u (they barely move frame to
   *  frame) so we resample the heavy biome grid only every N frames; the cheap ROTATION
   *  still updates every frame, so turning stays smooth. */
  resampleInterval: 8,
  /** Per-second easing of the radar's rotation toward the car heading (smoothed so a quick
   *  steer doesn't jitter the map). */
  headingLerp: 9,
  /** Overall overlay opacity — semi-transparent so it aids navigation without dominating
   *  the calm screen. */
  opacity: 0.82,
  /** Neon scope RING colour (synthwave cyan) + its line width (CSS px). */
  ringColor: 0x00ffff,
  ringWidth: 2,
  /** Scope BACKDROP (deep purple, behind/around the biome wash). */
  backdropColor: 0x1a0033,
  /** CAR marker (a triangle at centre, always pointing up) colour + half-size (CSS px). */
  carColor: 0xffffff,
  carSizePx: 5,
  /** RAMP marker colour (matches the in-world ramp-dune tint so map ↔ world agree) + radius. */
  rampColor: 0xff66cc,
  rampMarkerPx: 3,
  /** A short NORTH tick on the ring (world −z) so you can read your facing vs the world. */
  northColor: 0xff6600,
  northTickPx: 7,
  /** Stroke width (CSS px) of the north tick. */
  northTickWidth: 2,
  /** Alpha of the biome wash layer (slightly transparent so the backdrop bleeds through). */
  washAlpha: 0.9,
  /** LANDMARK marker (a destination beacon — bigger + brighter than a ramp dot) colour +
   *  radius (CSS px). A hollow ring so it reads as a "go here" beacon, distinct from ramps. */
  landmarkColor: 0xffe066,
  landmarkMarkerPx: 4,
  /** TUNNEL marker — a DISTINCT down-chevron in the tunnel gold (so a tunnel is navigable-to on the
   *  radar, not one more identical landmark dot — the diagnosed reason tunnels were never found). */
  tunnelMarkerColor: 0xffcc33,
  tunnelMarkerPx: 4,
  /** Extra stroke width (CSS px) added to tunnel chevron markers beyond the base landmarkLineWidth. */
  tunnelMarkerLineWidthBoost: 0.5,
  /** Vertical offset ratio of the tunnel chevron (the V's arm endpoints sit at ±r × this fraction
   *  above the centre). */
  tunnelChevronYRatio: 0.6,
  /** Stroke width (CSS px) of the landmark hollow-ring marker. */
  landmarkLineWidth: 1.5,
  /** Radius (CSS px) of the landmark centre dot. */
  landmarkDotPx: 1,
  // --- PER-TYPE COMPASS: the radar always shows the bearing to the NEAREST of EACH landmark type
  //     (ring/arch/gateway/vista/tunnel), as a small type-coloured tick at the scope edge — so you
  //     can pick a type and drive its bearing. Colours MATCH the in-world neon structures, so the
  //     radar self-teaches (no separate legend): orange ring, cyan arch, purple gateway, green
  //     vista, gold tunnel. Tasteful, not 5 loud quest arrows. ---
  /** Bearing-tick colour per LandmarkType [ring, arch, gateway, vista, tunnel]. */
  compassColors: [0xff6600, 0x00ffff, 0xcc44ff, 0x66ff99, 0xffcc33],
  /** Length (CSS px) of the bearing tick drawn inward from the ring, and its line width. */
  compassTickPx: 6,
  compassTickWidth: 2.5,
  /** How far (CSS px) the tick's outer end sits inside the ring (so it doesn't overdraw the ring). */
  compassEdgeInsetPx: 1.5,
  /** Outward search for the nearest-of-each-type query: start radius + cap (world units). Expands
   *  ×2 until all five types are found or the cap is hit (a far/rare type may need a wide scan). */
  compassSearchStart: 4500,
  compassSearchMax: 48000,
} as const;

/**
 * Zen LANDMARKS — distinctive neon STRUCTURES you spot from afar + journey to (the payoff of
 * the minimap markers). RARE + SPECIAL on purpose: a beacon you sight + travel to, never
 * litter. Position-deterministic (a low-freq cell hash, like ramps but much rarer), placed on
 * the terrain (heightAt), themed neon + calm/grand. Three types this PR (the system is built
 * to extend — more types are easy follow-ups). Craig dials "how rare" + sizes/effects here.
 */
export const ZEN_LANDMARK = {
  /** Side length (world units) of a landmark-placement cell — BIG, so landmarks stay sparse.
   *  At most one landmark per cell. LOWERED 2600→2250 (now every type does something distinct,
   *  Craig wants to find the cool stuff more often) — denser cells, but still a beacon you journey
   *  to, not litter. The per-type radar compass (ZenMinimap) makes even the rare types navigable. */
  cellSize: 2250,
  /** Probability (0..1) a cell carries a landmark, before the terrain gate. RAISED 0.42→0.48 with
   *  the smaller cell — together ≈1.5× the encounter rate (mean spacing ~3.5–4k → ~2.6–3k), so you
   *  reliably find something cool on a drive without it feeling everywhere. The clear tunable knob:
   *  raise this (and/or lower cellSize) to find them more often, lower it to keep them special. */
  chance: 0.48,
  /** Keep the landmark CENTRE this far (world units) off the cell edges — inset toward the cell
   *  centre so structures don't crowd the edges. KEPT 840 through the longer-tunnel dial (deliberately
   *  NOT co-scaled): the long tunnel's along-footprint (tunnelLength·scaleMax·0.5 ≈ 1755u) exceeds the
   *  cell half (cellSize/2 = 1125u) at ANY valid margin, so margin can't contain it — the drivable
   *  surface override is resolved by the MULTI-CELL surfaceQueryRadius scan (co-scaled above), which
   *  spans the neighbouring cells the footprint reaches into. edgeMargin is therefore placement-only
   *  (spacing), not load-bearing; and because it sets WHERE every landmark lands, nudging it reshuffles
   *  tunnels onto different terrain — measured to push some mouths onto steeper ground, worsening the
   *  #118 eased-mouth handoff step. So it stays put: smooth mouths win over a cosmetic co-scale. (Must
   *  stay < cellSize/2 = 1125 to keep a valid placement band [m, cellSize−m].) */
  edgeMargin: 840,
  /** Landmarks only place where the mountain mask is at/below this (GENTLE, reachable ground) so
   *  you can drive up to / through / onto them — never buried in a mountain. */
  maxMask: 0.25,
  /** Relative weight of each TYPE in the placement mix (indexed by LandmarkType: ring, arch,
   *  gateway, vista, tunnel). TUNNEL RAISED 1→3 (≈10%→25% of landmarks) — diagnosed unfindable
   *  from pure spatial rarity (~14.6km apart, in beacon range only ~10% of roaming time), so the
   *  descent is now ~2.5× more common (mean spacing ≈9.3km). Vista stays the rare "destination"
   *  (weight 1 ≈ 8%); ring/arch remain the common drive-throughs. No type vanishes. */
  typeWeights: [3, 3, 2, 1, 3],
  /** Per-landmark uniform scale variety. */
  scaleMin: 0.85,
  scaleMax: 1.35,
  /** Radius (world units) the renderer keeps landmark meshes loaded — LARGE (they're beacons
   *  seen from afar; their neon ignores fog so they read on the horizon). Culled beyond it. */
  drawRadius: 2600,
  /** Outer band (world units) over which a landmark fades IN from the horizon as it enters the
   *  draw radius — a gentle emerge, not a pop (the neon ignores fog, so fade by opacity instead). */
  fadeBand: 450,
  /** Horizontal distance (world units) within which the car has "reached" an ARRIVAL landmark
   *  (vista, tunnel) → fires its ramp-to-peak glow as you arrive/enter (in view because you're ON
   *  the vista / IN the tunnel). Scaled by the landmark's scale. */
  reachRadius: 24,
  /** Reach radius for DRIVE-THROUGH types (ring, arch, gateway) — LARGER, so the front-loaded flash
   *  triggers while the structure is still clearly AHEAD + in view (at cruise the structure
   *  slides behind ~0.5s after you reach it; the flash must land before that). */
  driveThroughReachRadius: 36,
  /** Reach GLOW PULSE: a soft brighten-and-settle on the structure when reached (a calm
   *  acknowledgment — no score/UI). Duration (seconds) + how far the colour lerps toward white +
   *  a gentle scale "breath". The ARRIVAL (vista/tunnel) envelope ramps to peak at the MIDDLE of this
   *  window (sin) — it works because you are ON/IN the structure when it fires. */
  pulseSeconds: 1.6,
  pulseBrighten: 0.85,
  pulseSwell: 0.06,
  // --- drive-through reward (ring, arch): a TWO-BEAT replacing the ramp-to-peak glow, which
  //     peaked ~0.8s AFTER you'd passed (the structure was ~44u BEHIND the chase cam by then —
  //     you saw nothing). Beat 1: a FRONT-LOADED flash that peaks early (while the structure is
  //     still ahead). Beat 2: a GATE RIPPLE on the opening plane as you cross it (you drive INTO
  //     it, looking right at it). ---
  /** Drive-through FLASH (beat 1): total duration + the quick rise to its early peak. The flash
   *  jumps up over `flashRiseSeconds` (peak), then decays over the rest — bright while ahead. */
  flashSeconds: 0.7,
  flashRiseSeconds: 0.12,
  /** GATE RIPPLE (beat 2): an expanding neon ANNULUS you drive THROUGH at the opening as the car
   *  crosses the plane. Additive (so the bloom pass flares it) + filled (an area, not a 1px line),
   *  positioned at CAR HEIGHT face-on to your approach — so you actually SEE it (the old thin
   *  line-circle sat ~26u overhead, edge-on, and never read). Duration + scale grows start → end +
   *  starting opacity (fades to 0). */
  gateSeconds: 0.55,
  gateStartScale: 0.25,
  gateEndScale: 1.15,
  gateOpacity: 0.9,
  gateSegments: 32,
  /** Ripple annulus inner radius as a fraction of the outer (a ring, not a solid disc — you drive
   *  through the hole; it reads as a glowing ripple, not a wall of light). */
  gateRippleInnerRatio: 0.55,
  /** Height (world units) of the ripple above the ground at the opening — CAR/eye level, where you
   *  actually pass, NOT the structure's centre height. */
  gateRippleHeight: 3,
  /** Arch opening centre height as a fraction of arch height (the ripple sits mid-opening). */
  archOpeningHeightRatio: 0.5,
  // --- type geometry (world units, before the per-landmark scale) ---
  /** ARCH (drive-THROUGH): two pillars + a bowed top beam you pass under. Opening is clear; the
   *  pillars are SOLID (deflect). */
  archHeight: 26,
  archHalfWidth: 20,
  archRise: 7,
  archPillarRadius: 2.6,
  archColor: 0x00ffff,
  /** GATEWAY (BIGGER drive-THROUGH): a colossal arch — same proven drive-through reward (front-load
   *  flash + gate ripple), scaled up + a double frame so it reads as a grand portal. SOLID pillars. */
  gatewayHeight: 46,
  gatewayHalfWidth: 34,
  gatewayRise: 13,
  gatewayPillarRadius: 4.2,
  gatewayColor: 0xcc44ff,
  gatewayOpeningHeightRatio: 0.5,
  gatewayInnerScale: 0.82,
  /** RING / PORTAL (drive-THROUGH, free): a big vertical neon ring you pass through — NO collision
   *  (glide straight through). Centre sits at radius × centreFactor so the bottom dips below ground
   *  (hidden) and the ground-level opening is wide. */
  ringRadius: 24,
  ringCentreFactor: 0.85,
  ringColor: 0xff6600,
  ringSegments: 40,
  /** Inner ring radius as a fraction of the outer (the double-ring portal frame). */
  ringInnerRatio: 0.9,
  /** Query radius (world units) for landmark solid-collision — covers the biggest scaled
   *  footprint (a scaled arch's outer pillar reaches ~30u from the centre). */
  solidQueryRadius: 80,
  /** Polyline segments in the arch's bowed top beam (higher = smoother curve). */
  archBeamSegments: 12,
  // --- VISTA (drive-ONTO): a raised flat-topped mesa you ascend onto for the elevated VIEW. The
  //     car follows a raised drivable surface (ZenLandmarkSurface) that blends to the terrain at the
  //     rim; a gentle glow marker crowns the top. No collision — you drive up the sloped sides. ---
  /** Outer radius (world units) where the mesa meets the terrain; flat-top radius; rise height. */
  vistaRadius: 46,
  vistaTopRadius: 20,
  vistaHeight: 14,
  vistaColor: 0x66ff99,
  /** Inner deck ring as a fraction of topRadius; crown marker ring ratio; crown height above deck. */
  vistaInnerRingRatio: 0.6,
  vistaCrownRingRatio: 0.45,
  vistaCrownRise: 3,
  /** Rings drawn on the mesa edge + a crown marker ring at the top (segments). */
  vistaSegments: 36,
  /** SUSTAINED overlook glow: while the car is ON a vista (within reach), the structure glows with a
   *  gentle BREATHING pulse — a calm "you're up here" acknowledgment that PERSISTS while parked (not
   *  the one-shot arrival flash). Base level + breath amplitude (each 0..1 of pulseBrighten) + breath
   *  rate (radians/s). Applies to the arrival types (vista, tunnel). */
  vistaSustainBase: 0.3,
  vistaSustainAmp: 0.22,
  vistaSustainRate: 2.2,
  // --- TUNNEL (drive-INTO, NOVEL): an entrance you spot, descend BELOW the terrain through a neon
  //     tube, resurface the far side. The car follows a separate lower floor (ZenLandmarkSurface) —
  //     the terrain stays the "roof". Crest physics are suppressed inside; entry/exit ease (no snap). ---
  /** Tunnel length along its through-axis; half-width of the floor; how far BELOW the terrain the
   *  floor dips at the deepest; headroom (ceiling above the floor — must exceed the camera height so
   *  the chase cam doesn't clip the ceiling). LENGTH RAISED 380→1200→1800→2600 — a MUCH longer
   *  underground JOURNEY. The descent/ascent ramps lengthen WITH it, so the (now deeper) floor is still
   *  a gentle ramp, not a cliff — depth was raised in step (28→40, ×1.43 vs length's ×1.44), holding the
   *  grade ≈6% (depth / (halfL·(1−tunnelDepthEaseStart)) is scale-invariant). (surfaceQueryRadius
   *  co-scaled below so the override still resolves from the far mouth; edgeMargin deliberately left as
   *  is — see its note — since nudging it reshuffles tunnels onto worse mouth terrain.)
   *  The #149 unified floor (tunnelDepthFactor, shared mesh+surface) + curve-fits-tube + #154 corridor
   *  (tunnelHalfWidth − tunnelBendAmplitude ≥ 25) invariants hold at any length/depth: the bend amplitude
   *  is a fixed pre-scale width that does NOT grow with length, so a longer tunnel only makes the bend
   *  GENTLER (same lateral spread over more length) — the corridor is unchanged + the Frenet membership
   *  only eases. */
  tunnelLength: 2600,
  /** Half-width of the tube/floor (world units, pre-scale). The car is "in the tube" iff its TRUE
   *  perpendicular distance to the curved centreline is ≤ this (path-relative / Frenet membership —
   *  ZenLandmarkSurface), so the WHOLE width is drivable. The straight-driving CORRIDOR is
   *  hw − bendAmplitude: #149 set hw 34 / bendAmp 26 → only 8u, so a normal off-centre line still left
   *  the curving tube and POPPED to the surface (diagnoses #148/#153 — the bump, 3×). WIDENED 34→46 +
   *  the gentler bend below give a real ~32u corridor — drive straight or weave anywhere in the tube,
   *  no pop. */
  tunnelHalfWidth: 46,
  /** How far (world units, pre-scale) the floor drops below the surface at the deepest. DEEPER
   *  16→28→40 — a more dramatic plunge into the neon underworld. The drop is spread over the (now
   *  longer, raised in step — see tunnelLength) descent ramp, so the grade stays gentle (≈6% — a smooth
   *  ramp, not a cliff) and the #118-class eased entry/exit at the mouths stays snap-free over the bigger
   *  Y drop. Shared by the floor mesh + the followed surface via tunnelDepthFactor (#149), so both deepen
   *  together — the car still rides exactly on the road. */
  tunnelDepth: 40,
  tunnelHeadroom: 13,
  /** The tunnel's gentle LATERAL CURVE: peak sideways offset of the centreline (world units, pre-scale)
   *  + how many sine half-bends span the length. A calm sweeping S (waves 1), windowed to be straight +
   *  tangent at the mouths (see tunnelBendShape). REDUCED 26→14 so a STRAIGHT drive stays well within
   *  the (widened) tube — corridor hw − bendAmplitude = 46 − 14 = 32u (vs #149's 8u). Still a visible
   *  sweep, just gentler. The tube, floor, and drivable surface all follow it. */
  tunnelBendAmplitude: 14,
  tunnelBendWaves: 1,
  /** Dip (world units) beyond which the car counts as ENCLOSED (deep inside) — for the in-tunnel feel. */
  tunnelEnclosedDepth: 6,
  /** Fraction of halfLength where the depth profile starts easing to 0 (the mouth ramp). */
  tunnelDepthEaseStart: 0.5,
  /** Fraction of halfWidth where the lateral floor starts easing up to the terrain. */
  tunnelLateralEaseStart: 0.7,
  tunnelColor: 0xffcc33,
  /** Tube cross-section ribs + their spacing (world units) — the neon passage walls/ceiling. */
  tunnelRibSpacing: 12,
  tunnelArcSegments: 10,
  // --- FLOOR (the ROAD you drive on): the tube was a ceiling arch with edge lines at the walls but
  //     NOTHING under the car — so you drove on your glow-disc over a void. A visible CYAN neon road
  //     at the drivable-surface Y (a centre line + side rails + lateral rungs) runs the full length,
  //     descending with the floor. Cyan contrasts the gold tube → reads instantly as "drive here". ---
  /** Road colour — cyan (the palette's #00ffff), distinct from the gold tube walls. */
  tunnelFloorColor: 0x00ffff,
  /** Spacing (world units) of the floor's lateral RUNGS — tighter than the wall ribs so the road
   *  reads as a dense, fast-moving track underfoot. */
  tunnelFloorRungSpacing: 9,
  // --- MOUTH arch taper: the ceiling height eases to 0 at the mouths (tracking the floor's depth
  //     ease) so the tube does NOT poke an awkward ~headroom-tall arch above flat ground — the
  //     entrance reads as a clean descending SLOT under the beacon, the tube forming as you sink. ---
  /** Fraction of full headroom the ceiling keeps at the very mouth (0 = flush slot; small = a hint
   *  of arch). The arch grows to full headroom as the floor descends. */
  tunnelMouthArchFloor: 0,
  // --- ENTRANCE BEACON: the tunnel is a BELOW-ground depression (its mouths only poke ~headroom
  //     up) — invisible from afar, so it was never FOUND. A TALL glowing portal-frame at each mouth,
  //     with downward CHEVRONS reading "drive DOWN here", makes it a spottable beacon like the other
  //     (14–46u tall) types — and a distinct silhouette (no other type has down-arrows). ---
  /** Height (world units) the entrance portal rises above the mouth — in the beacon range so it
   *  reads from a distance (bloom-lit, #128). */
  tunnelBeaconHeight: 30,
  /** Number of downward chevrons stacked inside the portal frame (the "descend" cue) + how far each
   *  V dips (world units) + its half-span as a fraction of the tunnel half-width. */
  tunnelBeaconChevrons: 3,
  tunnelBeaconChevronDip: 5,
  tunnelBeaconChevronSpan: 0.7,
  /** Where the top chevron sits inside the portal frame (fraction of beacon height from the top)
   *  and how far apart consecutive chevrons are spaced (fraction of beacon height). */
  tunnelBeaconChevronStartFrac: 0.75,
  tunnelBeaconChevronStepFrac: 0.22,
  /** Query radius (world units) for the drivable-surface override scan — ≥ the biggest surface
   *  footprint. RAISED 840→1300→1850 with the LONGER tunnel: at max scale the tube reaches
   *  tunnelLength·scaleMax·0.5 = 2600·1.35·0.5 ≈ 1755u along from centre, so the override must still be
   *  found from the far mouth (1850 leaves headroom). (Cost is a slightly larger cell scan per query —
   *  still a handful of cells; throttled callers aside, it's a bounded scalar scan.) */
  surfaceQueryRadius: 1850,
} as const;

/**
 * Zen TUNNEL VISUAL EVOLUTION (Stage 1 + 2a of docs/zen-tunnel-interesting-recon.md). PURELY COSMETIC —
 * this drives per-vertex COLOURS on the tube + floor line meshes and the decorative crystals baked into
 * the tube. It NEVER touches the drivable surface (ZenLandmarkSurface) — the #154 corridor, the #149
 * unified floor, and the off-centre canary are not involved (the path is byte-identical).
 *
 * GRADIENT: colour evolves by DESCENT PROGRESS p = 1 − |along/halfL| (0 at the mouths, 1 at the deepest
 * centre): cyan (shallow) → violet (mid) → gold (deepest). The material.color stays WHITE and the
 * gradient rides in a per-vertex colour attribute (so the reach-pulse, which scales material.color,
 * still brightens it; bloom #128 flares the bright deep-gold end). The FLOOR keeps its cyan "drive
 * here" identity (held toward cyan + a touch brighter than the walls) so the road stays readable.
 */
export const ZEN_TUNNEL_VISUAL = {
  /** Three gradient stops (hex) by descent progress: mouths → mid-descent → deepest. */
  gradientShallow: 0x00ffff, // cyan — at the mouths (matches the road's identity)
  gradientMid: 0xaa33ff, // violet — mid-descent
  gradientDeep: 0xffcc33, // gold — the deepest centre (the glowing payoff end)
  /** Progress p at which the MID stop sits (the gradient is two linear ramps: shallow→mid→deep). */
  gradientMidPoint: 0.5,
  /** Extra brightness added at the deepest (×(1 + deepBrightness·p)) — a subtle bloom RAMP so the deep
   *  end glows more as you descend (recon Kind 1b). Keep subtle. */
  deepBrightness: 0.3,
  /** The ROAD stays cyan-readable: its colour is lerped back TOWARD cyan by this fraction (1 = pure
   *  cyan always, 0 = the full tube gradient). Keeps the bright ribbon legible deep down. */
  floorCyanHold: 0.55,
  /** The road glows a touch brighter than the tube walls (×) so it reads as the "drive here" line. */
  floorBrightness: 1.2,
  // --- DECORATIVE crystals: faceted neon shapes set INTO the tube walls at intervals, that you PASS
  //     but never drive into (purely visual — never seen by the drivable surface). They sit out by the
  //     walls, well above the road, only where the arch is tall enough (the deep, novel stretch). ---
  decorColor: 0xff00ff, // magenta accent (the default; per-tunnel variety picks from decorAccents below)
  decorSpacing: 150, // world units (pre-scale) between candidate decoration stations along the length
  decorSize: 3, // base half-size of each crystal (world units, pre-scale) — fits the ~13u headroom
  decorWallInset: 3, // set the crystal this far inside the wall (off |x−centre| = halfWidth)
  decorHeightFrac: 0.55, // crystal centre up the wall as a fraction of the local arch height (Stage 2a base)
  decorMinArch: 8, // skip stations where the arch is shorter than this (near the mouths) — no room
  // --- PER-TUNNEL VARIETY (Stage 2b): each tunnel's decoration is seeded by its deterministic id
  //     (unit(seed, lm.id, slot)) so the SAME tunnel always looks identical, but DIFFERENT tunnels get
  //     a distinct accent / density / motif / sizing — they no longer feel copy-pasted. Still purely
  //     decorative (a separate per-tunnel mesh; the drivable surface is untouched). ---
  decorAccents: [0xff00ff, 0x00ffff, 0xff6600, 0xaa33ff], // per-tunnel dominant accent (magenta/cyan/orange/violet)
  decorDensityMin: 0.5, // a tunnel keeps at least this fraction of its candidate stations...
  decorDensityMax: 1.0, // ...and at most this many (sparse-to-full character varies per tunnel)
  decorSizeJitter: 0.4, // crystal size varies ±this fraction of decorSize, per crystal
  decorMotifs: 2, // number of crystal SHAPES (a per-tunnel choice: faceted diamond vs tall hex shard)
  decorRoadClearance: 1.0, // keep every crystal's lowest point at least this far ABOVE the road
  decorHexZFrac: 0.6, // hex shard z-extent as a fraction of crystal size (narrower than the diamond)
  decorHexYFrac: 0.35, // hex shard mid-point y-offset as a fraction of size (the waist pinch)
} as const;

/**
 * Zen ARCH = SPEED BOOST. Driving THROUGH an arch's opening grants a long-lasting speed surge that
 * eases back to cruise — a pure calm reward (no charge, no cost). The boost raises the speed cap
 * (and gives an instant kick) for `boostSeconds`, then the eased cap glides back down so the surge
 * FADES, never snaps away. The existing crossing flash/ripple stays as the "you crossed" feedback.
 */
export const ZEN_ARCH = {
  /** Boosted top speed (cruise is 96) — a big, lovely surge. */
  boostMaxSpeed: 170,
  /** How long the boost lasts before it has fully eased back to cruise. RAISED 6.5→11.0 — the surge
   *  LINGERS noticeably longer (playtest dial). The decay shape is unchanged: boostIntensity is
   *  smoothstep(0, boostSeconds, timeLeft), so a longer boostSeconds just STRETCHES the same gentle
   *  ease — the cap still glides back to cruise, never snaps. Magnitude (boostMaxSpeed) + the streak
   *  visual are untouched. */
  boostSeconds: 11.0,
  /** Instant kick on crossing as a fraction of the boosted top (you feel it immediately). */
  boostKickFrac: 0.96,
  // --- SPEED STREAKS (the "I'm boosting" visual): thin neon lines streaming past, bloom-lit, that
  //     fade in with the boost and ease out as it decays. Calm-exhilarating, not violent. ---
  streakCount: 28,
  /** Tube radius the streaks live in around the car's forward axis (world units). */
  streakRadius: 26,
  /** How far ahead/behind the car the streak field spans, and each streak's length. */
  streakSpan: 150,
  streakLength: 22,
  /** Flow speed multiplier (streaks stream backward faster than the car for the sense of speed). */
  streakFlow: 1.6,
  streakColor: 0x00ffff,
  /** Peak opacity at full boost (eased by intensity → 0 at rest, so they vanish when not boosting). */
  streakOpacity: 0.5,
  /** Angular offset between groups of 3 streaks (radians) — decorrelates the tube pattern. */
  streakAngOffset: 0.7,
  /** Inner radius fraction (of streakRadius) — the tightest streaks sit at this fraction. */
  streakRadiusInner: 0.55,
  /** Radius variation range added to the inner fraction (inner + range × golden = actual frac). */
  streakRadiusRange: 0.45,
  /** Below this boost intensity the streaks are hidden (avoids near-invisible geometry). */
  streakMinIntensity: 0.02,
  /** Base flow fraction at zero intensity — flow = streakFlow × (base + (1−base) × intensity). */
  streakFlowBase: 0.5,
} as const;

/**
 * Zen RING = RANDOM WARP. Driving THROUGH a ring blinks you to a RANDOM, unpredictable spot on the
 * map — a "shuffle / explore" button. REUSES the secret-area teleport+fade machinery (ZenSession),
 * but with a RANDOM destination, NO save/restore, and NOT inSecret (main-world → main-world, not a
 * returnable place). The #130 safe-arrival lessons apply: sane heading, land on terrain, and a
 * bounce guard so you don't instantly re-warp at the destination. Fade timings reuse ZEN_SECRET.
 */
export const ZEN_RING = {
  /** Random hop distance band (world units) — far enough to feel like "somewhere else". */
  minDistance: 2400,
  maxDistance: 6400,
  /** After arriving, ignore crossings until driven this far clear (no warp-bounce at the dest). */
  guardDistance: 150,
} as const;

/**
 * Zen VISTA SKY-SLIDE — driving onto a vista deck AUTO-CATAPULTS the car up into an enclosed neon
 * sky-tunnel that twists + descends like a playful slide, depositing you back on the ground near the
 * vista. A GUIDED PARAMETRIC RIDE on an ABSOLUTE-Y path (the surface override is ground-relative and
 * the ballistic launch caps at ~5u apex — both proven unusable in the recon; see
 * docs/vista-sky-slide-recon.md). The catapult is the scripted ASCENDING FIRST SEGMENT of the path.
 * Craig's calls: BIG (a real climb) + TWISTY (more bends than the tunnel's single S), every vista.
 * Tuned to be DIALABLE — the feel gate is Craig's phone; these are the levers.
 */
export const ZEN_SLIDE = {
  // --- TRIGGER ---
  /** On the vista flat top within this fraction of the top radius → launch (every vista launches). */
  deckTriggerRadiusFrac: 0.92,
  /** The catapult imparts at least this forward speed so the ride always proceeds (even from a crawl). */
  launchSpeed: 78,
  // --- PATH GEOMETRY (local to the launch vista; absolute-Y) — BIG + TWISTY, all eased (C¹ at seams) ---
  /** Apex height above the vista deck — the big vertical soar. */
  climbHeight: 190,
  /** Horizontal distance from the vista to the landing (eased out + in). LENGTHENED 380→610→854
   *  (×1.4) for an even longer soar. Scaled together with bendWaves + pathLength so the bend
   *  WAVELENGTH (forwardReach / bendWaves ≈ 254u) + the ride pacing are UNCHANGED — same gentle #146
   *  bends + #151 steady camera, just more of them over a longer ride (not denser/sharper). */
  forwardReach: 854,
  /** Fraction of the path the catapult climb owns (the rest twists + descends). */
  ascentFrac: 0.16,
  /** How far BELOW the deck the path ends (≈ down to the ground at the vista base; the #118 soft
   *  landing absorbs the residual gap to the real terrain). */
  descentDrop: 24,
  /** Lateral twist amplitude (the sideways swing of the slide centreline). COMFORT-tuned 74→40:
   *  gentler bends (the big twist made Craig dizzy; the soar — climb/descent — felt good and is
   *  unchanged). A graceful sweep, not a violent swing. */
  bendAmplitude: 40,
  /** Half-bend count along the slide. COMFORT-tuned 3→1.5 (#146); scaled WITH the path length to hold
   *  the bend WAVELENGTH constant: 1.5→2.4 (#147), then 2.4→3.36 (×1.4) here. 854/3.36 ≈ 610/2.4 ≈
   *  380/1.5 ≈ 254u — the SAME gentle #146 bends at the SAME spacing, just more of them over the
   *  longer slide (NOT denser or sharper). Amplitude (gentleness) is unchanged. */
  bendWaves: 3.36,
  /** Windowed-sine ease (zero value + tangent at the ends) — same family as the tunnel bend. */
  bendEaseStart: 0.5,
  // --- CAMERA (comfort): the slide uses its OWN, calmer camera than normal driving (the global
  //     ZEN.camPosLerp/leanMax stay as-is for cruising). Softer look-at/heading ease so the rig
  //     GLIDES through the bends instead of whipping, and far less bank so the horizon barely tilts
  //     (a prime nausea source). Damped but NOT floaty — still connected to the car. ---
  /** Heading/look-at ease while sliding (vs ZEN.camPosLerp 4.5) — lower = more damped, glides. */
  camPosLerp: 2.8,
  /** Chassis bank while sliding (vs ZEN.leanMax 0.18) — much less horizon tilt → less dizziness. */
  leanMax: 0.06,
  // --- RIDE DYNAMICS ---
  /** Nominal path length: the param u advances by (speed / pathLength)·dt → sets the ride duration.
   *  LENGTHENED 940→1500→2100 (×1.4 here, with forwardReach) so the longer slide keeps the SAME
   *  apparent speed/pacing (you spend longer on it = more soar) — and the tube mesh's rib density
   *  (rings = pathLength / ringSpacing) stays constant over the longer path. */
  pathLength: 2100,
  /** Slide speed is clamped to this band; gas/brake modulate within it (the player still feels it). */
  rideMinSpeed: 60,
  rideMaxSpeed: 158, // a touch over maxSpeed (96) — the slide feels FAST
  rideAccel: 64,
  /** Lateral steer authority within the tube (u/s at full steer) + how fast the offset eases back
   *  to centre when you let go (per-second). You nudge within the tube; you can't fall off. */
  steerNudge: 28,
  steerReturn: 2.6,
  /** Normalized steer magnitude below which the lateral offset eases back to centre (dead zone). */
  steerDeadZone: 0.05,
  /** Lateral offset is clamped to ±(tubeHalfWidth − tubeMargin) so the car never clips a wall. */
  tubeMargin: 4,
  // --- TUBE MESH (reuses the tunnel neon palette; bloom-lit, #128) ---
  tubeHalfWidth: 15,
  tubeHeadroom: 17,
  ringSpacing: 13, // longitudinal rib spacing along the path
  arcSegments: 10, // arch cross-section resolution
  rungSpacing: 10, // floor rung spacing
  tubeColor: 0xffcc33, // gold tube
  floorColor: 0x00ffff, // cyan road
  // --- RE-ENTRANCY ---
  /** After landing, gateway-style guard: no re-launch until the car has driven this far from the
   *  landing point (mirrors ZEN_SECRET.returnGuardDistance) — landing near the vista can't re-fire. */
  guardDistance: 95,
} as const;

/**
 * Zen BLOOM — the post pass that makes Zen's bright neon actually GLOW. Without it, everything is
 * 1px unlit lines: the landmark reward's flash (a colour-lerp to white) + the structures + the
 * grid all render but read as thin dim lines (the verified cause of "the reward never showed").
 * Reuses the racing UnrealBloom recipe (RenderPass → bloom → OutputPass) at HALF resolution — the
 * mobile-measured-safe config (racing #95-98: half-res bloom ≈ free, full-res is the GPU killer).
 * The LOW quality tier bypasses it entirely (direct render) as the guaranteed-cheap fallback.
 */
export const ZEN_BLOOM = {
  /** Glow strength. Tuned to make neon + the flash GLOW without washing out the calm scene
   *  (a touch above racing's tamed 0.6 since Zen has no other bright HUD to protect). */
  strength: 0.75,
  /** Blur spread — slightly wider than racing for a soft, serene halo. */
  radius: 0.6,
  /** Luminance threshold — only the brighter neon cores + the white flash bloom (keeps the dark
   *  sky + deep biomes clean, not a global haze). */
  threshold: 0.4,
  /** Bloom blur-target resolution scale — HALF res on ALL devices (the mobile-safe lever: a blur,
   *  so half-res is ~visually identical at ~¼ the pixel cost). The scene stays full resolution. */
  resolutionScale: 0.5,
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
  /**
   * Bloom blur-target resolution scale (ALL devices). The bloom pass — UnrealBloom's
   * 5-mip down/blur/up chain — is the #1 GPU cost (profiled: ~31% of the HIGH frame /
   * +7.5ms at a GPU-bound resolution). Bloom is a BLUR, so rendering its target at
   * half resolution is visually near-identical while costing ~¼ the bloom pixel work.
   * The SCENE + HUD stay full-resolution — only this blur buffer is halved. (Was
   * touch-only at 0.5; extended to desktop so HIGH itself is cheaper, not just LOW.)
   */
  resolutionScale: 0.5,
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
  /** Slow-mo BANK collect cue: a light scale/glow pulse on the HUD slow-mo count
   *  chip when a charge is banked, so collecting reads as "you got one" even
   *  though banking fires nothing immediately. Lighter than the combo pulse. */
  bankPulseMs: 260,
  bankPulseScale: 1.25,
  bankPulseBrightness: 1.5,
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
  /** Peak trail opacity at top speed. */
  trailMaxOpacity: 0.5,
  /** Per-second ease rate for trail opacity (smooth fade in/out). */
  trailOpacityRate: 8,
  /** Intensity below which the trail is hidden (avoids near-invisible draws). */
  trailMinIntensity: 0.003,
  /** Trail colour (cool cyan). */
  trailColor: 0x00ffff,
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
  /** STORE cosmetic preview — a static glowing TRAIL streak behind the previewed car
   *  (the car is stationary in the menu, so the trail is shown as a colour streak).
   *  Sizes are multiples of the car's width/length; opacity for the additive glow. */
  storeTrailWidthMul: 0.7,
  storeTrailLengthMul: 2.6,
  storeTrailOpacity: 0.5,
  /** The streak's centre offset behind the car (multiples of car length). */
  storeTrailOffsetMul: 1.1,
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

/** localStorage key for the OPP-09 daily challenge (per-day bests + run counts).
 *  SEPARATE from the leaderboard: daily runs use a fixed per-date seed and are
 *  not comparable to random-seed runs, so they never touch the main board. */
export const DAILY_STORAGE_KEY = 'neon-drift.daily';

/** Days of daily-challenge history kept (rolling — the N most-recent days). */
export const DAILY_HISTORY_SIZE = 7;

/** localStorage key for player settings (sound, selected car, future toggles). */
export const SETTINGS_STORAGE_KEY = 'neon-drift.settings';

/** localStorage key for the RIVAL GHOST recordings (best input-replay per mode). */
export const GHOST_STORAGE_KEY = 'neon-drift.ghost';

/**
 * Rival ghost (input-replay) tuning. The ghost records a run's per-frame intents +
 * seed and re-runs the pure sim in lockstep to reproduce it exactly (leans on the
 * #73 determinism guarantee). Visual-only here — no gameplay/collision (a phantom).
 */
export const GHOST = {
  /** Translucent ghost-car colours (a cool, clearly-not-the-player look). */
  bodyColor: 0x223355,
  glowColor: 0x88ccff,
  accentColor: 0x88ccff,
  /** Opacities for the ghost car's materials (1 = opaque). Low = phantom. */
  bodyOpacity: 0.3,
  edgeOpacity: 0.45,
  /** Opacity the ghost fades to once its recording ends (still faintly visible). */
  endedOpacity: 0.15,
  /** Safety cap on recorded frames (~10 min at 60Hz) — bounds memory/storage for a
   *  pathological never-ending run. A normal run is far shorter. */
  maxFrames: 36000,
} as const;

/**
 * Multiplayer connection foundation (MP-1 PR1 — see MULTIPLAYER_DECISION.md). This
 * PR only CONNECTS two peers + runs a determinism probe; no gameplay/lockstep yet.
 */
export const NET = {
  /** Match-code length (host-generated, joiner-typed). Short + human-shareable;
   *  unambiguous alphabet (no 0/O/1/I) to avoid mistyping. */
  codeLength: 5,
  codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  /** Signaling poll interval (ms) while waiting for the peer's SDP. */
  signalPollMs: 800,
  /** How long the HOST keeps polling for the joiner's answer (ms) — a patient lobby
   *  so a friend can join minutes after getting the code. Times out → "no one joined
   *  yet" (host again), not a silent hang. */
  hostWaitMs: 600000, // 10 min
  /** How long the JOINER polls for the host's offer (ms) before giving up. The offer
   *  is posted within seconds of hosting, so a short window — its absence means the
   *  code is expired/wrong → a fast, clear "code expired or not found". */
  joinFindMs: 20000, // 20 s
  /** Heartbeat ping interval over the data channel (ms) → drives the RTT readout. */
  heartbeatMs: 1000,
  /** Safety timeout (ms) for ICE gathering — resolves if the browser stalls on
   *  'gathering' state so signaling isn't blocked indefinitely. */
  iceGatheringTimeoutMs: 3000,
  /** Public STUN for NAT traversal (free). TURN (relay fallback for symmetric NAT,
   *  ~1-in-6 pairs) is configured separately + optionally via env — see iceServers. */
  stunUrls: ['stun:stun.l.google.com:19302'],
  /** Cross-engine determinism PROBE (the top risk): both peers run this seed + a
   *  scripted input for N frames, then compare checksums. Long enough that any
   *  float divergence has time to surface (and perturb the RNG spawn cadence). */
  probeSeed: 0x5eed1234,
  probeFrames: 1200,
  /** Tolerance for float-derived probe fields (rngState is compared EXACTLY). */
  probeEpsilon: 1e-6,
  /** INPUT-DELAY LOCKSTEP (MP-1 PR2). `lockstepDelay` (N): local input decided now
   *  EXECUTES N fixed frames later, giving the packet N×(1000/60)≈67ms to reach the
   *  peer (covers typical RTT; raise for worse links). `lockstepRedundancy` (K):
   *  each message re-sends the last K inputs so a dropped packet self-heals from the
   *  next (no retransmit). `desyncCheckFrames`: how often peers swap a state checksum
   *  to catch any drift the determinism probe didn't (the safety net). */
  lockstepDelay: 4,
  lockstepRedundancy: 8,
  desyncCheckFrames: 30,
} as const;

/**
 * MP-RACE crash rule (MP-1 PR3). In a live 2P race a crash SLOWS you down instead of
 * ending the run — so a crashed player keeps driving + producing intents (the
 * lockstep never starves) and both cars stay live. DETERMINISTIC + sim-level (gated
 * to mpRace), so both peers compute the identical slowed trajectory from the same
 * inputs. MP-only — single-player crash behaviour (classic single-death, slalom
 * 3-lives) is unchanged. Playtest-tunable.
 */
export const MP_CRASH = {
  /** Forward speed (world units/s) the car drops to on a crash; normal acceleration
   *  then recovers it. Low = a real penalty, but the car keeps moving. */
  crashSpeed: 18,
  /** Invulnerability window (s) granted on a crash so the car clears the obstacle it
   *  hit without instantly re-crashing (mirrors the shield/slalom i-frames). */
  invuln: 0.9,
} as const;

/**
 * vs-COMPUTER (BOT) tuning. The AI opponent is a 2nd GameState stepped with
 * BOT-GENERATED intents on the same shared course as the player (mpRace=true), so
 * it meets the identical obstacle field and races to MP_RACE.finishDistance.
 *
 * Difficulty is the BOT'S SKILL, never rubber-banding: the bot decides purely from
 * (the deterministic course it can see + its own car + skill + a seeded rng). It
 * NEVER reads the player's position/gap — beating HARD is earned, EASY is fair.
 */
export interface BotSkill {
  /** How far ahead (world units) the bot senses obstacles. Short = reacts late. */
  reactionDistance: number;
  /** Lateral jitter (world units) added to the chosen target lane — higher =
   *  sloppier placement (misjudges the gap). Seeded, so it's deterministic. */
  dodgeJitter: number;
  /** Per-decision chance [0,1] the bot makes a MISTAKE this tick (wrong/no input),
   *  rolled on the bot's seeded rng. Higher = more beatable. */
  mistakeRate: number;
  /** Steering responsiveness toward the target lane (maps lateral error → steer). */
  steerGain: number;
  /** Use a banked slow-mo when the nearest hazard is within this distance (0 =
   *  never uses slow-mo). Larger = deploys earlier / smarter in tight spots. */
  slowMoTriggerDistance: number;
}

/** EASY / MEDIUM / HARD skill presets (first-pass; tune from playtest). EASY sees
 *  late, places loosely, errs often, barely uses slow-mo → a beginner can win.
 *  HARD sees far, places tight, almost never errs, uses slow-mo well → a challenge. */
export const BOT_DIFFICULTY: Readonly<Record<'easy' | 'medium' | 'hard', BotSkill>> = {
  easy: { reactionDistance: 95, dodgeJitter: 2.4, mistakeRate: 0.22, steerGain: 0.18, slowMoTriggerDistance: 0 },
  medium: { reactionDistance: 160, dodgeJitter: 1.1, mistakeRate: 0.08, steerGain: 0.3, slowMoTriggerDistance: 32 },
  hard: { reactionDistance: 240, dodgeJitter: 0.25, mistakeRate: 0.015, steerGain: 0.42, slowMoTriggerDistance: 48 },
} as const;
export type BotDifficulty = keyof typeof BOT_DIFFICULTY;

/** Bot behaviour constants shared across difficulties. */
export const BOT = {
  /** Salt XORed into the run seed for the bot's OWN mistake-rng stream, so the bot's
   *  randomness never touches (or is touched by) the sim's seeded draws. */
  rngSalt: 0x70c0ffee,
  /** Lateral clearance the bot aims for past an obstacle centre: the collision
   *  half-widths (VEHICLE 1.1 + TRAFFIC 1.1) plus a small safety margin. */
  clearance: VEHICLE.halfWidth + TRAFFIC.halfWidth + 0.6,
  /** Candidate lateral offsets (from road centre, world units) the bot considers
   *  when picking a clear lane. Within ±ROAD.halfWidth(9). */
  laneCandidates: [-6, -3, 0, 3, 6],
  /** A mistake holds a wrong/zero steer for this long (s) before re-deciding, so an
   *  error reads as a beat of hesitation, not a 1-frame flicker. */
  mistakeHoldSeconds: 0.35,
} as const;

/** Default RNG seed when none is supplied (keeps runs reproducible in tests). */
export const DEFAULT_SEED = 0x9e3779b9;

/**
 * ZEN FREE-ROAM (a PARALLEL system — lives in its own src/zen/ module, never the
 * forward sim). A calm, heading-based 2D cruise on an open plane. Single-player, no
 * lockstep/replay → EXEMPT from detmath (free to use Math.sin/cos). First-pass tuning
 * — EXPECT to adjust from playtest (PR1 is the FEEL gate). All movement values are
 * deliberately CALM, well below the racing speeds.
 */
export const ZEN = {
  // --- movement (the keystone) ---
  /** Top cruise speed (world units/s) — RAISED again (was 84) for a faster, more flowing
   *  cruise. The cap is the binding limit; `accel` is co-tuned so the higher cap is actually
   *  REACHED (the accel/friction equilibrium otherwise caps cruise below it). Faster cruise
   *  → bigger/more-frequent crest arcs (#120: surfaceVy scales with speed) — dial airGravity
   *  up if that gets too bouncy. */
  maxSpeed: 96,
  /** Forward acceleration (units/s²) at full throttle. RAISED (was 46) so cruise reaches the
   *  higher maxSpeed rather than settling below it. */
  accel: 52,
  /** Braking deceleration (units/s²) at full brake. */
  brakeAccel: 80,
  /** Per-second retained fraction of speed while coasting (glide-to-rest). */
  friction: 0.6,
  /** Turn rate (radians/s) at full steer + full authority — gentle. */
  turnRate: 1.6,
  /** Speed at which turning reaches full authority; below it, turning eases in so the
   *  car doesn't pivot in place when nearly stopped. */
  turnFullSpeed: 20,
  // --- chase camera (MOSTLY STEADY + a whisper of speed reactivity — the opposite of
  //     the racing adrenaline cam, where FOV-punch / pull-back are speed-thrill tricks).
  //     Speed adds only a small, eased distance/FOV change; the turn-glide is separate. ---
  /** RESTING distance behind the car (speed 0). The comfortable FLOOR — far enough back
   *  that the whole car reads without looming. */
  camDistance: 16,
  /** Extra distance added at FULL speed (eased in). THE swing knob: small = mostly
   *  steady; set to 0 for a fully steady camera (option 1). Keep it well under
   *  camDistance so the rest→max swing stays gentle. */
  camDistanceSpeedGain: 4,
  /** Camera height above the ground plane (steady — no speed term; raised so the car
   *  reads comfortably at rest). */
  camHeight: 6.5,
  /** Look-at height above the car's base. */
  camLookAtHeight: 1.2,
  /** Per-second easing for the camera BOOM swinging behind the car as it TURNS (the calm
   *  turn-glide). Forward motion no longer adds distance lag, so this is decoupled from
   *  the speed feel. Lower = floatier/calmer. */
  camPosLerp: 4.5,
  /** Per-second easing of the SPEED FACTOR that drives distance/FOV, so brief throttle
   *  changes don't pump the framing. Low = very calm onset. */
  camSpeedLerp: 2,
  /** Gentle visual bank (radians) the chassis leans into a full-steer turn. */
  leanMax: 0.18,
  /** RESTING field-of-view (degrees, speed 0). */
  camFov: 60,
  /** Extra FOV degrees added at FULL speed (eased in) — a subtle WIDEN (never tighten: a
   *  tight FOV at speed is a known disorientation/motion-sickness trigger). Small cue. */
  camFovSpeedGain: 4,
  /** Camera near clipping plane. */
  camNear: 0.1,
  /** Camera far clipping plane (draw distance for the grid). */
  camFar: 4000,
  /** Colour of the synthwave wireframe GRID FLOOR draped over the terrain. BRIGHT cyan
   *  (PALETTE.cyan) so it reads as a glowing floor on the dark sky WITHOUT a bloom pass —
   *  Zen has no post-processing. Fades into the horizon via the fog (ZEN.horizonColor). */
  gridColor: 0x00ffff,
  // --- world streaming (PR2): chunk-streamed scenery on the flat plane ---
  /** Fixed seed for the world's POSITION-DETERMINISTIC prop placement. Zen is
   *  single-player free-roam (no replay/lockstep), so a constant seed gives a stable
   *  world every session — placement is keyed to world (x,z), never to the path taken. */
  worldSeed: 0x5a2e17,
  /** Side length (world units) of a streaming chunk square. chunk = floor(coord/size). */
  chunkSize: 80,
  /** Chebyshev radius (in chunks) of the active set around the car's chunk. The active
   *  set is a (2R+1)² square — this bounds BOTH draw distance and the prop budget. */
  chunkRadius: 4,
  /** Max props placed per chunk (the per-chunk count varies via the hash for open
   *  cruising space; it never exceeds this, so the instance pool is sized from it). */
  propsPerChunk: 4,
  /** Gentle per-prop scale variety (multiplier on the reused scenery mesh). */
  propScaleMin: 0.8,
  propScaleMax: 1.5,
  /** Exponential fog density. Tuned so props fade IN from the haze near the cull radius
   *  (chunkRadius × chunkSize) — hides chunk load/cull pop, and is on-aesthetic. */
  fogDensity: 0.006,
  // --- terrain (PR3a): rolling hills the car flows OVER (heightAt is a continuous,
  //     world-keyed function so chunk meshes seam perfectly; props + car ride on it) ---
  /** Peak height of the FIRST noise octave (world units). Modest = ROLLING hills, not
   *  jagged peaks (grand mountains can come later). Total relief ≈ amplitude × (1+gain). */
  terrainAmplitude: 3.5,
  /** Spatial frequency of the first octave (1 / wavelength). Lower = broader, gentler
   *  hills. ~0.0075 → ~130-unit wavelength (gentle swells ~1.5 chunks wide). */
  terrainFrequency: 0.0075,
  /** Octave count — CHEAP: a couple is plenty for rolling hills (cost scales with this,
   *  the phone-perf killer). */
  terrainOctaves: 2,
  /** Per-octave amplitude falloff (each octave is quieter). */
  terrainGain: 0.5,
  /** Per-octave frequency growth (each octave is finer). */
  terrainLacunarity: 2.0,
  /** Half-step (world units) for the finite-difference slope sample along the heading. */
  terrainSlopeEps: 1.5,
  /** Extra height the car's base sits above the surface (0 = wheels on the ground). */
  rideHeight: 0,
  /** Per-second ease of the car's Y toward the surface — tight enough to hug the ground,
   *  smooth enough that tiny gradient changes don't jitter the car/camera. */
  terrainFollowLerp: 12,
  /** Max per-frame correction of the car's Y toward the surface (world units). Bounds the
   *  LANDING discontinuity: flying off a ridge INTO higher far-side terrain used to snap the
   *  car's Y up ~18u in one frame (a teleport that whipped the camera). The cap spreads a big
   *  snap over a few frames (smooth settle) while leaving clean touch-downs instant — it only
   *  bites on gaps the ease would close by > this in one frame (~14u), which real grounded
   *  hill/descent tracking never reaches. */
  maxLandStep: 2.5,
  /** SLOPE-AWARE landing catch-up (the consistency fix): when the car lands into a RISING far-side
   *  (a steep mountain crest → a big gap), the gentle terrainFollowLerp would float the car UP over
   *  ~5-8 frames (the diagnosed "soft float-up landing"). Instead, for a big gap we catch up FIRMLY
   *  at ~the slope's own climb rate (|slope|·speed·this) — so the car RIDES UP the hill at the rate
   *  it's driving into it, reading as a planted landing, not a float. On GENTLE ground the rate
   *  floors at maxLandStep (this term is < maxLandStep for slope < ~1 at cruise) → normal driving +
   *  clean landings are UNCHANGED. */
  landRideFactor: 1.5,
  /** Hard ceiling (world units/frame) on that firm catch-up — so even a near-vertical far-side
   *  settles over a couple of frames, never a one-frame teleport (keeps the #118 no-lurch guarantee). */
  landSettleCeil: 6,
  /** Subdivisions per chunk in the terrain wireframe (per side). More = smoother hills
   *  AND peaks (raised from 6 for PR4 mountains to read without spiking), more vertices.
   *  The windowed line-grid is rebuilt only on chunk crossings. */
  terrainSegmentsPerChunk: 8,
  /** Opacity of the neon terrain wireframe. RAISED (was 0.42 — that read as an invisible
   *  void on near-black) so the glowing grid floor + its rolling relief clearly read. */
  terrainOpacity: 0.85,
  /** GENTLE slope effect: along-heading slope (rise/run) × this = the speed nudge accel
   *  (units/s²). Uphill bleeds a little, downhill adds a little. SUBTLE by default (well
   *  under the throttle accel) — set near 0 for a flat-feel, or up for more; THE knob
   *  Craig dials on his phone. */
  slopeStrength: 20,
  /** Floor (units/s) the slope ALONE can never drag you below — climbing is a nudge,
   *  never a grind/stall (you can still slow by lifting the throttle). ≈0.4 × maxSpeed. */
  slopeUphillFloor: 28,
  /** Visual-only car PITCH into the slope (0 = disable). Reads as ON the hill. */
  terrainTiltFactor: 1,
  /** Clamp (radians) on the visual pitch tilt so steep transients never over-rotate. */
  terrainTiltMax: 0.28,
  // --- air-time (DETACH-and-arc off crests; gentle/zen, never a violent launch or crash
  //     landing). The car leaves the ground whenever the surface drops away FASTER than
  //     gravity (so it can't stay glued without snapping down) and ARCS off under gravity —
  //     a gentle jump. Gentle hills + mild downslopes drop slower than gravity → stay
  //     grounded + smooth. THE knob (airGravity) is both the in-flight gravity AND the
  //     detach threshold — one physical gravity, so it's coherent. ---
  /** Downward acceleration in flight (units/s²). ALSO the DETACH threshold: the car arcs off
   *  wherever the surface drops away faster than THIS. Lower = floatier arcs + air off
   *  gentler crests (detaches more readily); higher = heavier, air only off sharper crests. */
  airGravity: 80,
  /** Cap on the detach upward velocity → the MAX AIR off the steepest crests/ramps (a sharp
   *  ramp face would otherwise fling huge upward velocity). Keeps the biggest arc gentle/zen
   *  and readable. Small crests detach with small velocity, FAR under this cap, so this only
   *  clips the rare OUTLIER launches. LOWERED 38→28 (arc cap ~9.0u→~4.9u) to clip the jarring
   *  big-launch tail while leaving the 99% gentle micro-hops (vy well under the cap) untouched. */
  maxLaunchVel: 28,
  /** Max nose-pitch (radians) while airborne — the car tips to follow its arc (nose up
   *  rising, down toward landing). Visual only. */
  airTiltMax: 0.5,
  // --- air-shadow (the READABILITY fix): a glow ellipse pinned to the TERRAIN under the
  //     car (NOT parented to it). Grounded, it sits under the car (reads as one); airborne,
  //     the car rises but the shadow STAYS on the ground → a visible GAP = the "in the air"
  //     cue. It shrinks + dims with height (a classic platformer shadow). ---
  /** Shadow radius (world units) — a touch wider than the car so it reads as a soft spot. */
  shadowRadius: 2.4,
  /** Base opacity (grounded). */
  shadowOpacity: 0.45,
  /** Air height (world units) over which the shadow shrinks/dims to its minimum — about
   *  the max arc, so at the apex the shadow is its smallest/dimmest. */
  shadowFadeHeight: 9,
  /** Shadow scale + opacity multiplier at full air height (smaller/dimmer = higher up). */
  shadowMinScale: 0.45,
  shadowMinOpacityMul: 0.4,
  /** Lift above the terrain so the shadow doesn't z-fight the grid floor. */
  shadowYOffset: 0.06,
  /** Shadow glow colour (a purple-magenta ground spot, on the synthwave palette). */
  shadowColor: 0xcc33ff,
  // --- mountains (PR4): a LOW-FREQUENCY mask decides WHERE the gentle hills rise into
  //     mountains (occasional clumps, not everywhere); there a PEAKY ridged octave scales
  //     the height up. Gentle hills stay everywhere the mask is low; the transition is a
  //     smooth lead-up. Continuous + world-keyed → still seams across chunks. ---
  /** Mask spatial frequency (1 / wavelength). LOW → big regions (~625-unit wavelength), so
   *  mountains come in landscape-scale clumps, not speckled everywhere. Craig's "how often
   *  do mountains appear" knob (lower = rarer/bigger ranges). */
  maskFrequency: 0.0016,
  /** Mask value (0..1) above which the ground becomes mountainous. Higher = mountains are
   *  RARER (a smaller fraction of the world); the majority stays gentle hills. */
  maskThreshold: 0.6,
  /** Mask ramp width above the threshold: the mountain factor eases 0→1 across this band,
   *  so hills LEAD UP to mountains gradually (no cliff at the boundary). */
  maskBlend: 0.2,
  /** Peak height scale (world units) added at full mask × full ridge. The "grandeur" knob
   *  — bigger = taller, more dramatic peaks (vs the ±~5 gentle hills). */
  mountainAmplitude: 32,
  /** Ridge (peaky) octave frequency (1 / wavelength). ~0.01 → ~100-unit peaks (several
   *  mesh segments wide, so they read smooth, not aliased spikes). */
  mountainFrequency: 0.01,
  /** Ridged octave count + falloff/growth — a couple of inverted-abs (ridged) octaves give
   *  sharp ridgelines that read as MOUNTAINS, not big lumps. */
  mountainOctaves: 2,
  mountainGain: 0.5,
  mountainLacunarity: 2.2,
  // --- ramps / dunes (discovery #1): SPARSE, DESIGNED launch spots — a smooth raised dome
  //     added into heightAt, placed rarely (low-freq cell hash, like the mask) in GENTLE
  //     regions so you launch up-and-out into landable space. Reuses the air-time launch +
  //     #117 shadow + #118 lurch-free landing. A delight you stumble on, NOT a stunt park. ---
  /** Side length (world units) of a ramp-placement cell. Big = sparse. At most ONE ramp per
   *  cell. Craig's "how spread out" knob. */
  rampCellSize: 460,
  /** Probability (0..1) a cell HAS a ramp. Start SPARSE — a find, not litter. With cellSize
   *  460 and 0.28, that's roughly one ramp per ~870u of roaming. Craig's "how often" knob. */
  rampChance: 0.28,
  /** Ramp radius (world units) — the dome's footprint (≈ rampRadius×2 across). */
  rampRadius: 20,
  /** Ramp peak height (world units) above the surrounding terrain. RAISED (was 7) so that
   *  post-#120 — where EVERY crest gives a little gentle air — a ramp reads as a distinctly
   *  BIGGER, intentional launch you aim for (you launch off a taller dune → more air than an
   *  ambient crest hop). Still GENTLE + lands clean (mask-low placement + #118 soft landing). */
  rampHeight: 11,
  /** Ramps only exist where the mountain mask is at/below this (i.e. GENTLE terrain), so the
   *  launch flings you UP-AND-OUT into open ground — never into a mountain face. */
  rampMaxMask: 0,
  /** Ramp-surface grid TINT: ramp vertices lerp toward this colour by their ramp height, so
   *  a dune reads as an inviting "launch off me" glow you can aim for (a discovery hook). */
  rampTintColor: 0xff66cc,
  // --- obstacle collision: props are SOLID — DEFLECT/SLIDE (replaces the #113 pass-through
  //     slowdown). The car can't enter a prop's circle; it's pushed to the edge along the
  //     normal and slides around (tangential motion preserved). No hard stop, no death. ---
  /** Car radius added to a prop's footprint to form its SOLID circle. Tied to the VISIBLE
   *  prop (≈ the car's half-width), so you slide around the object you SEE — not an
   *  invisible oversized wall. Thin palms/poles are small circles; the block is a big one. */
  deflectCarRadius: 1.0,
  // --- horizon / backdrop (kills the "void"): a serene SUNSET sky + sun + mountain ring
  //     so the upper screen is a WORLD, not black. The grid floor fades into horizonColor
  //     (the fog) so floor → horizon reads seamless. 360°-correct for the free zen camera. ---
  /** Sky + fog colour at the HORIZON (a dark warm sunset purple). The floor's fog fades
   *  to this, and the sky gradient's lower band IS this — so they meet with no seam. */
  horizonColor: 0x2a0b3d,
  /** Sky colour overhead (deep near-black purple). The background gradient runs
   *  skyTopColor (top) → horizonColor (bottom). */
  skyTopColor: 0x0c0118,
  /** World distance the backdrop (sun + mountains) sits from the camera — far, so it
   *  reads as the horizon and barely parallaxes as you drive. */
  backdropDistance: 900,
  /** Compass direction (radians) the sun sits in — 0 = straight ahead (-z) at spawn, so
   *  you face the sunset on entry. Fixed in WORLD space (you drive past it, not with it). */
  sunAzimuth: 0,
  /** Sun disc centre height above the horizon (world units). */
  sunHeight: 250,
  /** Sun disc radius (world units). */
  sunRadius: 150,
  /** Radius of the 360° wireframe mountain ring around the camera (just inside the sun). */
  mountainRingRadius: 850,
  /** Number of peaks around the mountain ring (the horizon silhouette). */
  mountainRingPeaks: 96,
  /** Max mountain peak height (world units) + line opacity — faint, a calm distant ridge. */
  mountainHeight: 90,
  mountainOpacity: 0.5,
} as const;


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
  /** Multiplier on the retained-lateral-velocity fraction — the AGILITY/looseness
   *  lever. <1 settles quicker (planted/precise); >1 holds lateral velocity
   *  longer (a looser, slidier, more tossable tail). Folds in the old `drift`
   *  stat now that the handbrake-drift mechanic is gone, so the former drift
   *  specialists still feel loose and agile to throw around. */
  lateralFriction: number;
}

/** Fallback handling: identical to base on every axis (the pre-stats behaviour).
 *  Used for any car with no `handling` block or an unknown id — never crashes. */
export const BASE_HANDLING: CarHandling = {
  speedCap: 1,
  lateralAccel: 1,
  lateralFriction: 1,
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

/**
 * Per-car SLOW-MO identity (drift→slow-mo PR2) — a THIRD tradeoff axis, opposed to
 * AGILITY (handling.lateralFriction). Two ABSOLUTE values, expressed the same way
 * the uniform PR1 baseline is (a charge COUNT and a sim TIME-SCALE), so there is no
 * magic conversion and the deploy mechanism is reused verbatim:
 *   - cap        max banked charges this car holds (baseline 3). Higher = banks
 *                deeper, so it can stockpile slow-mo for clutch moments.
 *   - timeScale  the sim time-scale while a deployed charge runs (baseline 0.5).
 *                LOWER = a STRONGER slow (more time dilation); higher = milder.
 *
 * The axis is anti-correlated with AGILITY (see CAR_SLOWMO_TABLE): a car that
 * leans on slow-mo (high cap, strong/low timeScale) is LOW-agility, and the loose,
 * agile cars get only a shallow, mild slow-mo. So the roster spans "relies on
 * slow-mo ↔ relies on raw handling," and NO car is strong on both. Pulse sits at
 * the exact baseline (the neutral reference) and trades nothing.
 */
export interface CarSlowMo {
  /** Max banked slow-mo charges (absolute; baseline POWERUPS.slowMoMaxCharges). */
  cap: number;
  /** Sim time-scale while a deployed charge runs (absolute; baseline
   *  POWERUP_DEFS.slowmo.timeScale). LOWER = stronger slow. */
  timeScale: number;
}

/** Neutral slow-mo: the uniform PR1 baseline (cap 3, half-speed). Used for Pulse,
 *  any car with no `slowMo` block, and the unknown-id fallback — so the pure sim
 *  always gets a complete, finite profile and behaves exactly as PR1 did. */
export const BASE_SLOWMO: CarSlowMo = {
  cap: POWERUPS.slowMoMaxCharges,
  timeScale: POWERUP_DEFS.slowmo.timeScale,
};

/*
 * PER-CAR SLOW-MO vs AGILITY (PR2) — the anti-correlated tradeoff, reviewable:
 *
 *   car         agility(LF)  slowMoCap  timeScale   identity
 *   Slipstream    2.02          1         0.70      most agile → least slow-mo
 *   Ghost         1.98          2         0.65      loose tail → shallow, mild slow-mo
 *   Ember         1.35          2         0.60      fast & loose → light slow-mo
 *   Nova          1.23          2         0.55      speed → modest slow-mo
 *   Pulse         1.00          3         0.50      neutral baseline (the reference)
 *   Vapor         0.43          4         0.40      planted grip → deep, strong slow-mo
 *   Onyx          0.33          4         0.35      most planted → deepest, strongest slow-mo
 *
 * Desirability: cap↑ good (banks more), timeScale↓ good (slows harder), agility↑
 * good (looser/tossable). Sorted by agility ASCENDING the cap column is monotone
 * NON-INCREASING and the timeScale column monotone NON-DECREASING — i.e. more
 * agility always costs slow-mo and vice versa, so no car is high on BOTH (the
 * no-dominance invariant, asserted in per_car_slowmo.test.ts). Pulse is the only
 * neutral row; it never wins the slow-mo axis but never loses agility to gain it.
 */

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
 * TRADEOFF-TRIANGLE BALANCE (three axes after the drift→slow-mo PR; the former
 * per-car `drift` stat was folded into lateralFriction, so the loose cars stay
 * loose). Picker bars map 1:1 to the three levers (see carStats):
 *
 *   car         speedCap  lateralAccel  lateralFriction(=oldLF×oldDrift)  identity
 *   Pulse         1.00       1.00          1.00   balanced all-rounder
 *   Vapor         0.84       1.40          0.43   grip / precise, planted, slow
 *   Ember         1.28       0.78          1.35   fast, loose tail, sluggish steer
 *   Ghost         0.92       0.92          1.98   loosest tail — slides through gaps
 *   Nova          1.38       0.60          1.23   glass cannon — speed, no steer
 *   Onyx          0.82       1.62          0.33   surgical grip, most planted
 *   Slipstream    1.16       0.86          2.02   fast & slidey rally hybrid
 *
 * Picker bars: Speed = speedCap, Grip = lateralAccel (steering bite), Agility =
 * lateralFriction (looseness/slide). Desirability per a playstyle: speedCap↑
 * good, lateralAccel↑ good (control), lateralFriction↑ good (agile/tossable —
 * the trait the loose cars are built around). No row is ≥ another on all three
 * axes, so no car strictly dominates — each wins one or two and loses the rest
 * (verified pairwise in the PR's dominance check).
 * NOTE: base lateralFriction is 0.02 and the retained fraction is base^dt, so
 * across the roster the per-frame retention spans ~0.92–0.95 — a real, felt
 * difference in how long the tail carries sideways momentum.
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
  /** Short SLOW-MO descriptor (PR2) shown in the picker beneath the scoring line,
   *  so the slow-mo↔agility tradeoff is READABLE (e.g. "Agile — light on slow-mo"
   *  vs "Stiff but banks deep slow-mo"). */
  slowMoTagline?: string;
  cosmetic: CarCosmetic;
  /** Optional — absent this PR; all cars share VEHICLE physics for now. */
  handling?: CarHandling;
  /** Optional per-car SCORING tradeoff (OPP-07b). Absent → BASE_SCORING (neutral
   *  1/1), so Pulse and any unset car score identically to the base loop. */
  scoring?: CarScoring;
  /** Optional per-car SLOW-MO identity (PR2). Absent → BASE_SLOWMO (the uniform
   *  PR1 baseline), so Pulse and any unset car play exactly as PR1 did. */
  slowMo?: CarSlowMo;
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
    slowMoTagline: 'Slow-mo by the book.',
    // Neutral slow-mo baseline (cap 3, half-speed) — the uniform PR1 reference.
    slowMo: { cap: 3, timeScale: 0.5 },
    cosmetic: { body: 0x0a5560, glow: 0x00ffff, accent: 0xff00ff },
    // Balanced all-rounder: no weakness, no specialty. The 1.0 reference point
    // every other car deviates from.
    handling: { speedCap: 1.0, lateralAccel: 1.0, lateralFriction: 1.0 },
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
    slowMoTagline: 'Planted — banks deep, strong slow.',
    // Grip car leans on slow-mo to offset its low agility: a deep bank (4) and a
    // strong slow (0.40). Pairs with the planted, low-lateralFriction handling.
    slowMo: { cap: 4, timeScale: 0.4 },
    cosmetic: { body: 0x6e1a60, glow: 0xff00ff, accent: 0x00ffff },
    // Grip / precision: snappy, planted steering — the slowest, but the tightest
    // settling tail (folded lateralFriction 0.55×0.78 = 0.43): you place it, it
    // never slides out from under you.
    handling: { speedCap: 0.84, lateralAccel: 1.4, lateralFriction: 0.43 },
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
    slowMoTagline: 'Loose & fast — light on slow-mo.',
    // Loose, agile tail → only a light slow-mo crutch: a shallow bank (2) and a
    // mild slow (0.60). It relies on its handling, not on dilating time.
    slowMo: { cap: 2, timeScale: 0.6 },
    cosmetic: { body: 0x6e3208, glow: 0xff6600, accent: 0xff00ff },
    // Speed / twitchy: high top speed, but sluggish steering and a loose tail
    // (folded lateralFriction 1.35×1.00 = 1.35) — fast in a straight line, a
    // handful to place laterally.
    handling: { speedCap: 1.28, lateralAccel: 0.78, lateralFriction: 1.35 },
    // SPEED look: long, low, sleek, sharp nose, long hood (cabin set back).
    shape: {
      lengthMul: 1.18, widthMul: 0.92, heightMul: 0.82, noseFraction: 0.5,
      cabinLengthFraction: 0.36, cabinHeightFraction: 0.46, cabinRearOffset: 0.3, wheelRadiusMul: 0.95,
    },
  },
  {
    id: 'ghost',
    displayName: 'Ghost',
    tagline: 'Loosest tail — slides through gaps.',
    scoringTagline: 'Combo builds fast, fades fast.',
    // Drift-commit identity in scoring: the strongest build of any car, paid for
    // with the shortest survival window — a high-skill sustain car that rewards
    // relentless near-misses and punishes coasting.
    scoring: { buildMul: 1.25, windowMul: 0.75 },
    slowMoTagline: 'Agile tail — shallow, mild slow-mo.',
    // The roster's loosest tail relies on raw handling, so it gets the shallowest
    // useful bank (2) and a mild slow (0.65) — agility IS its dodge tool.
    slowMo: { cap: 2, timeScale: 0.65 },
    cosmetic: { body: 0x46606e, glow: 0xffffff, accent: 0x00ffff },
    // Looseness specialist: the slidiest tail of the roster (folded lateralFriction
    // 1.2×1.65 = 1.98) for stylish, tossable dodges, at the cost of a little top
    // speed and steering bite vs the balanced Pulse.
    handling: { speedCap: 0.92, lateralAccel: 0.92, lateralFriction: 1.98 },
    // LOOSE look: short, compact, tall kart with big wheels — reads tossable.
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
    slowMoTagline: 'Straight-line speed — modest slow-mo.',
    // Fast and fairly loose → a modest slow-mo: a shallow bank (2) but a slightly
    // stronger slow than Ember/Ghost (0.55), to help place the twitchy top end.
    slowMo: { cap: 2, timeScale: 0.55 },
    cosmetic: { body: 0x202e7e, glow: 0x4d6bff, accent: 0x00ffff },
    // GLASS CANNON: the speed-cap ceiling, but almost no steering authority and a
    // loose tail (folded lateralFriction 1.4×0.88 = 1.23) — a straight-line terror
    // you can barely place. Ember is only mildly fast and stays controllable; Nova
    // trades nearly all grip for the top end.
    handling: { speedCap: 1.38, lateralAccel: 0.6, lateralFriction: 1.23 },
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
    slowMoTagline: 'Stiff tail — banks the deepest, strongest slow.',
    // The most planted car leans hardest on slow-mo: the deepest bank (4) and the
    // strongest slow (0.35) of the roster — slow-mo compensates for its stiffness.
    slowMo: { cap: 4, timeScale: 0.35 },
    cosmetic: { body: 0x4a1f70, glow: 0xb84dff, accent: 0x00ffaa },
    // SURGICAL: maxes grip (sharpest accel) and the tightest, most planted tail of
    // the roster (folded lateralFriction 0.45×0.74 = 0.33 — kills the slide),
    // paying with the lowest top speed — pin it in any gap. The precision extreme
    // beyond Vapor.
    handling: { speedCap: 0.82, lateralAccel: 1.62, lateralFriction: 0.33 },
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
    slowMoTagline: 'Most agile — barely banks slow-mo.',
    // The most agile car of the roster leans entirely on its tail: the shallowest
    // bank (1 — can't stockpile) and the mildest slow (0.70). Pure handling car.
    slowMo: { cap: 1, timeScale: 0.7 },
    cosmetic: { body: 0x3c5e0a, glow: 0xaaff00, accent: 0xff0066 },
    // RALLY HYBRID: fast AND the slidiest tail of all (folded lateralFriction
    // 1.28×1.58 = 2.02) with loose grip — power-slides through gaps, but committed
    // steering. Fills the empty speed+looseness corner (Ghost is loose but slow;
    // Ember is fast but less slidey).
    handling: { speedCap: 1.16, lateralAccel: 0.86, lateralFriction: 2.02 },
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

/**
 * The GENEROUS STARTING SET (PROG-1): cars every fresh profile owns from the start,
 * available everywhere (solo + competitive). Picked for VARIETY — cars are
 * no-dominance sidegrades (#74), so any set is fair; this spans the axes so the
 * free starting choice is meaningful: pulse (balanced), vapor (grip / slow-mo
 * heavy: cap 4 @ 0.4), ember (fast / loose), ghost (loosest tail / drift). The
 * remaining cars (onyx / nova / slipstream) keep their stat-milestone unlocks (and
 * gain a credit-purchase path in PR2). Includes STARTER_CAR_ID.
 */
export const STARTING_CAR_IDS: readonly string[] = ['pulse', 'vapor', 'ember', 'ghost'];

/** localStorage key for cross-run progression (lifetime stats + unlocked cars). */
export const PROGRESS_STORAGE_KEY = 'neon-drift.progress';

/** Blob-schema version for the PROGRESS store (NOT SIM_MATH_VERSION — this is the
 *  meta store's own format). Bumped when the persisted progress shape changes;
 *  PROG-1 adds `credits`, so pre-credits blobs (no version) migrate to credits 0. */
export const PROGRESS_BLOB_VERSION = 1;

/**
 * CREDITS economy (PROG-1) — ONE currency earned from a MIX of sources and (in PR2)
 * spent on cars / cosmetics / modes. HORIZONTAL only: credits never buy stat-power,
 * so the leaderboard + MP/bot fairness are untouched. All first-pass + tunable.
 */
export const CREDITS = {
  /** Per-run drip: floor(score / runScoreDivisor) + floor(distance / runDistanceDivisor),
   *  CAPPED at runCap so a marathon score can't be ground infinitely (races + daily
   *  are the high-value, low-grind paths). */
  runScoreDivisor: 100,
  runDistanceDivisor: 250,
  runCap: 300,
  /** Race WIN bonus (MP + vs-Computer); a small consolation on a non-win finish. */
  raceWin: 50,
  raceConsolation: 10,
  /** Daily challenge: flat for completing today + a streak bonus (per consecutive
   *  day, capped). Awarded once per day (the first run of the day). */
  dailyComplete: 40,
  dailyStreakPerDay: 10,
  dailyStreakCap: 80,
} as const;

/**
 * THE STORE (PROG-1 PR2) — what credits buy. HORIZONTAL only: every item is either
 * a no-dominance car sidegrade (#74) or a purely-visual cosmetic; nothing here buys
 * stat-power, so the leaderboard + MP/bot fairness are untouched. Prices are pegged
 * to the calibrated earn rate and tunable in PR3.
 */

/** A car offered for purchase (the PURCHASE half of dual-unlock: a car unlocks by
 *  hitting its stat milestone OR buying it here). Cars in the widened STARTING SET
 *  are free and NOT listed. Buying adds the id to the SAME `unlocked[]` the stat
 *  path fills, so it's dual-unlock by construction + monotonic. */
export interface StoreCar {
  carId: string;
  price: number;
}
export const STORE_CARS: readonly StoreCar[] = [
  // The deeper-achievement cars (the only ones not in STARTING_CAR_IDS). Tier-2.
  { carId: 'onyx', price: 1200 },
  { carId: 'nova', price: 1200 },
  { carId: 'slipstream', price: 1200 },
] as const;

/** Cosmetic equip slots (one active item per slot). Purely visual. */
export type CosmeticSlot = 'trail' | 'glow';
export const COSMETIC_SLOTS: readonly CosmeticSlot[] = ['trail', 'glow'];

/** A purely-visual cosmetic: a colour applied to a render slot (trail ribbon or the
 *  car's neon glow). ZERO gameplay effect — never touches the sim or per-car
 *  handling. Owned in ProgressStore.owned[]; one equipped per slot. */
export interface Cosmetic {
  id: string;
  name: string;
  slot: CosmeticSlot;
  price: number;
  /** The colour applied to the slot (0xRRGGBB). */
  color: number;
}
export const COSMETICS: readonly Cosmetic[] = [
  { id: 'trail-magenta', name: 'Magenta Trail', slot: 'trail', price: 150, color: 0xff00ff },
  { id: 'trail-toxic', name: 'Toxic Trail', slot: 'trail', price: 150, color: 0x39ff14 },
  { id: 'trail-gold', name: 'Gold Trail', slot: 'trail', price: 250, color: 0xffc400 },
  { id: 'glow-magenta', name: 'Magenta Glow', slot: 'glow', price: 250, color: 0xff00ff },
  { id: 'glow-gold', name: 'Gold Glow', slot: 'glow', price: 250, color: 0xffc400 },
] as const;

/** Resolve a cosmetic by id (catalog lookup), or undefined. */
export function cosmeticById(id: string | null | undefined): Cosmetic | undefined {
  return id ? COSMETICS.find((c) => c.id === id) : undefined;
}


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

/** Cumulative lifetime counters the missions read (the store's own accumulators,
 *  independent of the car-unlock LifetimeStats). */
export interface MissionStats {
  nearMisses: number;
  powerups: number;
  shields: number;
  slowMosDeployed: number;
  midnightReaches: number;
  distance: number;
}
export type CumulativeMetric = keyof MissionStats;

export const EMPTY_MISSION_STATS: MissionStats = {
  nearMisses: 0,
  powerups: 0,
  shields: 0,
  slowMosDeployed: 0,
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
  { id: 'sm5', label: 'Deploy 5 slow-mos', target: 5, kind: 'cumulative', metric: 'slowMosDeployed' },
  { id: 'mid3', label: 'Reach the Midnight biome 3×', target: 3, kind: 'cumulative', metric: 'midnightReaches' },
  { id: 'run6k', label: 'Score 6,000 in one run', target: 6000, kind: 'perRun', metric: 'score' },
  { id: 'nm60', label: 'Thread 60 near-misses', target: 60, kind: 'cumulative', metric: 'nearMisses' },
  { id: 'pu40', label: 'Collect 40 powerups', target: 40, kind: 'cumulative', metric: 'powerups' },
  { id: 'sm15', label: 'Deploy 15 slow-mos', target: 15, kind: 'cumulative', metric: 'slowMosDeployed' },
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
  { name: 'Time Bender', missionsRequired: 6, reward: { title: 'Time Bender', startBiome: 2 } }, // Toxic
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
 * Resolve the SLOW-MO identity for a car id (PR2). Falls back to BASE_SLOWMO (the
 * uniform PR1 baseline) for an unknown id or a car with no `slowMo` block — so the
 * pure sim always gets a complete, finite profile and Pulse plays exactly as PR1.
 */
export function slowMoFor(id: string): CarSlowMo {
  return CARS.find((c) => c.id === id)?.slowMo ?? BASE_SLOWMO;
}

/**
 * Normalisation ranges for the picker's Speed / Grip / Agility bars. The bars are
 * DERIVED from the same `handling` multipliers the sim uses (see carStats) — the
 * single source of truth — so they can never be hand-authored out of sync with
 * the physics. Each bar now maps 1:1 to one physics lever (no ratios), chosen to
 * span the roster's spread with a little headroom.
 */
export const CAR_STAT_RANGE = {
  /** Speed = speedCap (top speed). Roster spans 0.82–1.38. */
  speed: { min: 0.8, max: 1.4 },
  /** Grip = lateralAccel (steering authority / bite). Roster spans 0.60–1.62. */
  grip: { min: 0.55, max: 1.7 },
  /** Agility = lateralFriction (looseness / slide — folds in the old drift stat).
   *  Roster spans 0.33–2.02; higher = a looser, more tossable tail. */
  agility: { min: 0.3, max: 2.1 },
} as const;

export interface CarStats {
  /** 0..1 bar fills. */
  speed: number;
  grip: number;
  agility: number;
}

function norm01(v: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (v - min) / (max - min)));
}

/**
 * Derive the 0..1 Speed / Grip / Agility bars from a car's handling multipliers.
 * The picker MUST read its bars from here so a change to a handling number moves
 * both the physics and the displayed bar together. Each bar is one lever: Speed =
 * speedCap, Grip = lateralAccel (steering bite), Agility = lateralFriction (how
 * loose / slidey the tail is — higher = more tossable).
 */
export function carStats(h: CarHandling): CarStats {
  return {
    speed: norm01(h.speedCap, CAR_STAT_RANGE.speed.min, CAR_STAT_RANGE.speed.max),
    grip: norm01(h.lateralAccel, CAR_STAT_RANGE.grip.min, CAR_STAT_RANGE.grip.max),
    agility: norm01(h.lateralFriction, CAR_STAT_RANGE.agility.min, CAR_STAT_RANGE.agility.max),
  };
}

/** CSS hex string for a 0xRRGGBB color (for HTML/CSS previews of car colors). */
export function cssHex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}
