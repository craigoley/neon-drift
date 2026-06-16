/**
 * Zen ARCH boost + RING random-warp — the PURE units (the FEEL is a phone playtest, but the maths
 * are unit-testable): the arch boost raises the speed cap then eases it back to cruise; the ring
 * destination is a real random hop in the distance band; and the generic drive-through trigger fires
 * for the right type only.
 */
import { describe, expect, it } from 'vitest';
import { boostIntensity, boostedMaxSpeed } from '../ZenArchBoost';
import { createZenVehicle, updateZen } from '../ZenVehicle';
import { randomWarpDestination } from '../ZenRingWarp';
import { crossedAnyOfType, landmarksInRadius, LANDMARK_ARCH, LANDMARK_RING } from '../ZenLandmarkModel';
import { ZEN, ZEN_ARCH, ZEN_RING } from '../../utils/constants';

/** A deterministic rng that replays a fixed sequence (wraps) — for the random-warp tests. */
const seqRng = (...vals: number[]): (() => number) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

describe('Zen ARCH speed boost — the decay curve', () => {
  it('the boost LINGERS — a substantially long duration (playtest dial, guards against re-shortening)', () => {
    // Raised 6.5→11.0: the surge lasts noticeably longer before it has fully eased back to cruise.
    expect(ZEN_ARCH.boostSeconds).toBeGreaterThanOrEqual(10);
  });

  it('a longer boost still eases gently the WHOLE way — half-time is still mid-surge, not snapped off', () => {
    // The decay is smoothstep over [0, boostSeconds], so stretching the duration keeps the same gentle
    // shape: at half the (now longer) timer the cap is still meaningfully above cruise and below the top.
    const half = boostedMaxSpeed(ZEN_ARCH.boostSeconds * 0.5);
    expect(half).toBeGreaterThan(ZEN.maxSpeed + 10);
    expect(half).toBeLessThan(ZEN_ARCH.boostMaxSpeed);
    // No single 0.25s step in the cap exceeds a gentle bound across the whole decay (a fade, not a jump).
    let prev = boostedMaxSpeed(0);
    let maxStep = 0;
    for (let t = 0.25; t <= ZEN_ARCH.boostSeconds + 1e-9; t += 0.25) {
      const m = boostedMaxSpeed(t);
      maxStep = Math.max(maxStep, Math.abs(m - prev));
      prev = m;
    }
    expect(maxStep, 'the eased cap moves gently per 0.25s — no snap').toBeLessThan(8);
  });

  it('intensity is 0 at/under rest and 1 right after a crossing', () => {
    expect(boostIntensity(0)).toBe(0);
    expect(boostIntensity(-2)).toBe(0);
    expect(boostIntensity(ZEN_ARCH.boostSeconds)).toBeCloseTo(1, 6);
  });

  it('the cap is cruise at rest and the boosted top at full boost', () => {
    expect(boostedMaxSpeed(0)).toBeCloseTo(ZEN.maxSpeed, 6);
    expect(boostedMaxSpeed(ZEN_ARCH.boostSeconds)).toBeCloseTo(ZEN_ARCH.boostMaxSpeed, 6);
    expect(ZEN_ARCH.boostMaxSpeed).toBeGreaterThan(ZEN.maxSpeed); // it's actually a boost
  });

  it('eases monotonically back DOWN to cruise as the timer winds down (a fade, not a snap)', () => {
    let prev = -Infinity;
    // Walk the timer from 0 up to full — the cap should be non-decreasing in boost time.
    for (let t = 0; t <= ZEN_ARCH.boostSeconds + 1e-9; t += 0.25) {
      const m = boostedMaxSpeed(t);
      expect(m).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(Number.isFinite(m)).toBe(true);
      prev = m;
    }
    // And it never exceeds the boosted top nor dips below cruise.
    expect(boostedMaxSpeed(ZEN_ARCH.boostSeconds * 0.5)).toBeGreaterThan(ZEN.maxSpeed);
    expect(boostedMaxSpeed(ZEN_ARCH.boostSeconds * 0.5)).toBeLessThan(ZEN_ARCH.boostMaxSpeed);
  });

  it('updateZen honours the raised cap — the boost KICK survives under it (default clamps to cruise)', () => {
    const kick = ZEN_ARCH.boostMaxSpeed * ZEN_ARCH.boostKickFrac; // the session's instant surge
    // Under the boosted cap, the kicked speed is PRESERVED (not clamped back to cruise).
    const boosted = createZenVehicle();
    boosted.speed = kick;
    updateZen(boosted, 0, 1, 1 / 60, 0, ZEN_ARCH.boostMaxSpeed);
    expect(boosted.speed).toBeGreaterThan(ZEN.maxSpeed + 10); // still well above cruise
    expect(boosted.speed).toBeLessThanOrEqual(ZEN_ARCH.boostMaxSpeed + 1e-6);
    // With the default cap, the SAME kick is clamped straight back down to cruise (no boost).
    const clamped = createZenVehicle();
    clamped.speed = kick;
    updateZen(clamped, 0, 1, 1 / 60);
    expect(clamped.speed).toBeLessThanOrEqual(ZEN.maxSpeed + 1e-6);
  });
});

