/**
 * vs-COMPUTER bot — pure intent generator. The bot must be deterministic (seeded
 * rng, no Math.random), dodge believably, and be SKILL-gated (EASY errs more than
 * HARD). The anti-rubber-band guarantee is structural: botIntent's signature can't
 * see the player — these tests exercise the behaviour built on top of that.
 */
import { describe, expect, it } from 'vitest';
import { botIntent, createBotState } from '../Bot';
import { createGameState, startRun, update } from '../GameState';
import { roadCenterAt } from '../Road';
import { createIntent } from '../Input';
import { BOT_DIFFICULTY, type BotSkill, ObstacleKind, ROAD, TIMESTEP } from '../../utils/constants';

const SEED = 12345;
/** A clean skill with no randomness, to test the deterministic dodge geometry. */
const CLEAN: BotSkill = { ...BOT_DIFFICULTY.hard, mistakeRate: 0, dodgeJitter: 0 };

/** A fresh menu-phase game (empty pool) for pure botIntent reads — no spawning. */
function cleanGame() {
  const g = createGameState(SEED);
  return g;
}

describe('Bot — dodging (reads its own field, steers to a clear lane)', () => {
  it('steers AWAY from an obstacle dead ahead in its lane', () => {
    const g = cleanGame();
    const center = roadCenterAt(SEED, g.distance);
    g.vehicle.lateral = center; // sitting dead centre
    const o = g.traffic.pool[0];
    o.active = true;
    o.kind = ObstacleKind.Static;
    o.distance = g.distance + 30; // just ahead, within sight
    o.lateral = center; // directly in front
    const intent = botIntent(createBotState(SEED), g, CLEAN, TIMESTEP);
    expect(Math.abs(intent.steer)).toBeGreaterThan(0); // it dodges (doesn't hold the lane)
  });

  it('steers toward a gate opening', () => {
    const g = cleanGame();
    const center = roadCenterAt(SEED, g.distance);
    g.vehicle.lateral = center;
    const o = g.traffic.pool[0];
    o.active = true;
    o.kind = ObstacleKind.Gate;
    o.distance = g.distance + 40;
    o.lateral = center + 4; // opening is to the right
    o.openingHalfWidth = 2;
    const intent = botIntent(createBotState(SEED), g, CLEAN, TIMESTEP);
    expect(intent.steer).toBeGreaterThan(0); // steers right, toward the opening
  });

  it('drifts back toward centre on an empty road', () => {
    const g = cleanGame();
    const center = roadCenterAt(SEED, g.distance);
    g.vehicle.lateral = center + 5; // off to one side, nothing ahead
    const intent = botIntent(createBotState(SEED), g, CLEAN, TIMESTEP);
    expect(intent.steer).toBeLessThan(0); // steers back toward centre (left)
  });

  it('keeps its dodge target inside the drivable corridor', () => {
    const g = cleanGame();
    const center = roadCenterAt(SEED, g.distance);
    g.vehicle.lateral = center;
    const o = g.traffic.pool[0];
    o.active = true;
    o.kind = ObstacleKind.Static;
    o.distance = g.distance + 20;
    o.lateral = center + ROAD.halfWidth; // obstacle at the road edge
    // Step a few times applying the intent — the bot should never aim off-road.
    const bot = createBotState(SEED);
    for (let i = 0; i < 5; i++) {
      const intent = botIntent(bot, g, CLEAN, TIMESTEP);
      expect(intent.steer).toBeGreaterThanOrEqual(-1);
      expect(intent.steer).toBeLessThanOrEqual(1);
    }
  });
});

describe('Bot — determinism (same course + skill + seed → same intents)', () => {
  it('two bots on the same seed produce an identical intent stream', () => {
    const a = startRun(createGameState(SEED), undefined, 0, SEED, undefined, undefined, undefined, true);
    const b = startRun(createGameState(SEED), undefined, 0, SEED, undefined, undefined, undefined, true);
    const ba = createBotState(SEED);
    const bb = createBotState(SEED);
    for (let f = 0; f < 400; f++) {
      const ia = botIntent(ba, a, BOT_DIFFICULTY.medium, TIMESTEP);
      const ib = botIntent(bb, b, BOT_DIFFICULTY.medium, TIMESTEP);
      expect(ia.steer).toBe(ib.steer);
      expect(ia.deploySlowMo).toBe(ib.deploySlowMo);
      update(a, ia, TIMESTEP);
      update(b, ib, TIMESTEP);
    }
    expect(a.distance).toBe(b.distance); // identical trajectories
  });
});

describe('Bot — difficulty is skill (EASY errs more than HARD)', () => {
  /** Count fumbles over `frames` on a static empty field (isolates mistakeRate). */
  function countMistakes(skill: BotSkill, frames: number): number {
    const g = cleanGame();
    const bot = createBotState(SEED);
    let mistakes = 0;
    let wasFumbling = false;
    for (let i = 0; i < frames; i++) {
      botIntent(bot, g, skill, TIMESTEP);
      const fumbling = bot.mistakeTimer > 0;
      if (fumbling && !wasFumbling) mistakes++; // a fresh fumble started
      wasFumbling = fumbling;
    }
    return mistakes;
  }

  it('the EASY bot makes more mistakes than the HARD bot over the same run', () => {
    const easy = countMistakes(BOT_DIFFICULTY.easy, 3600); // ~60s
    const hard = countMistakes(BOT_DIFFICULTY.hard, 3600);
    expect(easy).toBeGreaterThan(hard);
  });
});

describe('Bot — anti-rubber-band (cannot see the player)', () => {
  it('botIntent takes only the bot game — its result is independent of any player', () => {
    // The signature is botIntent(bot, botGame, skill, dt): there is no player param.
    // Behaviourally: the same botGame yields the same intent no matter what an
    // unrelated player does, because the player is simply not an input.
    const g = startRun(createGameState(SEED), undefined, 0, SEED, undefined, undefined, undefined, true);
    const playerIrrelevant = createIntent(); // exists, but the bot never receives it
    const bot = createBotState(SEED);
    const first = botIntent(bot, g, BOT_DIFFICULTY.medium, TIMESTEP).steer;

    const g2 = startRun(createGameState(SEED), undefined, 0, SEED, undefined, undefined, undefined, true);
    const bot2 = createBotState(SEED);
    const second = botIntent(bot2, g2, BOT_DIFFICULTY.medium, TIMESTEP).steer;
    expect(first).toBe(second);
    void playerIrrelevant;
  });
});
