/**
 * Daily Slalom scoring (Daily Slalom PR 2): the per-gate formula
 *   gatePoints = base × accuracyBonus × cleanMultiplier
 * Pins the accuracy curve, the clean-streak climb/cap/reset, the point
 * composition, and the milestone-crossing flag. Pure — no sim/DOM.
 */
import { describe, expect, it } from 'vitest';
import { accuracyBonus, createSlalomScoreState, missGate, threadGate } from '../SlalomScore';
import { DAILY_SCORING } from '../../utils/constants';

describe('accuracyBonus — centeredness curve', () => {
  it('is 1.0 at the edge and 1+accuracyMaxBonus dead-centre, linear between', () => {
    expect(accuracyBonus(0)).toBeCloseTo(1.0, 10);
    expect(accuracyBonus(1)).toBeCloseTo(1 + DAILY_SCORING.accuracyMaxBonus, 10);
    expect(accuracyBonus(0.5)).toBeCloseTo(1 + DAILY_SCORING.accuracyMaxBonus * 0.5, 10);
  });

  it('clamps out-of-range centeredness', () => {
    expect(accuracyBonus(-3)).toBeCloseTo(1.0, 10);
    expect(accuracyBonus(9)).toBeCloseTo(1 + DAILY_SCORING.accuracyMaxBonus, 10);
  });
});

describe('threadGate — points + clean-streak climb', () => {
  it('first gate scores base×accuracy×cleanStart, then the multiplier climbs', () => {
    const s = createSlalomScoreState();
    expect(s.cleanMultiplier).toBe(DAILY_SCORING.cleanStart);
    const r = threadGate(s, 1); // dead-centre
    const expected = DAILY_SCORING.base * (1 + DAILY_SCORING.accuracyMaxBonus) * DAILY_SCORING.cleanStart;
    expect(r.points).toBeCloseTo(expected, 6);
    expect(s.score).toBeCloseTo(expected, 6);
    expect(s.gatesThreaded).toBe(1);
    expect(s.cleanMultiplier).toBe(DAILY_SCORING.cleanStart + DAILY_SCORING.cleanStep);
  });

  it('clean streak climbs by cleanStep per gate, capped at cleanMax', () => {
    const s = createSlalomScoreState();
    for (let i = 0; i < 50; i++) threadGate(s, 0);
    expect(s.cleanMultiplier).toBe(DAILY_SCORING.cleanMax); // capped, not runaway
    expect(s.gatesThreaded).toBe(50);
  });

  it('a dead-centre thread out-scores an edge thread by exactly the accuracy ratio', () => {
    const center = createSlalomScoreState();
    const edge = createSlalomScoreState();
    const cPts = threadGate(center, 1).points; // both at cleanStart (first gate)
    const ePts = threadGate(edge, 0).points;
    expect(cPts).toBeGreaterThan(ePts);
    expect(cPts / ePts).toBeCloseTo(1 + DAILY_SCORING.accuracyMaxBonus, 6);
  });

  it('the clean multiplier is the dominant term (later gates score far more)', () => {
    const s = createSlalomScoreState();
    const first = threadGate(s, 0).points; // ×cleanStart
    let last = first;
    for (let i = 0; i < DAILY_SCORING.cleanMax; i++) last = threadGate(s, 0).points;
    expect(last).toBeGreaterThan(first); // streak made the same edge thread worth more
  });

  it('flags a milestone exactly when the streak crosses a milestoneStep boundary', () => {
    const s = createSlalomScoreState();
    const crossedAt: number[] = [];
    for (let i = 0; i < DAILY_SCORING.cleanMax + 3; i++) {
      if (threadGate(s, 0).milestone) crossedAt.push(s.cleanMultiplier);
    }
    // Every crossing lands the multiplier on a multiple of milestoneStep, and at
    // least one milestone is reachable before the cap.
    expect(crossedAt.length).toBeGreaterThan(0);
    for (const m of crossedAt) expect(m % DAILY_SCORING.milestoneStep).toBe(0);
  });
});

describe('missGate — breaks the streak, keeps banked score', () => {
  it('resets cleanMultiplier to the floor but keeps score + gate count', () => {
    const s = createSlalomScoreState();
    threadGate(s, 1);
    threadGate(s, 1);
    threadGate(s, 1);
    const banked = s.score;
    const gates = s.gatesThreaded;
    expect(s.cleanMultiplier).toBeGreaterThan(DAILY_SCORING.cleanStart);
    missGate(s);
    expect(s.cleanMultiplier).toBe(DAILY_SCORING.cleanStart);
    expect(s.score).toBe(banked); // already-banked points are NOT lost
    expect(s.gatesThreaded).toBe(gates);
  });

  it('the next gate after a miss scores at the floor multiplier again', () => {
    const s = createSlalomScoreState();
    for (let i = 0; i < 5; i++) threadGate(s, 0);
    missGate(s);
    const r = threadGate(s, 0);
    expect(r.points).toBeCloseTo(DAILY_SCORING.base * 1 * DAILY_SCORING.cleanStart, 6);
  });
});
