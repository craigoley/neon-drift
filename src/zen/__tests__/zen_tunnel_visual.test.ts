/**
 * Zen tunnel VISUAL EVOLUTION (Stage 1) + DECORATION placement (Stage 2a) — the PURE maths. These are
 * COSMETIC only: they drive vertex colours + decorative geometry and are NEVER read by the drivable
 * surface, so the #154 corridor / #149 unified-floor / off-centre canary are not involved here (that
 * stays green, unchanged, in zen_tunnel_smooth.test.ts). These guard the gradient shape + that the
 * decorations sit OFF the drive line.
 */
import { describe, expect, it } from 'vitest';
import {
  descentParam,
  tunnelTubeRGB,
  tunnelFloorRGB,
  tunnelDecorStations,
  tunnelDecorWallOffset,
  tunnelLocalFloorY,
  tunnelArchHeightLocal,
} from '../ZenTunnelVisual';
import { ZEN_LANDMARK, ZEN_TUNNEL_VISUAL } from '../../utils/constants';

describe('Zen tunnel — descent progress', () => {
  it('is 0 at the mouths, 1 at the deepest centre, and clamps outside the tube', () => {
    expect(descentParam(1)).toBe(0); // mouth
    expect(descentParam(-1)).toBe(0); // other mouth
    expect(descentParam(0)).toBe(1); // deepest centre
    expect(descentParam(0.5)).toBeCloseTo(0.5, 6);
    expect(descentParam(2)).toBe(0); // beyond the mouth — clamped
  });
});

describe('Zen tunnel — colour gradient evolves cyan → violet → gold', () => {
  it('shallow (p=0) is CYAN: blue+green dominate red', () => {
    const [r, g, b] = tunnelTubeRGB(0);
    expect(b).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(r);
  });

  it('deep (p=1) is GOLD/warm: red dominates blue, and is BRIGHTENED (the bloom ramp lifts it >1)', () => {
    const [r, g, b] = tunnelTubeRGB(1);
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
    expect(r).toBeGreaterThan(1); // deepBrightness ramp pushes the gold channel above 1 → bloom flares
  });

  it('mid (p≈midpoint) is VIOLET: red + blue both present, distinct from the two ends', () => {
    const [r, , b] = tunnelTubeRGB(ZEN_TUNNEL_VISUAL.gradientMidPoint);
    expect(r).toBeGreaterThan(0.2); // violet has real red...
    expect(b).toBeGreaterThan(0.5); // ...and strong blue
  });

  it('the deep end is brighter than the shallow end (intensity ramps DOWN the descent)', () => {
    const sumAt = (p: number) => tunnelTubeRGB(p).reduce((a, c) => a + c, 0);
    expect(sumAt(1)).toBeGreaterThan(sumAt(0));
  });
});

describe('Zen tunnel — the ROAD keeps its cyan "drive here" identity', () => {
  it('the floor stays cyan-held even at the deepest point where the wall has gone gold', () => {
    const floor = tunnelFloorRGB(1);
    const wall = tunnelTubeRGB(1);
    expect(floor[2]).toBeGreaterThanOrEqual(floor[0]); // road: blue >= red (cyan-held, not gold)
    expect(wall[0]).toBeGreaterThan(wall[2]); // wall: red > blue (gold) — they stay distinguishable
  });

  it('the road glows a touch brighter than the wall (it reads as the bright ribbon)', () => {
    const floorSum = tunnelFloorRGB(0).reduce((a, c) => a + c, 0);
    const wallSum = tunnelTubeRGB(0).reduce((a, c) => a + c, 0);
    expect(floorSum).toBeGreaterThan(wallSum);
  });
});

describe('Zen tunnel — DECORATIVE crystals sit OFF the drive line (never touch the road)', () => {
  const halfL = ZEN_LANDMARK.tunnelLength * 0.5;
  const stations = tunnelDecorStations(halfL);

  it('there are decoration stations (things to see), and they skip the shallow mouth zones', () => {
    expect(stations.length).toBeGreaterThan(0);
    for (const st of stations) {
      // Only where the arch is tall enough (the deep, novel stretch) — never crammed at a mouth.
      expect(tunnelArchHeightLocal(st.z, halfL)).toBeGreaterThanOrEqual(ZEN_TUNNEL_VISUAL.decorMinArch);
    }
  });

  it('every crystal is OUT by the wall (not on the central road) and ABOVE the road surface', () => {
    const wallOff = tunnelDecorWallOffset();
    // Out by the wall: the lateral offset is most of the half-width (well clear of the centre line).
    expect(wallOff).toBeGreaterThan(ZEN_LANDMARK.tunnelHalfWidth * 0.6);
    // ...but still inside the tube (within the wall, not outside it).
    expect(wallOff).toBeLessThan(ZEN_LANDMARK.tunnelHalfWidth);
    for (const st of stations) {
      const floorY = tunnelLocalFloorY(st.z, halfL);
      // The crystal's whole body (centre ± size) sits above the road — you pass it, never drive over it.
      expect(st.centreY - ZEN_TUNNEL_VISUAL.decorSize).toBeGreaterThan(floorY);
    }
  });

  it('the crystals alternate walls (left/right) so both sides have things to see', () => {
    const signs = new Set(stations.map((s) => s.sign));
    expect(signs.has(-1)).toBe(true);
    expect(signs.has(1)).toBe(true);
  });
});
