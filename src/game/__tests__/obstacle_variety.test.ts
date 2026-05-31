import { describe, expect, it } from 'vitest';
import {
  activeObstacleCount,
  createTrafficState,
  kindWeightAt,
  pickKind,
  updateTraffic,
  type Obstacle,
} from '../Traffic';
import {
  createScoreState,
  gateBlocks,
  isRampContact,
  resolveTraffic,
  withinGateOpening,
  type TrafficEvents,
} from '../Scoring';
import { createVehicleState, speedCap, updateVehicle } from '../Vehicle';
import { createGameState, Phase, startRun, update } from '../GameState';
import { roadCenterAt } from '../Road';
import { createIntent } from '../Input';
import { Rng } from '../../utils/rng';
import {
  BASE_HANDLING,
  GATE,
  OBSTACLE_DEFS,
  ObstacleKind,
  RAMP,
  SCORING,
  TIMESTEP,
  TRAFFIC,
  VEHICLE,
} from '../../utils/constants';

function freshEvents(): TrafficEvents {
  return { crashed: false, nearMisses: 0 };
}

describe('Obstacle variety — spawn-mix weights ramp with distance', () => {
  it('kindWeightAt unlocks types at their startDistance and ramps to a cap', () => {
    // Static is always on at its base.
    expect(kindWeightAt(ObstacleKind.Static, 0)).toBeCloseTo(OBSTACLE_DEFS.static.weightBase);
    // Movers are available from the start and climb to their cap.
    expect(kindWeightAt(ObstacleKind.Mover, 0)).toBeCloseTo(OBSTACLE_DEFS.mover.weightBase);
    expect(kindWeightAt(ObstacleKind.Mover, 1e9)).toBeCloseTo(OBSTACLE_DEFS.mover.weightMax);
    // Gates unlock at 1500, ramps at 1000 — zero before, base at exactly the unlock.
    expect(kindWeightAt(ObstacleKind.Gate, 1499)).toBe(0);
    expect(kindWeightAt(ObstacleKind.Gate, 1500)).toBeCloseTo(OBSTACLE_DEFS.gate.weightBase);
    expect(kindWeightAt(ObstacleKind.Ramp, 999)).toBe(0);
    expect(kindWeightAt(ObstacleKind.Ramp, 1000)).toBeCloseTo(OBSTACLE_DEFS.ramp.weightBase);
    expect(kindWeightAt(ObstacleKind.Gate, 1e9)).toBeCloseTo(OBSTACLE_DEFS.gate.weightMax);
  });

  it('early game spawns only static + movers (gates/ramps not yet unlocked)', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 5000; i++) {
      const k = pickKind(rng, 0);
      expect(k === ObstacleKind.Static || k === ObstacleKind.Mover).toBe(true);
    }
  });

  it('all four kinds appear once distance has passed every unlock', () => {
    const rng = new Rng(2);
    const seen = new Set<string>();
    for (let i = 0; i < 8000; i++) seen.add(pickKind(rng, 6000));
    for (const k of [ObstacleKind.Static, ObstacleKind.Mover, ObstacleKind.Gate, ObstacleKind.Ramp]) {
      expect(seen.has(k)).toBe(true);
    }
  });
});

describe('Obstacle variety — recycled pool stays bounded with mixed types', () => {
  it('pool length fixed, active count bounded, and all four kinds occur over a 120s run', () => {
    const traffic = createTrafficState();
    const seed = 314;
    const rng = new Rng(seed);
    let distance = 0;
    const speed = 180; // covers > 21000 units in 120s → well past every unlock
    let maxActive = 0;
    const everSeen = { static: false, mover: false, gate: false, ramp: false } as Record<string, boolean>;
    const steps = Math.round(120 / TIMESTEP);
    for (let i = 0; i < steps; i++) {
      distance += speed * TIMESTEP;
      updateTraffic(traffic, rng, seed, distance, TIMESTEP);
      expect(traffic.pool.length).toBe(TRAFFIC.poolSize);
      expect(activeObstacleCount(traffic)).toBeLessThanOrEqual(TRAFFIC.poolSize);
      for (const o of traffic.pool) if (o.active) everSeen[o.kind] = true;
      maxActive = Math.max(maxActive, activeObstacleCount(traffic));
    }
    expect(maxActive).toBeLessThanOrEqual(TRAFFIC.poolSize);
    expect(traffic.spawned).toBeGreaterThan(50);
    expect(traffic.culled).toBeGreaterThan(50);
    expect(everSeen.static && everSeen.mover && everSeen.gate && everSeen.ramp).toBe(true);
  });
});

