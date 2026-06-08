/**
 * Collectible powerups: a RECYCLED POOL of pickups plus the player's active
 * effect state. PURE — no three, no DOM. Mirrors Traffic's bounded-pool design
 * (allocate once, activate a slot to spawn, deactivate to recycle — the pool
 * never grows and nothing is allocated per frame).
 *
 * The four effects hook the existing systems through small, explicit seams
 * (see GameState.update): SLOW-MO yields a sim time-scale, SCORE-BOOST a score
 * multiplier, SHIELD an intercept on the crash path, MAGNET an attraction pass
 * over the pickups. Randomness comes from the pickups' OWN seeded Rng (seeded
 * off the run seed but a separate stream), so adding powerups never perturbs
 * the traffic sequence for a given seed.
 */

import { aabbOverlap, clamp, lerp } from '../utils/math';
import {
  BASE_SLOWMO,
  MP_SPAWN,
  POWERUPS,
  POWERUP_DEFS,
  POWERUP_ORDER,
  PowerupKind,
  ROAD,
  VEHICLE,
  type CarSlowMo,
  type PowerupDef,
} from '../utils/constants';
import { roadCenterAt } from './Road';
import { hashNoise, Rng } from '../utils/rng';
import type { TrafficEvents } from './Scoring';

export interface Pickup {
  active: boolean;
  /** Unique id within a run (stable while active; for renderer pooling). */
  id: number;
  /** Which powerup this pickup grants. */
  kind: PowerupKind;
  /** Absolute lateral position (road centre + lane offset, clamped to road). */
  lateral: number;
  /** Lane position as an offset from the road centre (tracks the curve). */
  laneOffset: number;
  /** Forward distance from the run start (world units). Pickups are stationary
   *  unless the MAGNET pulls them. */
  distance: number;
}

/** The player's active powerup effects. Timers are SECONDS REMAINING (0 = off). */
export interface PowerupEffects {
  /** A held SHIELD charge, ready to absorb the next crash. */
  shield: boolean;
  /** Post-shield invulnerability window (s) — crashes are ignored while > 0. */
  invulnTimer: number;
  /** Banked SLOW-MO charges (0..slowMoCap). Collecting a slow-mo pickup adds one
   *  (capped at the per-car slowMoCap); the DEPLOY control spends one. */
  slowMoCharges: number;
  /** Per-car bank CAP for slow-mo charges (PR2). Set at run start from the
   *  selected car's slowMo profile (BASE_SLOWMO.cap when unset). Travels on the
   *  effects so applyEffect/deploy stay self-contained and per-car automatically. */
  slowMoCap: number;
  /** Per-car slow-mo STRENGTH (PR2): the sim time-scale applied while a deployed
   *  charge runs (LOWER = stronger slow). Set at run start from the car's slowMo
   *  profile (BASE_SLOWMO.timeScale when unset); read by powerupTimeScale. */
  slowMoTimeScale: number;
  /** SLOW-MO remaining (s) on the currently-deployed charge. */
  slowMoTimer: number;
  /** SCORE-BOOST remaining (s). */
  scoreBoostTimer: number;
  /** MAGNET remaining (s). */
  magnetTimer: number;
}

export interface PowerupState {
  /** Fixed-size pool (length never changes after init). */
  pool: Pickup[];
  /** Separate seeded stream so spawns don't perturb traffic for a given seed. */
  rng: Rng;
  /** The player's active effects. */
  effects: PowerupEffects;
  /** Seconds since the last spawn. */
  sinceSpawn: number;
  /** Next pickup id to assign. */
  nextId: number;
  /** Telemetry: total pickups ever spawned. */
  spawned: number;
  /** Telemetry: total pickups ever culled (passed uncollected). */
  culled: number;
  /** Telemetry: total pickups ever collected. */
  collected: number;
  /** MP shared-course only: next distance band to consider (monotonic). Unused in SP. */
  nextBand: number;
}

/** Fresh effects. The slow-mo cap/strength default to BASE_SLOWMO (the uniform PR1
 *  baseline); a run overrides them per-car via createPowerupState's `slowMo` arg. */
