/**
 * L1 SIM-FUZZING, DEEPER PASS — monotonicity & latching invariants (automated bug
 * hunt round 2). The first pass (fuzz_invariants.test.ts, #75) checked bounds,
 * pools, mode-leak and determinism. This pass checks STEP-OVER-STEP properties
 * the first one didn't: quantities that must only ever move ONE direction, and
 * one-shot latches that must never un-latch. Those catch a different bug class —
 * score going backwards, a milestone re-firing, peakCombo < combo, lives healing,
 * a completed objective un-completing. Pure — no three, no DOM.
 *
 * Kept allocation-free per step (primitive prev-tracking, no snapshot objects) so
 * the long runs stay fast.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type GameState, GameMode, Phase, startRun, update } from '../GameState';
import { createIntent, type InputIntent } from '../Input';
import { grantPowerup } from '../Powerups';
import { MILESTONES, OBJECTIVES, PowerupKind, SCORING, SLALOM, TIMESTEP } from '../../utils/constants';

type Script = (f: number) => InputIntent;
const sineWander: Script = (f) => ({ ...createIntent(), steer: Math.sin(f * 0.11) * 0.85 });
const driftThread: Script = (f) => ({ ...createIntent(), steer: Math.cos(f * 0.05) * 0.6, deploySlowMo: f % 120 === 0 });

const SEEDS = Array.from({ length: 8 }, (_, i) => (1 + i * 0x9e3779b1) >>> 0);
const OBJ_IDS = OBJECTIVES.map((o) => o.id);

/** Non-decreasing scalar fields read straight off the state. */
const UP = (g: GameState): number[] => [
  g.distance, g.time, g.score.score, g.score.peakCombo, g.score.nearMisses,
  g.slalomScore.score, g.slalomScore.gatesThreaded, g.milestones.nextIndex,
  g.powerups.spawned, g.powerups.culled, g.powerups.collected, g.traffic.spawned, g.traffic.culled,
];
const UP_NAMES = ['distance', 'time', 'score', 'peak', 'nearMisses', 'slalom', 'gates', 'nextIndex',
  'pSpawned', 'pCulled', 'pCollected', 'tSpawned', 'tCulled'];

describe('L1 deep fuzz — monotonicity & latching across long runs', () => {
  for (const mode of [GameMode.Classic, GameMode.DailySlalom]) {
    for (const [name, script] of [['sineWander', sineWander], ['driftThread', driftThread]] as const) {
      it(`${mode} / ${name}: long runs respect every monotonic/latch invariant`, () => {
        for (const seed of SEEDS) {
          const g = startRun(createGameState(seed), undefined, undefined, seed, undefined, mode);
          for (let i = 0; i < 4; i++) grantPowerup(g.powerups.effects, PowerupKind.SlowMo);
          let prevUp = UP(g);
          let prevLives = g.lives;
          const prevProg = OBJ_IDS.map((id) => g.milestones.progress[id]);
          const everDone = OBJ_IDS.map((id) => g.milestones.done[id]);
          for (let f = 0; f < 2500; f++) {
            update(g, script(f), TIMESTEP);
            const ctx = `seed=${seed} ${mode}/${name} f=${f}`;
            const up = UP(g);
            for (let k = 0; k < up.length; k++) {
              expect(up[k], `${ctx} ${UP_NAMES[k]} non-decreasing (${prevUp[k]}→${up[k]})`).toBeGreaterThanOrEqual(prevUp[k]);
            }
            expect(g.lives, `${ctx} lives non-increasing`).toBeLessThanOrEqual(prevLives);
            // Lives are a slalom-only mechanic: in classic they must stay fully inert.
            if (mode === GameMode.Classic) expect(g.lives, `${ctx} classic lives inert`).toBe(SLALOM.lives);
            expect(g.milestones.nextIndex, `${ctx} nextIndex<=len`).toBeLessThanOrEqual(MILESTONES.length);
            expect(g.score.peakCombo, `${ctx} peak>=combo`).toBeGreaterThanOrEqual(g.score.combo - 1e-9);
            // objective latch + progress monotonic
            for (let j = 0; j < OBJ_IDS.length; j++) {
              const id = OBJ_IDS[j];
              if (everDone[j]) expect(g.milestones.done[id], `${ctx} ${id} stays done`).toBe(true);
              everDone[j] = everDone[j] || g.milestones.done[id];
              expect(g.milestones.progress[id], `${ctx} ${id} progress non-decreasing`).toBeGreaterThanOrEqual(prevProg[j]);
              prevProg[j] = g.milestones.progress[id];
            }
            // biome range
            expect(g.biome.blend, `${ctx} blend in [0,1]`).toBeGreaterThanOrEqual(0);
            expect(g.biome.blend, `${ctx} blend<=1`).toBeLessThanOrEqual(1);
            expect(g.biome.from, `${ctx} biome.from>=0`).toBeGreaterThanOrEqual(0);
            // slalom speed pinned while playing
            if (mode === GameMode.DailySlalom && g.phase === Phase.Playing) {
              expect(g.vehicle.speed, `${ctx} slalom speed pinned`).toBeCloseTo(SLALOM.constantSpeed, 6);
            }
            prevUp = up;
            prevLives = g.lives;
          }
        }
      }, 20_000);
    }
  }

  it('peakCombo always equals the running max of combo (classic survival)', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const g = startRun(createGameState(seed), undefined, undefined, seed);
      let runningMax = g.score.combo;
      for (let f = 0; f < 2500; f++) {
        update(g, sineWander(f), TIMESTEP);
        runningMax = Math.max(runningMax, g.score.combo);
        expect(g.score.combo).toBeGreaterThanOrEqual(SCORING.baseCombo - 1e-9);
        expect(g.score.combo).toBeLessThanOrEqual(SCORING.maxCombo + 1e-9);
        expect(g.score.peakCombo, `seed=${seed} f=${f} peak==runningMax`).toBeCloseTo(runningMax, 6);
      }
    }
  }, 20_000);
});