describe('Obstacle variety — moving obstacle path is deterministic under seed', () => {
  function moverLaterals(seed: number): number[] {
    const traffic = createTrafficState();
    const rng = new Rng(seed);
    const out: number[] = [];
    let distance = 0;
    for (let i = 0; i < 3000; i++) {
      distance += 150 * TIMESTEP;
      updateTraffic(traffic, rng, seed, distance, TIMESTEP);
      const m = traffic.pool.find((o) => o.active && o.kind === ObstacleKind.Mover);
      if (m) out.push(m.lateral);
    }
    return out;
  }

  it('the same seed reproduces an identical mover lateral series; movers actually move', () => {
    const a = moverLaterals(77);
    const b = moverLaterals(77);
    expect(a.length).toBeGreaterThan(20);
    expect(a).toEqual(b); // fully deterministic
    expect(new Set(a).size).toBeGreaterThan(1); // not a frozen lane — sway is live
  });
});

describe('Obstacle variety — GATE collision vs threading the opening', () => {
  function gate(openingHalfWidth: number, lateral: number, distance: number): Obstacle {
    const t = createTrafficState();
    const g = t.pool[0];
    g.active = true;
    g.kind = ObstacleKind.Gate;
    g.openingHalfWidth = openingHalfWidth;
    g.lateral = lateral;
    g.laneOffset = lateral; // centre 0 → lateral == opening centre
    g.distance = distance;
    g.passed = false;
    return g;
  }

  it('hitting a barrier (player outside the opening, in the band) is a crash', () => {
    const g = gate(3, 0, 100);
    expect(gateBlocks(6, 100, g)).toBe(true); // far from the centred opening
    expect(withinGateOpening(6, g)).toBe(false);
  });

  it('threading the opening is safe and rewards the combo', () => {
    const t = createTrafficState();
    const g = t.pool[0];
    g.active = true;
    g.kind = ObstacleKind.Gate;
    g.openingHalfWidth = 3;
    g.lateral = 0;
    g.laneOffset = 0;
    g.distance = 99; // just behind the player at 100 → a fresh crossing
    g.passed = false;

    const score = createScoreState();
    const events = freshEvents();
    resolveTraffic(events, score, 0, 100, t); // player dead-centre in the opening
    expect(events.crashed).toBe(false);
    expect(events.nearMisses).toBe(1); // threading the gate fed the combo
    expect(score.combo).toBeGreaterThan(SCORING.baseCombo);
    expect(g.passed).toBe(true);
  });

  it('a barrier strike in the band ends the run', () => {
    const t = createTrafficState();
    const g = t.pool[0];
    g.active = true;
    g.kind = ObstacleKind.Gate;
    g.openingHalfWidth = 2.6;
    g.lateral = 0;
    g.laneOffset = 0;
    g.distance = 100;
    g.passed = false;

    const events = freshEvents();
    resolveTraffic(events, createScoreState(), 7, 100, t); // 7 units off-centre = into a bar
    expect(events.crashed).toBe(true);
  });

  it('the opening is wide enough to clear the car', () => {
    const g = gate(GATE.openingHalfWidthMin, 0, 100);
    expect(withinGateOpening(0, g)).toBe(true); // dead-centre always clears
  });
});