export function createPowerupEffects(): PowerupEffects {
  return {
    shield: false,
    invulnTimer: 0,
    slowMoCharges: 0,
    slowMoCap: BASE_SLOWMO.cap,
    slowMoTimeScale: BASE_SLOWMO.timeScale,
    slowMoTimer: 0,
    scoreBoostTimer: 0,
    magnetTimer: 0,
  };
}

/** Build the pickup pool + effects for a run. `slowMo` is the selected car's
 *  slow-mo identity (PR2) — its cap/strength are stamped onto the effects so the
 *  whole slow-mo loop is per-car without threading the profile through every call.
 *  Defaults to BASE_SLOWMO so existing callers/tests get the uniform baseline. */
export function createPowerupState(seed: number, slowMo: CarSlowMo = BASE_SLOWMO): PowerupState {
  const pool: Pickup[] = [];
  for (let i = 0; i < POWERUPS.poolSize; i++) {
    pool.push({ active: false, id: -1, kind: PowerupKind.Shield, lateral: 0, laneOffset: 0, distance: 0 });
  }
  const effects = createPowerupEffects();
  effects.slowMoCap = slowMo.cap;
  effects.slowMoTimeScale = slowMo.timeScale;
  return {
    pool,
    rng: new Rng((seed ^ POWERUPS.rngSalt) >>> 0),
    effects,
    sinceSpawn: 0,
    nextId: 0,
    spawned: 0,
    culled: 0,
    collected: 0,
    nextBand: 0,
  };
}

/** Spawn interval (s) for a given distance — flat through the grace period, then
 *  shrinks toward a floor. Always rarer than traffic. */
export function powerupSpawnInterval(distance: number): number {
  const ramped = Math.max(0, distance - POWERUPS.rampStartDistance);
  return clamp(
    POWERUPS.baseSpawnInterval - ramped * POWERUPS.spawnRampPerUnit,
    POWERUPS.minSpawnInterval,
    POWERUPS.baseSpawnInterval,
  );
}

/** Count of currently-active pickups (telemetry). */
export function activePickupCount(state: PowerupState): number {
  let n = 0;
  for (const p of state.pool) if (p.active) n++;
  return n;
}

/** Total weight of all powerup kinds (constant; derived from the defs). */
const TOTAL_SPAWN_WEIGHT = POWERUP_ORDER.reduce((sum, k) => sum + POWERUP_DEFS[k].spawnWeight, 0);

/** Weighted random pick of a powerup kind from the pickups' rng stream. */
export function pickKind(rng: Rng): PowerupKind {
  let roll = rng.next() * TOTAL_SPAWN_WEIGHT;
  for (const k of POWERUP_ORDER) {
    roll -= POWERUP_DEFS[k].spawnWeight;
    if (roll < 0) return k;
  }
  return POWERUP_ORDER[POWERUP_ORDER.length - 1];
}

function firstInactive(state: PowerupState): Pickup | null {
  for (const p of state.pool) if (!p.active) return p;
  return null;
}

/** Absolute lateral for a pickup: road centre at its distance + lane offset,
 *  clamped to the drivable corridor so it always sits on the road. Pure. */
function resolveLateral(p: Pickup, seed: number): number {
  const center = roadCenterAt(seed, p.distance);
  return clamp(center + p.laneOffset, center - ROAD.halfWidth, center + ROAD.halfWidth);
}

/**
 * Advance the pickup pool by `dt` seconds: apply MAGNET attraction, cull pickups
 * left behind, and spawn new ones on the (rare) cadence. Mutates and returns
 * `state`; allocates nothing. `dt` here is the SIM dt (scaled by slow-mo) so
 * pickups slow with everything else.
 */
/** A field hash in [0, 1) for a powerup band + slot. */
function pBandHash01(seed: number, band: number, field: number): number {
  return (hashNoise((seed ^ POWERUPS.rngSalt) >>> 0, band * 8 + field) + 1) * 0.5;
}

/** Deterministic powerup-kind pick (same weight table, rolled by hash). */
function pickKindDet(seed: number, band: number): PowerupKind {
  let roll = pBandHash01(seed, band, 1) * TOTAL_SPAWN_WEIGHT;
  for (const k of POWERUP_ORDER) {
    roll -= POWERUP_DEFS[k].spawnWeight;
    if (roll < 0) return k;
  }
  return POWERUP_ORDER[POWERUP_ORDER.length - 1];
}

