/**
 * Zen TUNNEL DRIVE-DOWN — Stage A: THE EXTENDED SEAM CANARY (the merge gate / the gamble).
 *
 * Stage A re-opens surfaceUnder (the #148/#149/#153/#154 bump-saga code) to add a DEEP DRIVABLE BASIN
 * — a sunken drive-around room at the tunnel's deep centre — and proves the tunnel-floor → basin-floor
 * handoff is POP-FREE. The whole feature is FLAG-GATED (ZEN_DRIVEDOWN.enabled, OFF in production); these
 * tests flip it on to drive the ACTUAL seam (the #153 lesson: test where the pop would be, not the
 * un-failable centred case). If any of these go RED, Stage A FAILED → keep the #158 warp.
 *
 * THE SEAM RULE, asserted here:
 *  (1) Y-EQUALITY by CROSS-ANCHOR: at the tube wall, inTube Y == basin Y (both off heightAt(centre)).
 *  (2) COVERAGE: leaving the tube sideways lands on the basin — onSurface never flickers to terrain
 *      across the seam (toggles == 0 in the seam zone).
 *  (3) bounded grade: maxStep < 0.6 driving through the seam + the room.
 *  (4) UNIFIED MESH: the followed surface == the shared tunnelBasinDepthFactor formula (the #149 rule).
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { queryDrivableSurface, surfaceSlopeAlong } from '../ZenLandmarkSurface';
import { createZenVehicle, updateZen, updateVertical } from '../ZenVehicle';
import { heightAt } from '../ZenHeight';
import { landmarksInRadius, tunnelBasinDepthFactor, LANDMARK_TUNNEL } from '../ZenLandmarkModel';
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
const centreGround = heightAt(seed, tun.x, tun.z);
const deepY = centreGround - ZEN_LANDMARK.tunnelDepth * tun.scale;
/** World point at axial `along` + lateral `perp` from the tunnel centre. */
const at = (along: number, perp: number) => ({ x: tun.x + along * tx - perp * tz, z: tun.z + along * tz + perp * tx });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setFlag = (on: boolean) => { (ZEN_DRIVEDOWN as any).enabled = on; };

describe('Zen drive-down Stage A — the basin is OFF in production (no regression to the warp tunnel)', () => {
  it('with the flag OFF, outside-the-tube is plain terrain (surfaceUnder byte-identical to before)', () => {
    setFlag(false);
    // A point in the basin region (just outside the tube wall at the centre) — must read as TERRAIN.
    const p = at(0, hw + 20);
    const s = queryDrivableSurface(seed, p.x, p.z);
    expect(s.onSurface).toBe(false); // no basin → terrain (the normal tunnel + #154 canary unchanged)
    expect(s.y).toBeCloseTo(heightAt(seed, p.x, p.z), 6);
  });
});

