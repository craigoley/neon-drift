/**
 * Zen VISTA SKY-SLIDE — the pure path module (Stage 0). The FEEL is Craig's phone playtest, but the
 * PATH is unit-testable: the profiles are finite, the body monotonically DESCENDS, the endpoints sit
 * at the deck + the ground, the seams are C¹ (no kink), and the tangent is always well-defined (for
 * nose-pitch + camera). Also the trigger query (vistaDeckUnder) fires on a vista deck, not off it.
 */
import { describe, expect, it } from 'vitest';
import {
  ZenSlidePath,
  slideFwdOffset,
  slideLatOffset,
  slideAltOffset,
} from '../ZenSlidePath';
import { vistaDeckUnder } from '../ZenLandmarkSurface';
import { landmarksInRadius, LANDMARK_VISTA } from '../ZenLandmarkModel';
import { ZEN, ZEN_SLIDE, ZEN_LANDMARK } from '../../utils/constants';

const us = (n: number): number[] => Array.from({ length: n + 1 }, (_, i) => i / n);
const finite = (x: number): boolean => Number.isFinite(x);

describe('Zen slide path — altitude profile (catapult up, then descend)', () => {
  it('starts at the deck (0) and ends below it (≈ ground at the vista base)', () => {
    expect(slideAltOffset(0)).toBeCloseTo(0, 6);
    expect(slideAltOffset(1)).toBeCloseTo(-ZEN_SLIDE.descentDrop, 6);
  });

  it('reaches the full climb height at the apex (ascentFrac)', () => {
    expect(slideAltOffset(ZEN_SLIDE.ascentFrac)).toBeCloseTo(ZEN_SLIDE.climbHeight, 4);
    // The apex is the highest point of the whole path.
    const maxAlt = Math.max(...us(400).map(slideAltOffset));
    expect(maxAlt).toBeCloseTo(ZEN_SLIDE.climbHeight, 3);
  });

  it('climbs monotonically up to the apex, then descends monotonically through the body', () => {
    const af = ZEN_SLIDE.ascentFrac;
    // Ascent: strictly increasing.
    let prev = -Infinity;
    for (const u of us(200).filter((u) => u <= af)) {
      const a = slideAltOffset(u);
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = a;
    }
    // Body: strictly decreasing (the slide descends the whole way down).
    prev = Infinity;
    for (const u of us(200).filter((u) => u >= af)) {
      const a = slideAltOffset(u);
      expect(a).toBeLessThanOrEqual(prev + 1e-9);
      prev = a;
    }
  });

  it('is C¹ at the apex seam (no kink — the slopes match ≈0 from both sides)', () => {
    const af = ZEN_SLIDE.ascentFrac;
    // smoothstep has zero slope at both ends, so each one-sided slope → 0 as eps → 0 (the residual
    // is O(climbHeight·eps/window²)). A fine eps shows the seam is flat + continuous from both sides.
    const eps = 1e-6;
    const left = (slideAltOffset(af) - slideAltOffset(af - eps)) / eps;
    const right = (slideAltOffset(af + eps) - slideAltOffset(af)) / eps;
    expect(Math.abs(left)).toBeLessThan(0.1);
    expect(Math.abs(right)).toBeLessThan(0.1);
    expect(Math.abs(left - right)).toBeLessThan(0.1); // derivative is continuous across the seam
  });

  it('is finite for all u (including out-of-range, clamped)', () => {
    for (const u of [...us(50), -0.3, 1.3]) expect(finite(slideAltOffset(u))).toBe(true);
  });
});

