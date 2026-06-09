/**
 * vs-COMPUTER opponent — pure, deterministic intent generator. NO three, no DOM,
 * no Math.random/Date.now (all randomness comes from a seeded Rng), so a bot race
 * is reproducible/replayable exactly like a ghost or an MP run.
 *
 * ANTI-RUBBER-BAND (structural): `botIntent` is handed ONLY the bot's OWN GameState,
 * its skill, and its rng — its signature literally cannot see the player's car,
 * distance, or the gap. The bot drives at its skill level regardless of who's
 * winning; it can crash-slow itself (the same MP_CRASH penalty the player gets),
 * but it never gets magic catch-up speed. Beating HARD is earned; EASY is fair.
 *
 * Each sub-step the bot SENSES the upcoming (deterministic, shared) obstacle field
 * ahead of its own car, CHOOSES a clear target lane (gate opening / a gap past an
 * obstacle / drift to centre), STEERS toward it, and optionally DEPLOYS a banked
 * slow-mo in a tight spot — all scaled by the skill knobs (see BotSkill / BOT).
 */

import { clamp } from '../utils/math';
import { Rng } from '../utils/rng';
import { BOT, type BotSkill, ObstacleKind, ROAD } from '../utils/constants';
import { roadCenterAt } from './Road';
import { createIntent, type InputIntent } from './Input';
import type { GameState } from './GameState';

/** The bot's small persistent state: its private mistake-rng + a held "fumble" so a
 *  mistake reads as a beat of hesitation rather than a 1-frame flicker. */
export interface BotState {
  rng: Rng;
  /** Seconds left holding the current mistake steer (0 = driving normally). */
  mistakeTimer: number;
  /** The (wrong/weak) steer held during a mistake. */
  mistakeSteer: number;
}

/** Fresh bot state, seeded off the run seed but on its OWN stream (BOT.rngSalt) so
 *  the bot's randomness never perturbs — or is perturbed by — the sim's draws. */
export function createBotState(seed: number): BotState {
  return { rng: new Rng((seed ^ BOT.rngSalt) >>> 0), mistakeTimer: 0, mistakeSteer: 0 };
}

/** Pick the lane (absolute lateral) that clears `obsLateral` by BOT.clearance and is
 *  nearest to the bot's current lateral (least movement). Falls back to steering to
 *  the side with more room if no candidate clears (a very wide obstacle). */
function pickClearLane(center: number, botLateral: number, obsLateral: number): number {
  let best = NaN;
  let bestCost = Infinity;
  for (const offset of BOT.laneCandidates) {
    const laneLat = center + offset;
    if (Math.abs(laneLat - obsLateral) >= BOT.clearance) {
      const cost = Math.abs(laneLat - botLateral);
      if (cost < bestCost) {
        bestCost = cost;
        best = laneLat;
      }
    }
  }
  if (!Number.isNaN(best)) return best;
  // No candidate clears: dodge to the road edge farther from the obstacle.
  const room = Math.max(0, ROAD.halfWidth - BOT.clearance);
  return obsLateral >= center ? center - room : center + room;
}

/**
 * Produce the bot's intent for ONE sub-step. Mutates `bot` (advances its rng +
 * mistake timer). `dt` is the fixed sub-step (TIMESTEP). Reads ONLY `game` (the
 * bot's own state) — never the player's.
 */
export function botIntent(bot: BotState, game: GameState, skill: BotSkill, dt: number): InputIntent {
  const intent = createIntent();

  // Hold an in-progress fumble: keep the bad steer, make no other decision.
  if (bot.mistakeTimer > 0) {
    bot.mistakeTimer = Math.max(0, bot.mistakeTimer - dt);
    intent.steer = bot.mistakeSteer;
    return intent;
  }
  // Roll a fresh mistake (rate is per-second → scale by dt). A fumble is a wrong/weak
  // steer held briefly — the visible "imperfect dodge" that makes EASY beatable.
  if (bot.rng.next() < skill.mistakeRate * dt) {
    bot.mistakeTimer = BOT.mistakeHoldSeconds;
    bot.mistakeSteer = clamp(bot.rng.range(-1, 1) * 0.5, -1, 1);
    intent.steer = bot.mistakeSteer;
    return intent;
  }

  // SENSE: nearest hazard ahead within sight (ramps are beneficial → not a hazard).
  const center = roadCenterAt(game.seed, game.distance);
  const botLateral = game.vehicle.lateral;
  let nearest: { lateral: number; kind: ObstacleKind } | null = null;
  let nearestGap = Infinity;
  for (const o of game.traffic.pool) {
    if (!o.active || o.kind === ObstacleKind.Ramp) continue;
    const ahead = o.distance - game.distance;
    if (ahead <= 0 || ahead > skill.reactionDistance) continue;
    if (ahead < nearestGap) {
      nearestGap = ahead;
      nearest = { lateral: o.lateral, kind: o.kind };
    }
  }

  // CHOOSE a target lateral: gate → opening centre; obstacle → a clearing lane;
  // open road → drift back to centre.
  let targetLateral = center;
  if (nearest) {
    targetLateral =
      nearest.kind === ObstacleKind.Gate ? nearest.lateral : pickClearLane(center, botLateral, nearest.lateral);
  }
  // Sloppiness: jitter the aim (seeded), then clamp to the drivable corridor.
  targetLateral += bot.rng.range(-skill.dodgeJitter, skill.dodgeJitter);
  targetLateral = clamp(targetLateral, center - ROAD.halfWidth, center + ROAD.halfWidth);

  // STEER toward the target lane.
  intent.steer = clamp((targetLateral - botLateral) * skill.steerGain, -1, 1);

  // SLOW-MO: in a tight spot with a charge banked, deploy (skill-gated). The deploy
  // guard in update() ignores it when a slow-mo is already running or the bank is
  // empty, so this can never waste a charge.
  const fx = game.powerups.effects;
  if (skill.slowMoTriggerDistance > 0 && nearest && nearestGap <= skill.slowMoTriggerDistance && fx.slowMoCharges > 0 && fx.slowMoTimer <= 0) {
    intent.deploySlowMo = true;
  }

  return intent;
}
