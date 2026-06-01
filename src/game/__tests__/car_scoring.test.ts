/**
 * Per-car SCORING tradeoff (OPP-07b). Each car sits on an OPPOSED axis:
 * buildMul (near-miss combo weight) vs windowMul (combo survival window). These
 * compose on top of the existing mover/gate/drift/graze multipliers — they do
 * NOT replace them — and Pulse stays the neutral 1/1 baseline.
 *
 * Pinned here (what is ACTUALLY true, per the brief — NOT the unachievable
 * "never strictly higher on any run"): pulse unchanged; buildMul scales the
 * weight and windowMul scales the timeout, both directions; graze still
 * composes; and NO car wins BOTH axes (buildMul>=1 AND windowMul>=1) — the real
 * fairness invariant.
 */
import { describe, expect, it } from 'vitest';
import {
  createScoreState,
  grazeMultiplier,
  registerNearMiss,
  resolveTraffic,
  type TrafficEvents,
} from '../Scoring';
import { createTrafficState, type Obstacle, type TrafficState } from '../Traffic';
import { BASE_SCORING, CARS, ObstacleKind, SCORING, scoringFor, type CarScoring } from '../../utils/constants';

/** Resolve one STATIC near-miss at a fixed lateral gap under a given scoring
 *  profile, returning the resulting combo + the refreshed comboTimer. Obstacle
 *  sits behind the player (distance -50) so it counts as passed but never
 *  collides — isolating the scoring math from the collision band. */
function passOnce(gap: number, scoring: CarScoring): { combo: number; comboTimer: number } {
  const traffic: TrafficState = createTrafficState();
  const o: Obstacle = traffic.pool[0];
  o.active = true;
  o.passed = false;
  o.kind = ObstacleKind.Static;
  o.lateral = gap;
  o.distance = -50;
  const score = createScoreState();
  const events: TrafficEvents = { crashed: false, nearMisses: 0 };
  resolveTraffic(events, score, 0, 0, traffic, false, scoring);
  return { combo: score.combo, comboTimer: score.comboTimer };
}

const carScoring = (id: string) => scoringFor(id);

describe('scoringFor — per-car profiles + fallback', () => {
  it('pulse is the neutral 1/1 baseline', () => {
    expect(scoringFor('pulse')).toEqual({ buildMul: 1, windowMul: 1 });
  });

  it('an unknown id falls back to BASE_SCORING (neutral)', () => {
    expect(scoringFor('does-not-exist')).toEqual(BASE_SCORING);
    expect(BASE_SCORING).toEqual({ buildMul: 1, windowMul: 1 });
  });

  it('every car defines a finite scoring profile', () => {
    for (const c of CARS) {
      const s = scoringFor(c.id);
      expect(Number.isFinite(s.buildMul)).toBe(true);
      expect(Number.isFinite(s.windowMul)).toBe(true);
      expect(s.buildMul).toBeGreaterThan(0);
      expect(s.windowMul).toBeGreaterThan(0);
    }
  });
});

describe('Fairness invariant — no car wins both axes', () => {
  it('no car has buildMul>=1 AND windowMul>=1 together (a strict scoring win)', () => {
    for (const c of CARS) {
      const s = scoringFor(c.id);
      const winsBoth = s.buildMul >= 1 && s.windowMul >= 1;
      // Pulse is the sole 1/1 — it "wins" neither axis, it's exactly neutral.
      const isNeutral = s.buildMul === 1 && s.windowMul === 1;
      expect(winsBoth && !isNeutral).toBe(false);
    }
  });

  it('every non-pulse car gives up one axis to gain the other (a genuine tradeoff)', () => {
    for (const c of CARS) {
      if (c.id === 'pulse') continue;
      const s = scoringFor(c.id);
      const gainsOne = s.buildMul > 1 || s.windowMul > 1;
      const losesOne = s.buildMul < 1 || s.windowMul < 1;
      expect(gainsOne).toBe(true);
      expect(losesOne).toBe(true);
    }
  });

  it('every car carries a scoring-playstyle tagline for the picker', () => {
    for (const c of CARS) expect(typeof c.scoringTagline).toBe('string');
  });
});

