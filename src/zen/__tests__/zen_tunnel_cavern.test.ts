/**
 * Zen TUNNEL CAVERN (Stage 4 follow-up) — the PURE layout maths for the beautiful payoff space. The
 * cavern is visual decoration on the EXISTING ground (anchored via heightAt), so the drivable surface
 * is untouched (the #154/#149 tunnel tests pass unchanged). These assert the testable design: you
 * EMERGE facing the centerpiece (the awe moment), the monuments populate the open floor within bounds,
 * the cavern sits at the (far) tunnel region, and the whole thing is deterministic + bounded.
 */
import { describe, expect, it } from 'vitest';
import { cavernLayout } from '../ZenCavernLayout';
import { tunnelReturnPortal } from '../ZenTunnelPayoff';
import { arrivalPose } from '../ZenSecret';
import { findReturnPortal } from '../ZenSecret';
import { ZEN, ZEN_TUNNEL_CAVERN } from '../../utils/constants';

const SEED = ZEN.worldSeed;
const portal = tunnelReturnPortal(SEED);
const layout = cavernLayout(SEED, portal);

describe('Zen cavern — you EMERGE facing the centerpiece (the awe moment)', () => {
  it('the centerpiece sits straight ahead of the arrival pose (forward points right at it)', () => {
    const pose = arrivalPose(portal);
    const fx = Math.sin(pose.heading);
    const fz = -Math.cos(pose.heading);
    const toCx = layout.center.x - pose.x;
    const toCz = layout.center.z - pose.z;
    const len = Math.hypot(toCx, toCz);
    expect(len).toBeGreaterThan(50); // it's actually ahead, not under you
    expect((fx * toCx + fz * toCz) / len).toBeGreaterThan(0.999); // dead ahead (the awe view)
  });

  it('the centerpiece is a TALL spire (a striking vertical landmark)', () => {
    expect(layout.centerpieceHeight).toBeGreaterThanOrEqual(100);
  });
});

describe('Zen cavern — monuments populate the open floor (things to drive toward + carve around)', () => {
  it('places the configured count, each within the inner-floor radius band, on the real ground', () => {
    expect(layout.monuments.length).toBe(ZEN_TUNNEL_CAVERN.monumentCount);
    for (const m of layout.monuments) {
      const r = Math.hypot(m.x - layout.center.x, m.z - layout.center.z);
      expect(r).toBeGreaterThanOrEqual(ZEN_TUNNEL_CAVERN.monumentMinRadius - 1e-6); // off the centerpiece
      expect(r).toBeLessThanOrEqual(ZEN_TUNNEL_CAVERN.monumentMaxRadius + 1e-6); // within the open floor
      expect(Number.isFinite(m.baseY)).toBe(true); // anchored to the existing ground (heightAt)
      expect(m.hue).toBeGreaterThanOrEqual(0);
      expect(m.hue).toBeLessThan(ZEN_TUNNEL_CAVERN.amberPalette.length);
    }
  });

  it('the enclosing shell is an even ring of distant pillars (the vast-space walls)', () => {
    expect(layout.shell.length).toBe(ZEN_TUNNEL_CAVERN.shellCount);
    for (const p of layout.shell) {
      const r = Math.hypot(p.x - layout.center.x, p.z - layout.center.z);
      expect(r).toBeCloseTo(ZEN_TUNNEL_CAVERN.shellRadius, 3); // a clean ring at the shell radius
    }
  });
});

describe('Zen cavern — the space is a real, deterministic, far-off place', () => {
  it('is deterministic (the same cavern every visit)', () => {
    expect(cavernLayout(SEED, portal)).toEqual(cavernLayout(SEED, portal));
  });

  it('sits at the far tunnel region — distinct from the origin AND the gateway secret area', () => {
    expect(Math.hypot(layout.center.x, layout.center.z)).toBeGreaterThan(100000); // a place apart
    const secret = findReturnPortal(SEED);
    expect(Math.hypot(layout.center.x - secret.x, layout.center.z - secret.z)).toBeGreaterThan(100000);
  });

  it('the return portal reads as the way back — a DISTINCT (cyan) marker amid the all-amber cavern', () => {
    // (Layout anchors the centre off the portal; the cyan marker colour is the readability cue.)
    expect(ZEN_TUNNEL_CAVERN.portalMarkerColor).not.toBe(ZEN_TUNNEL_CAVERN.amberPalette[0]);
  });
});
