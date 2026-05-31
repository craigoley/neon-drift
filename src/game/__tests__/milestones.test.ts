import { describe, expect, it } from 'vitest';
import { createMilestoneState, updateMilestones } from '../Milestones';
import { createPowerupEffects } from '../Powerups';
import { createScoreState, type TrafficEvents } from '../Scoring';
import { MILESTONES, OBJECTIVES, PowerupKind, TIMESTEP, VEHICLE } from '../../utils/constants';
import { createGameState, Phase, returnToMenu, startRun, update } from '../GameState';
import { createIntent } from '../Input';

function events(): TrafficEvents {
  return {
    crashed: false,
    nearMisses: 0,
    collected: null,
    shieldBlocked: false,
    rampBoosts: 0,
    milestone: null,
    biomeChanged: false,
    objectiveDone: null,
  };
}

const firstReward = MILESTONES[0].reward;

describe('Milestones — distance thresholds fire once, in order', () => {
  it('fires nothing before the first threshold', () => {
    const ms = createMilestoneState();
    const ev = events();
    updateMilestones(ms, MILESTONES[0].distance - 1, 0, createPowerupEffects(), createScoreState(), ev);
    expect(ms.nextIndex).toBe(0);
    expect(ev.milestone).toBeNull();
  });

  it('fires the first milestone exactly at its threshold and grants its reward', () => {
    const ms = createMilestoneState();
    const effects = createPowerupEffects();
    const score = createScoreState();
    const ev = events();
    updateMilestones(ms, MILESTONES[0].distance, 0, effects, score, ev);
    expect(ms.nextIndex).toBe(1);
    expect(ev.milestone).toBe(MILESTONES[0].label);
    // The default table's first reward is a shield grant.
    if (firstReward.kind === 'powerup' && firstReward.powerup === PowerupKind.Shield) {
      expect(effects.shield).toBe(true);
    }
  });

  it('does not re-fire or re-grant a milestone already passed', () => {
    const ms = createMilestoneState();
    const effects = createPowerupEffects();
    const score = createScoreState();
    updateMilestones(ms, MILESTONES[0].distance, 0, effects, score, events());
    expect(ms.nextIndex).toBe(1);
    // Clear the granted effect and re-run at the same distance: nothing fires.
    effects.shield = false;
    const ev2 = events();
    updateMilestones(ms, MILESTONES[0].distance, 0, effects, score, ev2);
    expect(ms.nextIndex).toBe(1);
    expect(ev2.milestone).toBeNull();
    expect(effects.shield).toBe(false);
  });

  it('a single large step crossing several thresholds fires them all (in order)', () => {
    const ms = createMilestoneState();
    const effects = createPowerupEffects();
    const score = createScoreState();
    const ev = events();
    const third = MILESTONES[2].distance;
    updateMilestones(ms, third, 0, effects, score, ev);
    expect(ms.nextIndex).toBe(3);
    // The toast shows the LAST milestone crossed this step.
    expect(ev.milestone).toBe(MILESTONES[2].label);
  });

  it('a score-reward milestone adds to the score exactly once', () => {
    const scoreMilestone = MILESTONES.find((m) => m.reward.kind === 'score');
    expect(scoreMilestone).toBeDefined();
    const ms = createMilestoneState();
    const score = createScoreState();
    const before = score.score;
    updateMilestones(ms, scoreMilestone!.distance, 0, createPowerupEffects(), score, events());
    const reward = scoreMilestone!.reward;
    if (reward.kind === 'score') expect(score.score).toBe(before + reward.amount);
    // Re-running past it does not add again.
    const after = score.score;
    updateMilestones(ms, scoreMilestone!.distance, 0, createPowerupEffects(), score, events());
    expect(score.score).toBe(after);
  });

  it('never fires beyond the end of the table (and never throws)', () => {
    const ms = createMilestoneState();
    const score = createScoreState();
    updateMilestones(ms, 1e9, 0, createPowerupEffects(), score, events());
    expect(ms.nextIndex).toBe(MILESTONES.length);
    const ev = events();
    updateMilestones(ms, 1e9, 0, createPowerupEffects(), score, ev);
    expect(ev.milestone).toBeNull();
    expect(Number.isFinite(score.score)).toBe(true);
  });
});