describe('L1 buildMul — scales the near-miss combo weight', () => {
  const GAP = 5.5; // inside the near-miss window, a known graze value

  it('pulse scoring is identical to the base loop (default arg + BASE_SCORING)', () => {
    const dflt = passOnce(GAP, BASE_SCORING);
    const pulse = passOnce(GAP, scoringFor('pulse'));
    // And against the no-scoring-arg default path.
    const traffic = createTrafficState();
    const o = traffic.pool[0];
    o.active = true; o.passed = false; o.kind = ObstacleKind.Static; o.lateral = GAP; o.distance = -50;
    const score = createScoreState();
    resolveTraffic({ crashed: false, nearMisses: 0 }, score, 0, 0, traffic); // no scoring arg
    expect(pulse.combo).toBeCloseTo(dflt.combo, 10);
    expect(pulse.combo).toBeCloseTo(score.combo, 10);
    expect(pulse.comboTimer).toBeCloseTo(SCORING.comboTimeout, 10);
  });

  it('a higher buildMul earns more combo; a lower one earns less (both directions)', () => {
    const base = passOnce(GAP, BASE_SCORING).combo - SCORING.baseCombo;
    const ghost = passOnce(GAP, carScoring('ghost')).combo - SCORING.baseCombo; // 1.25
    const onyx = passOnce(GAP, carScoring('onyx')).combo - SCORING.baseCombo; //  0.80
    expect(ghost).toBeGreaterThan(base);
    expect(onyx).toBeLessThan(base);
  });

  it('buildMul multiplies the combo gain by exactly its factor (composes, not replaces)', () => {
    const base = passOnce(GAP, BASE_SCORING).combo - SCORING.baseCombo;
    for (const id of ['ghost', 'onyx', 'nova', 'vapor', 'ember', 'slipstream']) {
      const gain = passOnce(GAP, carScoring(id)).combo - SCORING.baseCombo;
      expect(gain / base).toBeCloseTo(carScoring(id).buildMul, 6);
    }
  });
});

describe('L1 composes WITH graze (does not replace it)', () => {
  it('a tighter pass still scores more than a looser one under a car mult', () => {
    const tight = passOnce(2.5, carScoring('ghost')).combo;
    const loose = passOnce(6.0, carScoring('ghost')).combo;
    expect(tight).toBeGreaterThan(loose);
  });

  it('the combo gain equals comboStep · graze · buildMul (graze factor intact)', () => {
    const gap = 3.0;
    const gain = passOnce(gap, carScoring('nova')).combo - SCORING.baseCombo;
    const expected = SCORING.comboStep * grazeMultiplier(gap) * carScoring('nova').buildMul;
    expect(gain).toBeCloseTo(expected, 6);
  });
});

describe('L2 windowMul — scales the combo survival window', () => {
  it('registerNearMiss scales the comboTimer by windowMul (both directions)', () => {
    const shortW = registerNearMiss(createScoreState(), 1, 0.7);
    const longW = registerNearMiss(createScoreState(), 1, 1.35);
    const neutral = registerNearMiss(createScoreState(), 1, 1);
    expect(shortW.comboTimer).toBeCloseTo(SCORING.comboTimeout * 0.7, 10);
    expect(longW.comboTimer).toBeCloseTo(SCORING.comboTimeout * 1.35, 10);
    expect(neutral.comboTimer).toBeCloseTo(SCORING.comboTimeout, 10);
  });

  it('a near-miss refreshes the timer to comboTimeout · car windowMul', () => {
    expect(passOnce(5.5, carScoring('nova')).comboTimer).toBeCloseTo(
      SCORING.comboTimeout * carScoring('nova').windowMul, // 0.70 — shortest window
      6,
    );
    expect(passOnce(5.5, carScoring('onyx')).comboTimer).toBeCloseTo(
      SCORING.comboTimeout * carScoring('onyx').windowMul, // 1.35 — longest window
      6,
    );
  });

  it('windowMul does NOT change the combo magnitude (only its lifetime)', () => {
    // Nova and Ghost differ in window but a single pass at the same gap differs
    // only by buildMul in combo — window only governs how long it survives.
    const novaCombo = passOnce(5.5, carScoring('nova')).combo - SCORING.baseCombo;
    const expected = SCORING.comboStep * grazeMultiplier(5.5) * carScoring('nova').buildMul;
    expect(novaCombo).toBeCloseTo(expected, 6);
  });
});