describe('Zen slide path — forward + twist profiles', () => {
  it('forward eases from 0 to forwardReach, monotonic + finite', () => {
    expect(slideFwdOffset(0)).toBeCloseTo(0, 6);
    expect(slideFwdOffset(1)).toBeCloseTo(ZEN_SLIDE.forwardReach, 4);
    let prev = -Infinity;
    for (const u of us(100)) {
      const f = slideFwdOffset(u);
      expect(finite(f)).toBe(true);
      expect(f).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = f;
    }
  });

  it('lateral twist starts + ends centred (windowed sine), and actually TWISTS in between', () => {
    expect(slideLatOffset(0)).toBeCloseTo(0, 6);
    expect(slideLatOffset(1)).toBeCloseTo(0, 6);
    const lats = us(200).map(slideLatOffset);
    expect(lats.every(finite)).toBe(true);
    // BIG + TWISTY: the swing is meaningful, and it changes sign multiple times (bendWaves).
    expect(Math.max(...lats.map(Math.abs))).toBeGreaterThan(ZEN_SLIDE.bendAmplitude * 0.3);
    let signChanges = 0;
    for (let i = 1; i < lats.length; i++) if (Math.sign(lats[i]) !== Math.sign(lats[i - 1]) && lats[i] !== 0) signChanges++;
    expect(signChanges).toBeGreaterThanOrEqual(2); // more than the tunnel's single S
  });
});

describe('Zen slide path — world placement + tangent', () => {
  const origin = { x: 100, y: 50, z: -200 };
  const path = new ZenSlidePath(origin, 0); // heading 0 → forward = (0, −1)

  it('pointAt(0) sits at the deck origin', () => {
    const p = path.pointAt(0);
    expect(p.x).toBeCloseTo(origin.x, 4);
    expect(p.z).toBeCloseTo(origin.z, 4);
    expect(p.y).toBeCloseTo(origin.y, 4);
  });

  it('pointAt is finite everywhere and the body descends in world Y', () => {
    const ys: number[] = [];
    for (const u of us(120)) {
      const p = path.pointAt(u);
      expect(finite(p.x) && finite(p.y) && finite(p.z)).toBe(true);
      ys.push(p.y);
    }
    // Ends below the deck; apex above it.
    expect(path.pointAt(1).y).toBeCloseTo(origin.y - ZEN_SLIDE.descentDrop, 3);
    expect(Math.max(...ys)).toBeGreaterThan(origin.y + ZEN_SLIDE.climbHeight * 0.9);
  });

  it('tangentAt is a finite unit vector at every u (well-defined for nose-pitch + camera)', () => {
    for (const u of us(120)) {
      const t = path.tangentAt(u);
      const len = Math.hypot(t.x, t.y, t.z);
      expect(finite(len)).toBe(true);
      expect(len).toBeCloseTo(1, 3);
    }
  });

  it('does not alias pointAt and tangentAt scratch (a tangent call must not corrupt a held point)', () => {
    const p = path.pointAt(0.5);
    const held = { x: p.x, y: p.y, z: p.z };
    path.tangentAt(0.5);
    expect(p.x).toBeCloseTo(held.x, 9);
    expect(p.y).toBeCloseTo(held.y, 9);
    expect(p.z).toBeCloseTo(held.z, 9);
  });
});

describe('Zen slide trigger — vistaDeckUnder', () => {
  const seed = ZEN.worldSeed;
  // Find a real vista in the deterministic field (rarest type, weight 1).
  const vista = landmarksInRadius(seed, 0, 0, 40000)
    .filter((l) => l.type === LANDMARK_VISTA)
    .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];

  it('a vista exists in range (sanity)', () => {
    expect(vista).toBeTruthy();
  });

  it('fires on the vista deck centre and returns that vista', () => {
    const hit = vistaDeckUnder(seed, vista.x, vista.z);
    expect(hit).toBeTruthy();
    expect(hit!.x).toBeCloseTo(vista.x, 6);
    expect(hit!.z).toBeCloseTo(vista.z, 6);
  });

  it('does NOT fire just off the deck (outside the flat top) or far away', () => {
    const offDeck = ZEN_LANDMARK.vistaTopRadius * vista.scale + 30; // past the flat-top rim
    expect(vistaDeckUnder(seed, vista.x + offDeck, vista.z)).toBeNull();
    expect(vistaDeckUnder(seed, vista.x + 5000, vista.z + 5000)).toBeNull();
  });
});
