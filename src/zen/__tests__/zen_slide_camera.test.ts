/**
 * Zen sky-slide CAMERA — the heading ease must follow the (±π-wrapped) slide heading the SHORT way,
 * so the camera never "spins around" at a ±π crossing (diagnosis #150). The fix is the wrap-aware
 * ease `a = wrapToPi(a + wrapToPi(target − a)·f)`. Guarded here:
 *   - wrapToPi maps a ±2π jump to ~0 (the shortest signed delta);
 *   - over the REAL slide path (worst-case launch heading), the wrap-aware ease moves the camera a
 *     few deg/frame — the OLD raw ease unwound a full turn at the crossing;
 *   - it's a NO-OP for normal (continuous-heading) driving (same camera direction as before).
 */
import { describe, expect, it } from 'vitest';
import { wrapToPi, smoothFollow } from '../../utils/math';
import { ZenSlidePath } from '../ZenSlidePath';
import { ZEN_SLIDE } from '../../utils/constants';

const rawEase = (a: number, target: number, f: number): number => a + (target - a) * f;
const wrapEase = (a: number, target: number, f: number): number => wrapToPi(a + wrapToPi(target - a) * f);

describe('wrapToPi', () => {
  it('maps any angle into [−π, π] (the shortest signed representation)', () => {
    expect(wrapToPi(0)).toBeCloseTo(0, 9);
    expect(wrapToPi(Math.PI - 0.01)).toBeCloseTo(Math.PI - 0.01, 9);
    // A ±360° step collapses to ~0 — the whole point.
    expect(Math.abs(wrapToPi(2 * Math.PI - 0.02))).toBeCloseTo(0.02, 6);
    expect(Math.abs(wrapToPi(-(2 * Math.PI) + 0.02))).toBeCloseTo(0.02, 6);
    // Across the cut: +179° → −179° is a 2° move, not 358°.
    const jump = (-179 - 179) * (Math.PI / 180);
    expect(Math.abs(wrapToPi(jump))).toBeCloseTo(2 * (Math.PI / 180), 6);
    for (const a of [-50, -3.2, -Math.PI, 3.2, 12.7, 100]) {
      expect(wrapToPi(a)).toBeGreaterThanOrEqual(-Math.PI - 1e-9);
      expect(wrapToPi(a)).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });
});

describe('slide camera heading ease — no spin across the ±π crossing', () => {
  const dt = 1 / 60;
  const du = (ZEN_SLIDE.rideMaxSpeed / ZEN_SLIDE.pathLength) * dt;
  const f = smoothFollow(ZEN_SLIDE.camPosLerp, dt);

  /** Drive the camera ease through a full slide; return the worst per-frame |Δ camera| (true angle). */
  const maxCamStep = (h0: number, ease: (a: number, t: number, f: number) => number): number => {
    const path = new ZenSlidePath({ x: 0, y: 200, z: 0 }, h0);
    let boom = wrapToPi(Math.atan2(path.tangentAt(0).x, -path.tangentAt(0).z));
    let maxStep = 0;
    for (let u = 0; u < 1; u += du) {
      const t = path.tangentAt(u);
      const target = Math.atan2(t.x, -t.z);
      const prev = boom;
      boom = ease(boom, target, f);
      maxStep = Math.max(maxStep, Math.abs(wrapToPi(boom - prev)));
    }
    return maxStep;
  };

  it('the WRAP-AWARE ease keeps the camera smooth for every launch heading (incl. ±π crossings)', () => {
    // h0 ≈ ±2.7 made the OLD ease cross the ±π branch cut mid/late descent → a ~360° unwind.
    for (const h0 of [0.9, 2.64, 2.84, -2.74, Math.PI, -Math.PI + 0.2]) {
      const step = maxCamStep(h0, wrapEase);
      expect(step, `h0=${h0} smooth`).toBeLessThan(0.12); // < ~7°/frame, no spin
    }
  });

  it('the OLD raw-angle ease DID spin (so this guard is meaningful)', () => {
    const worst = Math.max(...[2.64, 2.84, -2.74].map((h0) => maxCamStep(h0, rawEase)));
    expect(worst).toBeGreaterThan(0.2); // the bug: ≈15.7°/frame ≈ 0.27 rad — caught
  });

  it('is a NO-OP for normal (continuous, unwrapped) driving — same camera direction as before', () => {
    // A heading that accumulates past ±π (as updateZen's does over a few turns).
    let raw = 0.3;
    let wrapped = wrapToPi(0.3);
    let h = 0.3;
    for (let i = 0; i < 400; i++) {
      h += 0.04; // continuous turn, no wrap (grows past π, 2π, ...)
      raw = rawEase(raw, h, f);
      wrapped = wrapEase(wrapped, h, f);
      // Same facing: sin/cos agree (the wrap only changes the representative, not the direction).
      expect(Math.sin(wrapped)).toBeCloseTo(Math.sin(raw), 6);
      expect(Math.cos(wrapped)).toBeCloseTo(Math.cos(raw), 6);
    }
    // ...and the wrapped value stays bounded (the raw one runs off to ~16 rad).
    expect(Math.abs(wrapped)).toBeLessThanOrEqual(Math.PI + 1e-9);
  });
});
