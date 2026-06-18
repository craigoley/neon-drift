/**
 * Zen TUNNEL DRIVE-DOWN — Stage C1: THE DEFAULT-PATH CANARY (the merge gate).
 *
 * A (#161) proved the seam; B (#162) made the tunnel asymmetric (far half holds deep, leaving a latent
 * far-mouth terminus); C1 makes the continuous drive-down the DEFAULT (ZEN_DRIVEDOWN.enabled = true),
 * COVERS that terminus (the basin now contains the held-deep far mouth), and drives the amber cavern
 * POSITIONALLY (driveDownDepth + hysteresis) instead of by a teleport. The #158 WARP is RETAINED behind
 * the flag (enabled = false) as a fallback — these tests confirm it still works.
 *
 * Because the DEFAULT changed, this is the gate: the drive-down must be pop-free as shipped —
 *  • the FAR-MOUTH TERMINUS is covered: driving out the held-deep far end lands on the deep basin, no
 *    step, no flicker, eased to terrain at the room's back wall (B's latent step gone);
 *  • the Stage A CENTRE seam + corridor + unified-mesh invariants still hold under the default;
 *  • the POSITIONAL cavern state toggles cleanly with a hysteresis dead-band (no flicker);
 *  • the WARP FALLBACK (flag off) is intact (the symmetric tunnel resurfaces at the far mouth).
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { queryDrivableSurface, surfaceSlopeAlong, driveDownDepth } from '../ZenLandmarkSurface';
import { createZenVehicle, updateZen, updateVertical } from '../ZenVehicle';
import { heightAt } from '../ZenHeight';
import {
  landmarksInRadius,
  tunnelDepthFactor,
  tunnelBasinCoverageFactor,
  tunnelBasinDepthFactor,
  LANDMARK_TUNNEL,
} from '../ZenLandmarkModel';
import { nearestTunnel } from '../ZenTunnelPayoff';
import { ZEN, ZEN_LANDMARK, ZEN_DRIVEDOWN } from '../../utils/constants';

const seed = ZEN.worldSeed;
const tun = landmarksInRadius(seed, 0, 0, 40000)
  .filter((l) => l.type === LANDMARK_TUNNEL)
  .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
const tx = Math.sin(tun.rotationY);
const tz = Math.cos(tun.rotationY);
const hw = ZEN_LANDMARK.tunnelHalfWidth * tun.scale;
const halfL = ZEN_LANDMARK.tunnelLength * tun.scale * 0.5;
const flatR = ZEN_DRIVEDOWN.basinFlatRadius * tun.scale;
const rimR = ZEN_DRIVEDOWN.basinRimRadius * tun.scale;
const farMargin = ZEN_DRIVEDOWN.basinFarMargin * tun.scale;
const centreGround = heightAt(seed, tun.x, tun.z);
const deepY = centreGround - ZEN_LANDMARK.tunnelDepth * tun.scale;
/** World point at axial `along` (+ = FAR/held-deep, − = ENTRY) + lateral `perp` from the tunnel centre. */
const at = (along: number, perp: number) => ({ x: tun.x + along * tx - perp * tz, z: tun.z + along * tz + perp * tx });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setFlag = (on: boolean) => { (ZEN_DRIVEDOWN as any).enabled = on; };

describe('Zen drive-down Stage C1 — the DRIVE-DOWN is the DEFAULT (warp retained as fallback)', () => {
  it('ZEN_DRIVEDOWN.enabled defaults to true (the shipping tunnel payoff is the continuous drive-down)', () => {
    expect(ZEN_DRIVEDOWN.enabled).toBe(true);
  });

  it('FALLBACK intact: with the flag OFF the symmetric tunnel resurfaces at the far mouth (the warp tunnel)', () => {
    setFlag(false);
    try {
      // Far mouth + beyond is plain terrain again (the warp path's symmetric tunnel — depthFactor → 0).
      expect(tunnelDepthFactor(1)).toBeCloseTo(0, 12);
      const past = at(halfL + 6, 0);
      const s = queryDrivableSurface(seed, past.x, past.z);
      expect(s.onSurface).toBe(false);
      expect(s.y).toBeCloseTo(heightAt(seed, past.x, past.z), 6);
      // And just outside the tube at the centre is terrain (no basin) — byte-identical to pre-drive-down.
      const side = at(0, hw + 20);
      expect(queryDrivableSurface(seed, side.x, side.z).onSurface).toBe(false);
    } finally {
      setFlag(true);
    }
  });
});

