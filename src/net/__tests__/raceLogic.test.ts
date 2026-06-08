/**
 * Pure 2P-race decision logic (MP-1 PR3-pt2). The winner is decided in shared sim
 * time, so it must be a pure function of the per-car finish frames — agreed by both
 * peers by construction. Locks: lower-frame wins, dead-heat tiebreak, perspective
 * mapping (exactly one winner), and the lead-change deadband.
 */
import { describe, expect, it } from 'vitest';
import { decideWinner, leadWithDeadband, resultFor } from '../raceLogic';

describe('decideWinner — first to the finish (lowest sim frame) wins', () => {
  it('the car that crossed on the earlier frame wins', () => {
    expect(decideWinner(600, 620, 10000, 10000)).toBe('host');
    expect(decideWinner(620, 600, 10000, 10000)).toBe('join');
  });
  it('only one finished → that car wins', () => {
    expect(decideWinner(600, -1, 10000, 9000)).toBe('host');
    expect(decideWinner(-1, 600, 9000, 10000)).toBe('join');
  });
  it('same frame (dead heat) → the car further past the line wins', () => {
    expect(decideWinner(600, 600, 10002, 10001)).toBe('host');
    expect(decideWinner(600, 600, 10001, 10002)).toBe('join');
  });
  it('exact dead heat → a fixed deterministic tiebreak (host), identical on both peers', () => {
    expect(decideWinner(600, 600, 10000, 10000)).toBe('host');
  });
});

describe('resultFor — perspective mapping (exactly one winner, both peers agree)', () => {
  it('a host win is win for host, lose for join', () => {
    expect(resultFor('host', true)).toBe('win');
    expect(resultFor('host', false)).toBe('lose');
  });
  it('a join win is win for join, lose for host', () => {
    expect(resultFor('join', false)).toBe('win');
    expect(resultFor('join', true)).toBe('lose');
  });
  it('a draw is a draw on both peers', () => {
    expect(resultFor('draw', true)).toBe('draw');
    expect(resultFor('draw', false)).toBe('draw');
  });
  it('for any decided winner the two peers see OPPOSITE results (no split-brain)', () => {
    for (const w of ['host', 'join'] as const) {
      expect(resultFor(w, true)).not.toBe(resultFor(w, false));
    }
  });
});

describe('leadWithDeadband — hysteresis so a near-tie does not spam the alert', () => {
  it('flips only when the rival is ahead by more than the deadband', () => {
    expect(leadWithDeadband(true, 5, 3)).toBe(true); // local clearly ahead
    expect(leadWithDeadband(true, -5, 3)).toBe(false); // rival clearly ahead → flip
    expect(leadWithDeadband(false, 5, 3)).toBe(true); // local clearly ahead → flip
  });
  it('holds the current leader inside the deadband (no jitter)', () => {
    expect(leadWithDeadband(true, 1, 3)).toBe(true);
    expect(leadWithDeadband(true, -1, 3)).toBe(true);
    expect(leadWithDeadband(false, 2, 3)).toBe(false);
    expect(leadWithDeadband(false, -2, 3)).toBe(false);
  });
});