describe('Zen drive-down Stage A — THE SEAM (flag on): tube floor hands off to the basin POP-FREE', () => {
  beforeAll(() => setFlag(true));
  afterAll(() => setFlag(false)); // never leak the flag to other tests / production

  it('(1) Y-EQUALITY: across the tube wall, inTube Y == basin Y (the cross-anchor) — no step', () => {
    for (const along of [0, 100, 200, -150]) {
      const inside = at(along, hw - 1.5); // just inside the tube wall
      const outside = at(along, hw + 1.5); // just outside → on the basin
      const si = queryDrivableSurface(seed, inside.x, inside.z);
      const so = queryDrivableSurface(seed, outside.x, outside.z);
      expect(si.onSurface, `inTube@${along}`).toBe(true);
      expect(so.onSurface, `basin@${along}`).toBe(true); // COVERAGE: never a frame of terrain at the seam
      expect(Math.abs(si.y - so.y), `seam ΔY@${along}`).toBeLessThan(0.01); // Y-EQUAL (pop-free)
      expect(si.y).toBeCloseTo(deepY, 2); // and it's the deep floor (cross-anchored to the tunnel centre)
    }
  });

  it('(2)+(3) DRIVING through the seam: onSurface never flickers + ΔY stays tiny in the seam zone', () => {
    const dt = 1 / 60;
    const v = createZenVehicle();
    // Start on TERRAIN outside the room, heading straight ACROSS the tube (+perp) through the centre.
    const start = at(0, -(rimR + 50));
    v.x = start.x; v.z = start.z; v.heading = Math.atan2(-tz, -tx); // forward = +perp
    v.y = heightAt(seed, v.x, v.z) + ZEN.rideHeight;
    v.speed = 80;
    let seamToggles = 0, seamMaxStep = 0, wholeMaxStep = 0, lastOn: boolean | null = null;
    let crossedTube = false, enteredBasin = false;
    for (let f = 0; f < 900; f++) {
      const slope = surfaceSlopeAlong(seed, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
      updateZen(v, 0, 1, dt, v.airborne ? 0 : slope);
      const surf = queryDrivableSurface(seed, v.x, v.z);
      const prevY = v.y;
      updateVertical(v, surf.y + ZEN.rideHeight, slope, dt, !surf.onSurface);
      expect(Number.isFinite(v.y)).toBe(true);
      const along = (v.x - tun.x) * tx + (v.z - tun.z) * tz;
      const perp = -(v.x - tun.x) * tz + (v.z - tun.z) * tx;
      const r = Math.hypot(along, perp);
      wholeMaxStep = Math.max(wholeMaxStep, Math.abs(v.y - prevY));
      if (Math.abs(perp) < hw - 2) crossedTube = true; // it actually drove through the tube
      if (r < flatR - 5) {
        // THE SEAM ZONE: tube + flat basin, all at the deep floor — the handoff must be seamless here.
        enteredBasin = true;
        if (lastOn !== null && lastOn !== surf.onSurface) seamToggles++;
        lastOn = surf.onSurface;
        seamMaxStep = Math.max(seamMaxStep, Math.abs(v.y - prevY));
      }
    }
    expect(crossedTube, 'drove through the tube').toBe(true);
    expect(enteredBasin, 'drove through the deep-flat seam zone').toBe(true);
    expect(seamToggles, 'onSurface NEVER flickers to terrain across the tube↔basin seam').toBe(0);
    expect(seamMaxStep, 'the seam is dead-flat — no pop').toBeLessThan(0.2);
    expect(wholeMaxStep, 'and the whole pass (incl. the room-rim descent) stays under the canary bound').toBeLessThan(0.6);
  });

  it('(2)+(3) DRIVING DOWN off-centre still works with the basin present (no tube regression)', () => {
    // The existing #154 canary path, re-run with the flag ON: descend the tube off-centre within the
    // corridor — must stay glued (the basin alongside doesn't disturb the in-tube descent).
    for (const offset of [0, 12, 20, 28]) {
      const dt = 1 / 60;
      const ax = tx, az = tz;
      const v = createZenVehicle();
      v.x = tun.x - ax * (halfL + 30) + -az * offset;
      v.z = tun.z - az * (halfL + 30) + ax * offset;
      v.heading = Math.PI - tun.rotationY;
      v.y = heightAt(seed, v.x, v.z) + ZEN.rideHeight;
      v.speed = 80;
      let toggles = 0, maxStep = 0, lastOn: boolean | null = null, descended = false;
      for (let f = 0; f < 560; f++) {
        const slope = surfaceSlopeAlong(seed, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
        updateZen(v, 0, 1, dt, v.airborne ? 0 : slope);
        const surf = queryDrivableSurface(seed, v.x, v.z);
        const prevY = v.y;
        updateVertical(v, surf.y + ZEN.rideHeight, slope, dt, !surf.onSurface);
        const al = (v.x - tun.x) * ax + (v.z - tun.z) * az;
        if (Math.abs(al) < halfL - 3) {
          maxStep = Math.max(maxStep, Math.abs(v.y - prevY));
          if (lastOn !== null && lastOn !== surf.onSurface) toggles++;
          lastOn = surf.onSurface;
          if (v.y < -2) descended = true;
        }
      }
      expect(descended, `offset ${offset} descended`).toBe(true);
      expect(toggles, `offset ${offset} → no pop with the basin present`).toBe(0);
      expect(maxStep, `offset ${offset} → smooth`).toBeLessThan(0.6);
    }
  });

  it('(4) UNIFIED MESH: the followed basin Y == the shared tunnelBasinDepthFactor formula', () => {
    // The basin floor mesh (Stage C) MUST build from this same function — assert the surface uses it,
    // so mesh == followed surface (the #149 unified-floor rule extended to the new floor).
    for (const [along, perp] of [[0, hw + 30], [120, hw + 60], [0, flatR - 10], [-80, hw + 5]]) {
      const p = at(along, perp);
      const surf = queryDrivableSurface(seed, p.x, p.z);
      const r = Math.hypot(along, perp);
      const expected = centreGround - ZEN_LANDMARK.tunnelDepth * tun.scale * tunnelBasinDepthFactor(r, tun.scale);
      expect(surf.onSurface).toBe(true);
      expect(surf.y).toBeCloseTo(expected, 4); // exactly the (shared) mesh formula
    }
  });

  it('(corridor) the #154 invariant still holds (hw − bendAmp ≥ 25), and the basin sits in the deep core', () => {
    expect(ZEN_LANDMARK.tunnelHalfWidth - ZEN_LANDMARK.tunnelBendAmplitude).toBeGreaterThanOrEqual(25);
    // The seam-rule guarantee: the whole basin is inside the tube's deep core (rim < easeStart·halfL),
    // so it only ever abuts the tube where the tube is at full depth → the wall seam is Y-equal.
    expect(ZEN_DRIVEDOWN.basinRimRadius).toBeLessThan(ZEN_LANDMARK.tunnelDepthEaseStart * ZEN_LANDMARK.tunnelLength * 0.5);
  });
});