describe('Milestones — biome change celebration', () => {
  it('fires once each time the biome index advances, not while it holds', () => {
    const ms = createMilestoneState();
    const effects = createPowerupEffects();
    const score = createScoreState();

    const a = events();
    updateMilestones(ms, 10, 0, effects, score, a); // still biome 0
    expect(a.biomeChanged).toBe(false);

    const b = events();
    updateMilestones(ms, 20, 1, effects, score, b); // advanced 0 -> 1
    expect(b.biomeChanged).toBe(true);

    const c = events();
    updateMilestones(ms, 30, 1, effects, score, c); // still biome 1
    expect(c.biomeChanged).toBe(false);

    const d = events();
    updateMilestones(ms, 40, 2, effects, score, d); // advanced 1 -> 2
    expect(d.biomeChanged).toBe(true);
  });
});

describe('Milestones — per-run objectives', () => {
  it('accumulates near-miss progress and latches completion exactly once', () => {
    const obj = OBJECTIVES.find((o) => o.id === 'nearMiss')!;
    const ms = createMilestoneState();
    const effects = createPowerupEffects();
    const score = createScoreState();

    // Feed near-misses one short of the target.
    const e1 = events();
    e1.nearMisses = obj.target - 1;
    updateMilestones(ms, 10, 0, effects, score, e1);
    expect(ms.progress.nearMiss).toBe(obj.target - 1);
    expect(ms.done.nearMiss).toBe(false);
    expect(e1.objectiveDone).toBeNull();

    // One more crosses the target → done + announce, once.
    const e2 = events();
    e2.nearMisses = 1;
    updateMilestones(ms, 20, 0, effects, score, e2);
    expect(ms.done.nearMiss).toBe(true);
    expect(e2.objectiveDone).toBe(obj.label);

    // Further near-misses neither re-announce nor inflate progress past done.
    const e3 = events();
    e3.nearMisses = 3;
    const progressAtDone = ms.progress.nearMiss;
    updateMilestones(ms, 30, 0, effects, score, e3);
    expect(e3.objectiveDone).toBeNull();
    expect(ms.progress.nearMiss).toBe(progressAtDone);
  });

  it('counts a collected pickup as one toward the collect objective', () => {
    const ms = createMilestoneState();
    const ev = events();
    ev.collected = PowerupKind.Magnet;
    updateMilestones(ms, 10, 0, createPowerupEffects(), createScoreState(), ev);
    expect(ms.progress.collect).toBe(1);
  });

  it('counts ramp boosts toward the ramp objective', () => {
    const ms = createMilestoneState();
    const ev = events();
    ev.rampBoosts = 2;
    updateMilestones(ms, 10, 0, createPowerupEffects(), createScoreState(), ev);
    expect(ms.progress.ramp).toBe(2);
  });
});

describe('Milestones — GameState integration + reset', () => {
  it('fires the 1000m milestone through update() and grants the shield', () => {
    const game = createGameState();
    startRun(game);
    // Park just below the first threshold; one step crosses it.
    game.distance = MILESTONES[0].distance - 0.2;
    game.vehicle.speed = 60; // 60 * (1/60) = 1 unit this step
    update(game, createIntent(), TIMESTEP);
    expect(game.distance).toBeGreaterThanOrEqual(MILESTONES[0].distance);
    expect(game.milestones.nextIndex).toBeGreaterThanOrEqual(1);
    expect(game.lastEvents.milestone).toBe(MILESTONES[0].label);
    if (firstReward.kind === 'powerup' && firstReward.powerup === PowerupKind.Shield) {
      expect(game.powerups.effects.shield).toBe(true);
    }
  });

  it('resets milestone + objective progress on a fresh run (menu→play→crash→play)', () => {
    const game = createGameState();
    startRun(game);
    // Simulate progress mid-run.
    game.milestones.nextIndex = 4;
    game.milestones.lastBiomeFrom = 2;
    game.milestones.progress.nearMiss = 3;
    game.milestones.done.collect = true;
    // Crash, then restart from the crash screen (intent.restart → startRun).
    game.phase = Phase.Crashed;
    const intent = createIntent();
    intent.restart = true;
    update(game, intent, TIMESTEP);
    expect(game.phase).toBe(Phase.Playing);
    expect(game.milestones.nextIndex).toBe(0);
    expect(game.milestones.lastBiomeFrom).toBe(0);
    expect(game.milestones.progress.nearMiss).toBe(0);
    expect(game.milestones.done.collect).toBe(false);
  });

  it('returnToMenu clears milestone progress too', () => {
    const game = createGameState();
    startRun(game);
    game.milestones.nextIndex = 2;
    game.milestones.progress.ramp = 5;
    returnToMenu(game);
    expect(game.milestones.nextIndex).toBe(0);
    expect(game.milestones.progress.ramp).toBe(0);
  });

  it('boost bonus constant exists (sanity: rewards reuse real systems)', () => {
    // Guards against an accidental constant rename breaking the reward path.
    expect(typeof VEHICLE.boostBonus).toBe('number');
  });
});