/**
 * MP SHARED-COURSE powerups (2P race only) — position-deterministic, like traffic.
 * The magnet PULL is skipped in MP (it mutates a pickup toward THIS car → would
 * diverge the shared field); the magnet effect still applies on pickup. SP untouched.
 */
function updatePickupsShared(state: PowerupState, seed: number, playerDistance: number): PowerupState {
  const cullLine = playerDistance - POWERUPS.cullBehind;
  for (const p of state.pool) {
    if (!p.active) continue;
    p.lateral = resolveLateral(p, seed);
    if (p.distance < cullLine) {
      p.active = false;
      state.culled++;
    }
  }
  const aheadLimit = playerDistance + POWERUPS.spawnAhead;
  while (state.nextBand * MP_SPAWN.powerupBandWidth <= aheadLimit) {
    const b = state.nextBand++;
    const d = b * MP_SPAWN.powerupBandWidth;
    if (d >= MP_SPAWN.startGrace && d >= cullLine && pBandHash01(seed, b, 0) < MP_SPAWN.powerupSpawnProb) {
      const slot = firstInactive(state);
      if (slot) {
        const spread = ROAD.halfWidth * POWERUPS.lateralSpread;
        slot.active = true;
        slot.id = state.nextId++;
        slot.kind = pickKindDet(seed, b);
        slot.distance = d + pBandHash01(seed, b, 2) * MP_SPAWN.powerupBandWidth;
        slot.laneOffset = (pBandHash01(seed, b, 4) * 2 - 1) * spread;
        slot.lateral = resolveLateral(slot, seed);
        state.spawned++;
      }
    }
  }
  return state;
}

export function updatePickups(
  state: PowerupState,
  seed: number,
  playerDistance: number,
  playerLateral: number,
  dt: number,
  mpRace = false,
): PowerupState {
  // MP RACE: position-deterministic shared course (separate path). SP falls through.
  if (mpRace) return updatePickupsShared(state, seed, playerDistance);

  const magnetOn = state.effects.magnetTimer > 0;
  const cullLine = playerDistance - POWERUPS.cullBehind;

  for (const p of state.pool) {
    if (!p.active) continue;

    if (magnetOn) {
      const ahead = p.distance - playerDistance;
      // Pull only pickups ahead and within range — toward the player laterally
      // AND longitudinally so they home in.
      if (ahead >= 0 && ahead <= POWERUPS.magnetRange) {
        const k = clamp(POWERUPS.magnetPull * dt, 0, 1);
        p.distance = lerp(p.distance, playerDistance, k);
        const center = roadCenterAt(seed, p.distance);
        p.laneOffset = lerp(p.laneOffset, playerLateral - center, k);
      }
    }

    p.lateral = resolveLateral(p, seed);

    if (p.distance < cullLine) {
      p.active = false;
      state.culled++;
    }
  }

  // Spawn on the rare cadence.
  state.sinceSpawn += dt;
  if (state.sinceSpawn >= powerupSpawnInterval(playerDistance)) {
    const slot = firstInactive(state);
    if (slot) {
      const spread = ROAD.halfWidth * POWERUPS.lateralSpread;
      slot.active = true;
      slot.id = state.nextId++;
      slot.kind = pickKind(state.rng);
      slot.laneOffset = state.rng.range(-spread, spread);
      slot.distance = playerDistance + POWERUPS.spawnAhead;
      slot.lateral = resolveLateral(slot, seed);
      state.spawned++;
    }
    // Whether or not a slot was free, reset the timer (saturated → defer one
    // interval rather than busy-retrying).
    state.sinceSpawn = 0;
  }

  return state;
}

/**
 * Grant a powerup's effect directly, with no pickup involved — e.g. a distance
 * milestone awarding a free shield. Routes through the SAME applyEffect path as
 * collecting one, so a granted effect behaves identically. Pure.
 */
export function grantPowerup(effects: PowerupEffects, kind: PowerupKind): void {
  applyEffect(effects, POWERUP_DEFS[kind]);
}

