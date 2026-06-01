/**
 * GRAZE scoring gradient (OPP-14, Psyvariar model). Pins the grazeMultiplier
 * curve and proves that — within the unchanged binary near-miss window
 * (nearMissLateral 6.5, the OUTER bound) — a closer pass scores more. Pure.
 */
import { describe, expect, it } from 'vitest';
import { grazeMultiplier, resolveTraffic, createScoreState, type TrafficEvents } from '../Scoring';
import { createTrafficState, type Obstacle, type TrafficState } from '../Traffic';
import { ObstacleKind, SCORING } from '../../utils/constants';

describe('grazeMultiplier — the reward gradient', () => {
  it('is 1.0 at the outer bound (an ordinary, far near-miss earns no bonus)', () => {
    expect(grazeMultiplier(SCORING.nearMissLateral)).toBeCloseTo(1, 10);
  });

  it('just inside the outer bound is barely above 1.0', () => {
    const m = grazeMultiplier(6.4);
    expect(m).toBeGreaterThan(1);
    expect(m).toBeLessThan(1.1);
  });

  it('reaches grazeMax exactly at grazeInner (the paint-shave point)', () => {
    expect(grazeMultiplier(SCORING.grazeInner)).toBeCloseTo(SCORING.grazeMax, 10);
  });

  it('caps at grazeMax below grazeInner — no runaway for an impossibly close pass', () => {
    expect(grazeMultiplier(0.5)).toBe(SCORING.grazeMax);
    expect(grazeMultiplier(0)).toBe(SCORING.grazeMax);
  });

  it('is monotonically non-increasing in the gap (closer never pays less)', () => {
    let prev = grazeMultiplier(0);
    for (let gap = 0; gap <= SCORING.nearMissLateral + 1; gap += 0.1) {
      const m = grazeMultiplier(gap);
      expect(m).toBeLessThanOrEqual(prev + 1e-9);
      prev = m;
    }
  });

  it('stays within [1, grazeMax] across and beyond the whole window', () => {
    for (let gap = -1; gap <= 10; gap += 0.05) {
      const m = grazeMultiplier(gap);
      expect(m).toBeGreaterThanOrEqual(1);
      expect(m).toBeLessThanOrEqual(SCORING.grazeMax);
    }
  });
});

/** Drop a single passed STATIC obstacle at a chosen lateral gap and return the
 *  combo earned by resolving it once. The player sits at lateral 0, distance 0;
 *  the obstacle is placed BEHIND the player (distance -50) so it counts as
 *  just-passed but never overlaps the AABB — isolating the graze gradient from
 *  the collision band (which would otherwise crash a sub-2.2 lateral gap). */
function comboForGap(gap: number): number {
  const traffic: TrafficState = createTrafficState();
  const o: Obstacle = traffic.pool[0];
  o.active = true;
  o.passed = false;
  o.kind = ObstacleKind.Static;
  o.lateral = gap; // player at 0 → lateral gap == gap
  o.distance = -50; // well behind the player → passed, no longitudinal overlap
  const score = createScoreState();
  const events: TrafficEvents = { crashed: false, nearMisses: 0 };
  resolveTraffic(events, score, 0, 0, traffic);
  return score.combo;
}

describe('resolveTraffic — graze gradient applied to a real near-miss', () => {
  it('a tight graze earns more combo than a loose one (within the same window)', () => {
    const tight = comboForGap(2.5); // near the paint
    const loose = comboForGap(6.0); // near the outer edge
    expect(tight).toBeGreaterThan(loose);
  });

  it('a graze at grazeInner earns the full grazeMax-scaled combo step', () => {
    const score = createScoreState();
    const base = score.combo;
    const got = comboForGap(SCORING.grazeInner) - base;
    expect(got).toBeCloseTo(SCORING.comboStep * SCORING.grazeMax, 6);
  });

  it('surfaces the smallest near-miss gap on TrafficEvents.nearMissClosest', () => {
    const traffic: TrafficState = createTrafficState();
    const far = traffic.pool[0];
    const near = traffic.pool[1];
    for (const [o, lat] of [[far, 5.5], [near, 2.2]] as const) {
      o.active = true;
      o.passed = false;
      o.kind = ObstacleKind.Static;
      o.lateral = lat;
      o.distance = -50; // behind the player → both pass without colliding
    }
    const score = createScoreState();
    const events: TrafficEvents = { crashed: false, nearMisses: 0 };
    resolveTraffic(events, score, 0, 0, traffic);
    expect(events.nearMisses).toBe(2);
    expect(events.nearMissClosest).toBeCloseTo(2.2, 10);
  });

  it('still triggers (and resets to Infinity when there is no near-miss)', () => {
    const score = createScoreState();
    const events: TrafficEvents = { crashed: false, nearMisses: 5, nearMissClosest: 1 };
    resolveTraffic(events, score, 0, 0, createTrafficState());
    expect(events.nearMisses).toBe(0);
    expect(events.nearMissClosest).toBe(Infinity);
  });
});
