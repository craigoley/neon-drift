/** TEMPORARY Phase-1 diagnostic trace — deleted before the PR. */
import { it } from 'vitest';
import { createGameState, startRun, update, Phase } from '../GameState';
import type { InputIntent } from '../Input';
import { TIMESTEP, SCORING, VEHICLE, TRAFFIC } from '../../utils/constants';

it('PHASE1 TRACE: near-miss funnel over a dodging run', () => {
  const collideGap = VEHICLE.halfWidth + TRAFFIC.halfWidth; // 2.2
  const runs = [101, 202, 303, 404, 505];
  for (const seed of runs) {
    const g = createGameState(seed);
    startRun(g);
    const intent: InputIntent = { steer: 0, handbrake: false, restart: false };
    const dt = TIMESTEP;
    let passes = 0;
    const buckets = { collideBand: 0, nearBand: 0, gap3to5: 0, gap5plus: 0 };
    let overtaken = 0; // obstacles whose center the player passed

    for (let step = 0; step < 120 * 60 && g.phase === Phase.Playing; step++) {
      const wasPassed = g.traffic.pool.map((o) => o.active && o.passed);

      // Simple dodge AI: steer away from the nearest threatening obstacle ahead.
      let steer = -g.vehicle.lateral * 0.04; // gentle re-center
      let nearest = Infinity;
      let target: number | null = null;
      for (const o of g.traffic.pool) {
        if (!o.active) continue;
        const ahead = o.distance - g.distance;
        if (ahead > 0 && ahead < 70 && Math.abs(o.lateral - g.vehicle.lateral) < 4.5 && ahead < nearest) {
          nearest = ahead;
          target = o.lateral;
        }
      }
      if (target !== null) steer = target > g.vehicle.lateral ? -1 : 1;
      intent.steer = Math.max(-1, Math.min(1, steer));

      update(g, intent, dt);

      g.traffic.pool.forEach((o, i) => {
        // Count only genuine overtakes: still-active obstacle whose passed flag
        // flipped false->true this frame (culled obstacles keep passed=true).
        if (o.active && o.passed && !wasPassed[i]) {
          overtaken++;
          const gap = Math.abs(g.vehicle.lateral - o.lateral);
          if (gap < collideGap) buckets.collideBand++;
          else if (gap < SCORING.nearMissLateral) buckets.nearBand++;
          else if (gap < 5) buckets.gap3to5++;
          else buckets.gap5plus++;
          passes++;
        }
      });
    }

    // eslint-disable-next-line no-console
    console.log(
      `seed ${seed}: phase=${g.phase} t=${g.time.toFixed(0)}s dist=${g.distance.toFixed(0)} ` +
        `score=${g.score.score.toFixed(0)} score/dist=${(g.score.score / g.distance).toFixed(2)} ` +
        `combo=x${g.score.combo.toFixed(2)} nearMisses=${g.score.nearMisses} | ` +
        `overtaken=${overtaken} bands(collide/near/3-5/5+)=${buckets.collideBand}/${buckets.nearBand}/${buckets.gap3to5}/${buckets.gap5plus}`,
    );
  }
});