function applyEffect(effects: PowerupEffects, def: PowerupDef): void {
  switch (def.id) {
    case PowerupKind.Shield:
      effects.shield = true;
      break;
    case PowerupKind.SlowMo:
      // Slow-mo BANKS instead of firing on pickup: stash a charge (capped at the
      // PER-CAR slowMoCap) for the player to DEPLOY on demand. Covers milestone-
      // granted slow-mo too, since grantPowerup routes through here.
      effects.slowMoCharges = Math.min(effects.slowMoCharges + 1, effects.slowMoCap);
      break;
    case PowerupKind.ScoreBoost:
      effects.scoreBoostTimer = def.duration;
      break;
    case PowerupKind.Magnet:
      effects.magnetTimer = def.duration;
      break;
  }
}

/**
 * Collect any pickup whose box overlaps the player box: deactivate it (recycle)
 * and apply its effect. Records the LAST kind collected this step on
 * `events.collected` (mutate-in-place, for juice/audio). A pickup overlapping
 * the player is collected even during shield i-frames — pickups are never a
 * threat.
 */
export function collectPickups(
  state: PowerupState,
  playerLateral: number,
  playerDistance: number,
  events: TrafficEvents,
): void {
  for (const p of state.pool) {
    if (!p.active) continue;
    if (
      aabbOverlap(
        playerLateral,
        playerDistance,
        VEHICLE.halfWidth,
        VEHICLE.halfLength,
        p.lateral,
        p.distance,
        POWERUPS.halfWidth,
        POWERUPS.halfLength,
      )
    ) {
      p.active = false;
      state.collected++;
      applyEffect(state.effects, POWERUP_DEFS[p.kind]);
      events.collected = p.kind;
    }
  }
}

/** Decay all active-effect timers by `dt` REAL seconds (wall-clock durations,
 *  independent of slow-mo). Mutates and returns `effects`. */
export function tickEffects(effects: PowerupEffects, dt: number): PowerupEffects {
  if (effects.invulnTimer > 0) effects.invulnTimer = Math.max(0, effects.invulnTimer - dt);
  if (effects.slowMoTimer > 0) effects.slowMoTimer = Math.max(0, effects.slowMoTimer - dt);
  if (effects.scoreBoostTimer > 0) effects.scoreBoostTimer = Math.max(0, effects.scoreBoostTimer - dt);
  if (effects.magnetTimer > 0) effects.magnetTimer = Math.max(0, effects.magnetTimer - dt);
  return effects;
}

/** Sim time scale from the active effects (SLOW-MO). 1 = normal. While a deployed
 *  charge runs, returns the PER-CAR strength (slowMoTimeScale) — lower = a stronger
 *  slow. (Reuses the existing simDt time-scale seam; no new mechanism.) */
export function powerupTimeScale(effects: PowerupEffects): number {
  return effects.slowMoTimer > 0 ? effects.slowMoTimeScale : 1;
}

/** Score-gain multiplier from the active effects (SCORE-BOOST). 1 = normal. */
export function powerupScoreMultiplier(effects: PowerupEffects): number {
  return effects.scoreBoostTimer > 0 ? POWERUP_DEFS.scoreBoost.scoreMultiplier : 1;
}

/**
 * Consume a held SHIELD charge if one is available. Returns true if a charge was
 * spent (the caller should swallow the crash and grant i-frames). Pure.
 */
export function consumeShield(effects: PowerupEffects): boolean {
  if (!effects.shield) return false;
  effects.shield = false;
  return true;
}

/**
 * DEPLOY one banked SLOW-MO charge: spend a charge and start a slow-mo window
 * (the same window collecting one used to start automatically — reuses the
 * powerupTimeScale / simDt seam). No-op (returns false) when the bank is empty
 * OR a slow-mo is already running, so a charge can't be wasted stacking on an
 * active one. Mirrors consumeShield's held-charge pattern. Pure.
 */
export function deploySlowMo(effects: PowerupEffects): boolean {
  if (effects.slowMoCharges <= 0 || effects.slowMoTimer > 0) return false;
  effects.slowMoCharges -= 1;
  effects.slowMoTimer = POWERUP_DEFS.slowmo.duration;
  return true;
}