describe('Zen drive-down Stage C1 — FAR-MOUTH TERMINUS coverage (flag ON, the default)', () => {
  beforeAll(() => setFlag(true));
  afterAll(() => setFlag(true)); // the default — leave it on

  it('the combined coverage equals the Stage A disc in the centre core (proven seam unchanged)', () => {
    // On the entry side + in the deep core the far corridor never exceeds the disc, so the Stage A/B
    // probes are byte-identical: at along ≤ 0, coverage == the centre disc.
    for (const [along, perp] of [[0, hw + 30], [-80, hw + 5], [0, flatR - 10], [-150, hw + 1.5]]) {
      const r = Math.hypot(along, perp);
      expect(tunnelBasinCoverageFactor(along, perp, halfL, tun.scale)).toBeCloseTo(tunnelBasinDepthFactor(r, tun.scale), 12);
    }
  });

  it('the held-deep far mouth is now COVERED at the deep Y (no exposed terminus)', () => {
    // Just inside the far mouth (tube) and just outside it (basin far corridor) are BOTH the deep floor.
    // NB: queryDrivableSurface returns a REUSED scratch object — capture scalars before the next call.
    const inside = at(halfL - 5, 0);
    const outside = at(halfL + 5, 0);
    const sIn = queryDrivableSurface(seed, inside.x, inside.z);
    const siY = sIn.y, siOn = sIn.onSurface;
    const sOut = queryDrivableSurface(seed, outside.x, outside.z);
    const soY = sOut.y, soOn = sOut.onSurface;
    expect(siOn, 'inside the far mouth').toBe(true);
    expect(soOn, 'just past the far mouth → on the basin (covered)').toBe(true);
    expect(siY).toBeCloseTo(deepY, 2); // inside the tube the far half is exactly the deep floor
    // Just past the mouth the room's back wall has only just begun easing up (≈0.5% grade over 10u) —
    // the terminus seam is Y-CONTINUOUS (no step), which is the point; it is NOT a cliff to terrain.
    expect(soY, 'still essentially the deep floor just past the mouth').toBeLessThan(deepY + 0.5);
    expect(Math.abs(siY - soY), 'far-mouth ΔY ≈ 0 (terminus seam, no step)').toBeLessThan(0.1);
  });

  it('DRIVING out the held-deep far end → onto the basin, no pop, eased to terrain at the back wall', () => {
    const dt = 1 / 60;
    const v = createZenVehicle();
    const start = at(flatR, 0); // in the deep core, heading +axis toward (and out) the far mouth
    v.x = start.x; v.z = start.z; v.heading = Math.PI - tun.rotationY; // forward = +axis
    v.y = deepY + ZEN.rideHeight;
    v.speed = 80;
    let maxStep = 0, deepZoneToggles = 0, lastOn: boolean | null = null, leftRoom = false, crossedMouth = false;
    for (let f = 0; f < 1400; f++) {
      const slope = surfaceSlopeAlong(seed, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
      updateZen(v, 0, 1, dt, v.airborne ? 0 : slope);
      const surf = queryDrivableSurface(seed, v.x, v.z);
      const prevY = v.y;
      updateVertical(v, surf.y + ZEN.rideHeight, slope, dt, !surf.onSurface);
      expect(Number.isFinite(v.y)).toBe(true);
      const along = (v.x - tun.x) * tx + (v.z - tun.z) * tz;
      maxStep = Math.max(maxStep, Math.abs(v.y - prevY));
      // THE DEEP ZONE: from the core through the far mouth and into the room past it, BEFORE the back
      // wall starts easing up — onSurface must never flicker to terrain (the terminus is covered).
      if (along < halfL + farMargin * 0.4) {
        if (along > flatR + 5) {
          if (lastOn !== null && lastOn !== surf.onSurface) deepZoneToggles++;
          lastOn = surf.onSurface;
        }
        if (along > halfL) crossedMouth = true; // actually drove out past the far mouth
      }
      if (along > halfL + farMargin + 60 && !surf.onSurface) { leftRoom = true; break; } // out the back wall onto terrain
    }
    expect(crossedMouth, 'drove out past the held-deep far mouth').toBe(true);
    expect(deepZoneToggles, 'no flicker driving out the far end (terminus covered)').toBe(0);
    expect(leftRoom, 'eventually eased up to terrain past the back wall').toBe(true);
    expect(maxStep, 'the whole far-end run incl. the back-wall ramp stays under the canary bound').toBeLessThan(0.6);
  });

  it('LATERAL seam (centre) still pop-free under the default — the Stage A handoff un-regressed', () => {
    const dt = 1 / 60;
    const v = createZenVehicle();
    const start = at(0, -(rimR + 50));
    v.x = start.x; v.z = start.z; v.heading = Math.atan2(-tz, -tx); // forward = +perp
    v.y = heightAt(seed, v.x, v.z) + ZEN.rideHeight;
    v.speed = 80;
    let seamToggles = 0, seamMaxStep = 0, wholeMaxStep = 0, lastOn: boolean | null = null, enteredBasin = false;
    for (let f = 0; f < 900; f++) {
      const slope = surfaceSlopeAlong(seed, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
      updateZen(v, 0, 1, dt, v.airborne ? 0 : slope);
      const surf = queryDrivableSurface(seed, v.x, v.z);
      const prevY = v.y;
      updateVertical(v, surf.y + ZEN.rideHeight, slope, dt, !surf.onSurface);
      const along = (v.x - tun.x) * tx + (v.z - tun.z) * tz;
      const perp = -(v.x - tun.x) * tz + (v.z - tun.z) * tx;
      const r = Math.hypot(along, perp);
      wholeMaxStep = Math.max(wholeMaxStep, Math.abs(v.y - prevY));
      if (r < flatR - 5) {
        enteredBasin = true;
        if (lastOn !== null && lastOn !== surf.onSurface) seamToggles++;
        lastOn = surf.onSurface;
        seamMaxStep = Math.max(seamMaxStep, Math.abs(v.y - prevY));
      }
    }
    expect(enteredBasin).toBe(true);
    expect(seamToggles, 'onSurface never flickers across the centre seam').toBe(0);
    expect(seamMaxStep, 'the centre seam is dead-flat').toBeLessThan(0.2);
    expect(wholeMaxStep, 'whole lateral pass under the canary bound').toBeLessThan(0.6);
  });

  it('corridor (#154) holds and the far corridor lateral ease reuses the disc radii (seamless union)', () => {
    expect(ZEN_LANDMARK.tunnelHalfWidth - ZEN_LANDMARK.tunnelBendAmplitude).toBeGreaterThanOrEqual(25);
    // At along = 0 the far profile == the disc (continuity of the union there).
    for (const perp of [0, 100, 300, 500]) {
      const r = Math.abs(perp);
      expect(tunnelBasinCoverageFactor(0, perp, halfL, tun.scale)).toBeCloseTo(tunnelBasinDepthFactor(r, tun.scale), 12);
    }
  });
});

describe('Zen drive-down Stage C1 — POSITIONAL cavern state (driveDownDepth + hysteresis)', () => {
  beforeAll(() => setFlag(true));
  afterAll(() => setFlag(true));

  it('driveDownDepth is ~0 on terrain, ~tunnelDepth deep in the tunnel, and resolves the tunnel for placement', () => {
    const far = at(0, rimR + 400); // well outside any tunnel/basin → plain terrain
    expect(Math.abs(driveDownDepth(seed, far.x, far.z))).toBeLessThan(1);
    const deep = at(200, 0); // deep in the held-deep core
    expect(driveDownDepth(seed, deep.x, deep.z)).toBeGreaterThan(ZEN_LANDMARK.tunnelDepth * tun.scale * 0.9);
    // The cavern placement uses nearestTunnel — it resolves the right tunnel even from the basin floor.
    const onBasin = at(0, hw + 30);
    const found = nearestTunnel(seed, onBasin.x, onBasin.z);
    expect(found?.id).toBe(tun.id);
  });

  it('the palette toggles with a HYSTERESIS dead-band — descending in / driving back out never flickers', () => {
    // Simulate the session's positional rule along an axial sweep IN then OUT through the entry ramp,
    // sampling the surface depth each step. The dead-band [exit, enter] must yield exactly ONE enter on
    // the way down and ONE revert on the way back up — no chatter at the threshold.
    const enter = ZEN_DRIVEDOWN.cavernEnterDepth;
    const exit = ZEN_DRIVEDOWN.cavernExitDepth;
    expect(enter).toBeGreaterThan(exit); // a real dead-band
    let inCavern = false, enters = 0, reverts = 0;
    const step = (along: number) => {
      const p = at(along, 0);
      const depth = driveDownDepth(seed, p.x, p.z);
      if (!inCavern && depth > enter) { inCavern = true; enters++; }
      else if (inCavern && depth < exit) { inCavern = false; reverts++; }
    };
    // Drive DOWN the entry ramp into the deep core (entry mouth at −halfL → core), 2u steps.
    for (let a = -(halfL + 20); a <= 0; a += 2) step(a);
    expect(inCavern, 'amber on once deep in the core').toBe(true);
    expect(enters, 'entered the cavern exactly once (no flicker on the way down)').toBe(1);
    // Drive back UP and out the entry mouth.
    for (let a = 0; a >= -(halfL + 20); a -= 2) step(a);
    expect(inCavern, 'amber off once back up at the surface').toBe(false);
    expect(reverts, 'reverted exactly once (no flicker on the way up)').toBe(1);
  });
});