describe('Zen RING random warp — the destination picker', () => {
  it('lands in the distance band, in the direction set by the rng (deterministic with a fixed rng)', () => {
    // angle = 0.25·2π = π/2 → forward (sin, −cos) = (1, 0); dist = midpoint of the band.
    const d = randomWarpDestination(1000, 2000, seqRng(0.25, 0.5));
    const midDist = (ZEN_RING.minDistance + ZEN_RING.maxDistance) / 2;
    expect(d.x).toBeCloseTo(1000 + midDist, 3);
    expect(d.z).toBeCloseTo(2000, 3);
    expect(d.heading).toBeCloseTo(0.25 * Math.PI * 2, 6);
  });

  it('every random hop is a SUBSTANTIAL move within the band (somewhere new, not next door)', () => {
    for (let k = 0; k < 200; k++) {
      const d = randomWarpDestination(0, 0); // real Math.random
      const moved = Math.hypot(d.x, d.z);
      expect(moved).toBeGreaterThanOrEqual(ZEN_RING.minDistance - 1e-6);
      expect(moved).toBeLessThanOrEqual(ZEN_RING.maxDistance + 1e-6);
      expect(Number.isFinite(d.x) && Number.isFinite(d.z) && Number.isFinite(d.heading)).toBe(true);
    }
  });
});

describe('Zen drive-through trigger — crossedAnyOfType (arch boost + ring warp share it)', () => {
  const seed = ZEN.worldSeed;
  const nearestOf = (type: number) =>
    landmarksInRadius(seed, 0, 0, 50000)
      .filter((l) => l.type === type)
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
  const arch = nearestOf(LANDMARK_ARCH);
  const ring = nearestOf(LANDMARK_RING);

  it('an arch + a ring both exist in range (sanity)', () => {
    expect(arch).toBeTruthy();
    expect(ring).toBeTruthy();
  });

  it('driving straight through an ARCH fires the ARCH trigger — and not the RING one', () => {
    const tx = Math.sin(arch.rotationY); // through-axis
    const tz = Math.cos(arch.rotationY);
    const prevX = arch.x - tx * 6;
    const prevZ = arch.z - tz * 6;
    const x = arch.x + tx * 6;
    const z = arch.z + tz * 6;
    expect(crossedAnyOfType(seed, LANDMARK_ARCH, prevX, prevZ, x, z)).toBe(true);
    expect(crossedAnyOfType(seed, LANDMARK_RING, prevX, prevZ, x, z)).toBe(false);
  });

  it('driving straight through a RING fires the RING trigger', () => {
    const tx = Math.sin(ring.rotationY);
    const tz = Math.cos(ring.rotationY);
    expect(crossedAnyOfType(seed, LANDMARK_RING, ring.x - tx * 6, ring.z - tz * 6, ring.x + tx * 6, ring.z + tz * 6)).toBe(true);
  });

  it('staying on ONE side of an arch (no plane crossing) does not fire', () => {
    const tx = Math.sin(arch.rotationY);
    const tz = Math.cos(arch.rotationY);
    // Both points 6u in FRONT of the opening — same side, no crossing.
    expect(crossedAnyOfType(seed, LANDMARK_ARCH, arch.x + tx * 6, arch.z + tz * 6, arch.x + tx * 10, arch.z + tz * 10)).toBe(false);
  });
});