describe('Obstacle variety — RAMP applies its effect exactly once', () => {
  it('contact reports a boost once and sets consumed; re-overlap does nothing', () => {
    const t = createTrafficState();
    const r = t.pool[0];
    r.active = true;
    r.kind = ObstacleKind.Ramp;
    r.lateral = 0;
    r.laneOffset = 0;
    r.distance = 100;
    r.consumed = false;

    expect(isRampContact(0, 100, r)).toBe(true);

    const events = freshEvents();
    resolveTraffic(events, createScoreState(), 0, 100, t);
    expect(events.crashed).toBe(false); // a ramp is never a threat
    expect(events.rampBoosts).toBe(1);
    expect(r.consumed).toBe(true);

    // Still overlapping next step — but it has already fired.
    resolveTraffic(events, createScoreState(), 0, 100, t);
    expect(events.rampBoosts).toBe(0);
  });

  it('GameState.update grants a ramp its score burst + speed boost and never crashes', () => {
    const game = startRun(createGameState(3));
    const r = game.traffic.pool[0];
    r.active = true;
    r.kind = ObstacleKind.Ramp;
    r.consumed = false;
    r.passed = false;
    r.sway = 0;
    r.speed = 0;
    r.laneOffset = -roadCenterAt(game.seed, game.distance); // land on the player at lateral 0
    r.distance = game.distance;

    const scoreBefore = game.score.score;
    update(game, createIntent(), TIMESTEP);

    expect(game.lastEvents.rampBoosts).toBe(1);
    expect(game.phase).toBe(Phase.Playing); // beneficial — no crash
    expect(game.score.score).toBeGreaterThan(scoreBefore + RAMP.scoreBurst - 1);
    expect(game.vehicle.boostTimer).toBeCloseTo(RAMP.boostDuration);
    // The boost pushes speed above the normal cap for this distance.
    expect(game.vehicle.speed).toBeGreaterThan(speedCap(game.distance));
  });
});

describe('Obstacle variety — RAMP over-cap boost decays cleanly (pure vehicle)', () => {
  it('boost lets speed exceed the base cap, then settles when it expires (no NaN)', () => {
    const intent = createIntent();
    const v = createVehicleState();
    v.boostTimer = RAMP.boostDuration;
    v.speed = speedCap(0) + VEHICLE.boostBonus; // boosted above the base cap

    updateVehicle(v, intent, 0, 0, BASE_HANDLING, TIMESTEP);
    expect(v.speed).toBeGreaterThan(speedCap(0)); // still riding the boost
    expect(v.boostTimer).toBeCloseTo(RAMP.boostDuration - TIMESTEP);

    // Force the boost to lapse, then drive a couple of frames: speed clamps back.
    v.boostTimer = TIMESTEP / 2;
    updateVehicle(v, intent, 0, 0, BASE_HANDLING, TIMESTEP);
    updateVehicle(v, intent, 0, 0, BASE_HANDLING, TIMESTEP);
    expect(v.boostTimer).toBe(0);
    expect(v.speed).toBeLessThanOrEqual(speedCap(0) + 1e-6);
    expect(Number.isFinite(v.speed)).toBe(true);
  });
});

describe('Obstacle variety — threading a MOVER pays more combo than a static pass', () => {
  function passGain(kind: ObstacleKind): number {
    const t = createTrafficState();
    const o = t.pool[0];
    o.active = true;
    o.kind = kind;
    o.sway = kind === ObstacleKind.Mover ? 2 : 0;
    o.lateral = SCORING.nearMissLateral - 1; // inside the near-miss window, clear of collision
    o.laneOffset = o.lateral;
    o.distance = 99; // just behind the player at 100
    o.passed = false;
    const score = createScoreState();
    const events = freshEvents();
    resolveTraffic(events, score, 0, 100, t);
    expect(events.nearMisses).toBe(1);
    return score.combo - SCORING.baseCombo;
  }

  it('a mover near-miss bumps the combo by the mover weight; more than a static one', () => {
    const staticGain = passGain(ObstacleKind.Static);
    const moverGain = passGain(ObstacleKind.Mover);
    expect(staticGain).toBeCloseTo(SCORING.comboStep);
    expect(moverGain).toBeCloseTo(SCORING.comboStep * SCORING.moverNearMissWeight);
    expect(moverGain).toBeGreaterThan(staticGain);
  });
});

describe('Obstacle variety — no NaN over a mixed-type run', () => {
  it('a long real-loop run with all types stays finite', () => {
    const game = startRun(createGameState(2718));
    const intent = createIntent();
    for (let i = 0; i < 60 * 40; i++) {
      // Gentle weave so the run survives long enough to surface every type.
      intent.steer = Math.sin(i * 0.05) * 0.6;
      update(game, intent, TIMESTEP);
      expect(Number.isFinite(game.distance)).toBe(true);
      expect(Number.isFinite(game.score.score)).toBe(true);
      expect(Number.isFinite(game.vehicle.speed)).toBe(true);
      expect(Number.isFinite(game.vehicle.boostTimer)).toBe(true);
      if (game.phase !== Phase.Playing) break;
    }
    expect(game.distance).toBeGreaterThan(0);
  });
});
