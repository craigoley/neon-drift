/**
 * Zen TUNNEL floor — the car rides SMOOTHLY on the road it SEES (regression for diagnosis #148: the
 * car bumped up/down between the tunnel floor and normal ground throughout). Two root causes, both
 * guarded here:
 *   (1) the followed drivable surface + the visible floor mesh are now ONE definition (centre-anchored,
 *       flat across the channel — tunnelDepthFactor), so the car sits exactly on the cyan road;
 *   (2) the tube is wide enough to contain its own curve (hw ≥ bendAmplitude), so a straight path's
 *       lateral offset never reaches the wall → the override never drops to null → no pop to terrain.
 * The FEEL is a phone playtest; "the Y is smooth + on the road" is what's unit-testable.
 */
import { describe, expect, it } from 'vitest';
import { landmarksInRadius, tunnelBendShape, tunnelDepthFactor, LANDMARK_TUNNEL } from '../ZenLandmarkModel';
import { queryDrivableSurface, surfaceSlopeAlong } from '../ZenLandmarkSurface';
import { createZenVehicle, updateZen, updateVertical } from '../ZenVehicle';
import { heightAt } from '../ZenHeight';
import { ZEN, ZEN_LANDMARK } from '../../utils/constants';

const seed = ZEN.worldSeed;
const tun = landmarksInRadius(seed, 0, 0, 40000)
  .filter((l) => l.type === LANDMARK_TUNNEL)
  .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
const tx = Math.sin(tun.rotationY);
const tz = Math.cos(tun.rotationY);
const halfL = (ZEN_LANDMARK.tunnelLength * tun.scale) * 0.5;
const hw = ZEN_LANDMARK.tunnelHalfWidth * tun.scale;
const centreGround = heightAt(seed, tun.x, tun.z);
/** World point at axial `along` + lateral `perp` from the tunnel centre. */
const at = (along: number, perp: number) => ({ x: tun.x + along * tx - perp * tz, z: tun.z + along * tz + perp * tx });
const bendOff = (along: number) => ZEN_LANDMARK.tunnelBendAmplitude * tun.scale * tunnelBendShape(along / halfL);

describe('Zen tunnel — followed surface == the visible floor (ONE definition)', () => {
  it('the tube is wide enough to contain its own curve (hw ≥ bendAmplitude)', () => {
    // The whole fix hinges on this: a straight path sits at lat up to bendAmplitude from the curved
    // centre; if hw < bendAmplitude the override drops to null mid-tunnel → the pop to terrain.
    expect(ZEN_LANDMARK.tunnelHalfWidth).toBeGreaterThanOrEqual(ZEN_LANDMARK.tunnelBendAmplitude);
  });

  it('the followed floor-Y equals the shared centre-anchored profile (the rendered mesh)', () => {
    for (const f of [-0.8, -0.5, -0.2, 0, 0.2, 0.5, 0.8]) {
      const along = f * halfL;
      const p = at(along, bendOff(along)); // on the curved centreline
      const surf = queryDrivableSurface(seed, p.x, p.z);
      const expected = centreGround - ZEN_LANDMARK.tunnelDepth * tun.scale * tunnelDepthFactor(along / halfL);
      expect(surf.onSurface).toBe(true);
      expect(surf.y).toBeCloseTo(expected, 4); // exactly the mesh's world floor Y
    }
  });

  it('the floor is FLAT across the channel — lateral-independent (no bob off-centre)', () => {
    for (const f of [-0.4, 0, 0.4]) {
      const along = f * halfL;
      const c = bendOff(along);
      // Three lateral offsets within the tube → identical floor Y (the old latF taper made these differ).
      const ys = [0, hw * 0.4, -hw * 0.4].map((off) => {
        const p = at(along, c + off);
        return queryDrivableSurface(seed, p.x, p.z);
      });
      expect(ys.every((s) => s.onSurface)).toBe(true);
      expect(ys[1].y).toBeCloseTo(ys[0].y, 6);
      expect(ys[2].y).toBeCloseTo(ys[0].y, 6);
    }
  });
});

describe('Zen tunnel — driving straight through is SMOOTH (no bump, no pop to terrain)', () => {
  it('lat never reaches hw, onSurface never toggles, and per-frame ΔY stays tiny', () => {
    const dt = 1 / 60;
    const ax = tx;
    const az = tz;
    const v = createZenVehicle();
    v.x = tun.x - ax * (halfL + 40);
    v.z = tun.z - az * (halfL + 40);
    v.heading = Math.PI - tun.rotationY; // drive along +through-axis
    v.y = heightAt(seed, v.x, v.z) + ZEN.rideHeight;
    v.speed = 60;

    let maxStep = 0;
    let toggles = 0;
    let lastOn: boolean | null = null;
    let maxLat = 0;
    let descended = false;
    for (let f = 0; f < 260; f++) {
      const slope = surfaceSlopeAlong(seed, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
      updateZen(v, 0, 1, dt, v.airborne ? 0 : slope);
      const surf = queryDrivableSurface(seed, v.x, v.z);
      const prevY = v.y;
      updateVertical(v, surf.y + ZEN.rideHeight, slope, dt, !surf.onSurface);
      expect(Number.isFinite(v.y)).toBe(true);
      const along = (v.x - tun.x) * ax + (v.z - tun.z) * az;
      const inside = Math.abs(along) < halfL - 5;
      if (inside) {
        const perp = -(v.x - tun.x) * az + (v.z - tun.z) * ax;
        maxLat = Math.max(maxLat, Math.abs(perp - bendOff(along)));
        maxStep = Math.max(maxStep, Math.abs(v.y - prevY));
        if (lastOn !== null && lastOn !== surf.onSurface) toggles++;
        lastOn = surf.onSurface;
        if (v.y < -2) descended = true;
      }
    }
    expect(descended, 'the car actually drove down into the tunnel').toBe(true);
    expect(maxLat, 'a straight path never reaches the wall (no null-flip to terrain)').toBeLessThan(hw);
    expect(toggles, 'onSurface never toggles mid-tunnel (no pop between floor and ground)').toBe(0);
    // The old bug measured ≈1.90 u/frame (≈114 u/s). The remaining motion is the smooth descent grade.
    expect(maxStep, 'per-frame ΔY stays tiny — smooth, not a bump').toBeLessThan(0.5);
  });
});
