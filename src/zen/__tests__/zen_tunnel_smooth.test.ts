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

describe('Zen tunnel — DEEPER + LONGER dial (playtest), fixes preserved', () => {
  it('the tunnel is substantially LONGER and DEEPER (guards against the dial being reverted)', () => {
    expect(ZEN_LANDMARK.tunnelLength).toBeGreaterThanOrEqual(2400); // raised 1800→2600
    expect(ZEN_LANDMARK.tunnelDepth).toBeGreaterThanOrEqual(36); // raised 28→40
  });

  it('the #154 corridor invariant STILL holds at the new length/depth (hw − bendAmp ≥ 25)', () => {
    expect(ZEN_LANDMARK.tunnelHalfWidth - ZEN_LANDMARK.tunnelBendAmplitude).toBeGreaterThanOrEqual(25);
  });

  it('DEEPER paired WITH longer keeps the descent a GENTLE ramp, not a cliff (grade stays ~6%)', () => {
    // Grade = deepest drop / descent-ramp length. The ramp is the outer (1 − tunnelDepthEaseStart)
    // fraction of each half; both depth and length scale by lm.scale, so the grade is scale-invariant.
    const rampLen = halfL * (1 - ZEN_LANDMARK.tunnelDepthEaseStart);
    const drop = ZEN_LANDMARK.tunnelDepth * tun.scale;
    const grade = drop / rampLen;
    expect(grade, 'deeper + longer → still a gentle ramp').toBeLessThan(0.09);
  });

  it('surfaceQueryRadius reaches the far mouth at max scale (the override resolves over the longer tube)', () => {
    const farMouthReach = ZEN_LANDMARK.tunnelLength * ZEN_LANDMARK.scaleMax * 0.5;
    expect(ZEN_LANDMARK.surfaceQueryRadius).toBeGreaterThanOrEqual(farMouthReach);
  });

  it('edgeMargin keeps a VALID central placement band (< cellSize/2) at the new length', () => {
    expect(ZEN_LANDMARK.edgeMargin).toBeLessThan(ZEN_LANDMARK.cellSize / 2);
  });
});

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

/** Drive a tunnel from outside one mouth at a fixed lateral OFFSET from the axis (steer 0), the line a
 *  real player drives. Returns the mid-tunnel onSurface-toggle count + worst per-frame ΔY. */
function driveOffset(t: typeof tun, offset: number): { toggles: number; maxStep: number; descended: boolean } {
  const dt = 1 / 60;
  const ax = Math.sin(t.rotationY);
  const az = Math.cos(t.rotationY);
  const hL = (ZEN_LANDMARK.tunnelLength * t.scale) * 0.5;
  const v = createZenVehicle();
  v.x = t.x - ax * (hL + 30) + -az * offset; // start offset along the perpendicular
  v.z = t.z - az * (hL + 30) + ax * offset;
  v.heading = Math.PI - t.rotationY;
  v.y = heightAt(seed, v.x, v.z) + ZEN.rideHeight;
  v.speed = 80;
  let toggles = 0;
  let maxStep = 0;
  let descended = false;
  let lastOn: boolean | null = null;
  for (let f = 0; f < 560; f++) {
    const slope = surfaceSlopeAlong(seed, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
    updateZen(v, 0, 1, dt, v.airborne ? 0 : slope);
    const surf = queryDrivableSurface(seed, v.x, v.z);
    const prevY = v.y;
    updateVertical(v, surf.y + ZEN.rideHeight, slope, dt, !surf.onSurface);
    expect(Number.isFinite(v.y)).toBe(true);
    const al = (v.x - t.x) * ax + (v.z - t.z) * az;
    if (Math.abs(al) < hL - 3) {
      maxStep = Math.max(maxStep, Math.abs(v.y - prevY));
      if (lastOn !== null && lastOn !== surf.onSurface) toggles++;
      lastOn = surf.onSurface;
      if (v.y < -2) descended = true;
    }
  }
  return { toggles, maxStep, descended };
}

describe('Zen tunnel — driving OFF-CENTRE is SMOOTH (the line a player actually drives — #153 regression)', () => {
  // The ORIGINAL guard drove only the centred axis (perp ≈ 0), where lat = |bendOff| ≤ bendAmp < hw —
  // a case that can NEVER pop, so it passed while the off-centre bump was live (#153). The real test
  // sweeps lateral offsets across the straight-driving CORRIDOR, on the nearest AND the largest tunnel.
  const corridor = ZEN_LANDMARK.tunnelHalfWidth - ZEN_LANDMARK.tunnelBendAmplitude; // pre-scale
  const biggest = landmarksInRadius(seed, 0, 0, 60000)
    .filter((l) => l.type === LANDMARK_TUNNEL)
    .sort((a, b) => b.scale - a.scale)[0];

  it('the straight-driving corridor (hw − bendAmplitude) is a REAL width, not the thin 8u of #149', () => {
    expect(corridor).toBeGreaterThanOrEqual(25);
  });

  for (const offset of [0, 12, 20, 28]) {
    it(`nearest tunnel, offset ${offset}u: no pop (onSurface never toggles, ΔY tiny)`, () => {
      const r = driveOffset(tun, offset);
      expect(r.descended).toBe(true);
      expect(r.toggles, `offset ${offset} → no floor↔surface pop`).toBe(0);
      expect(r.maxStep, `offset ${offset} → smooth`).toBeLessThan(0.6);
    });
  }

  for (const offset of [0, 20, 30]) {
    it(`LARGEST tunnel (scale ${biggest.scale.toFixed(2)}), offset ${offset}u: no pop`, () => {
      const r = driveOffset(biggest, offset);
      expect(r.toggles, `scaleMax offset ${offset} → no pop`).toBe(0);
      expect(r.maxStep).toBeLessThan(0.6);
    });
  }
});

describe('Zen tunnel — path-relative membership: in iff TRUE perpendicular distance ≤ halfWidth', () => {
  // Place the car at a known PERPENDICULAR distance d from the curved centreline (along its local
  // normal), at several axial positions incl. the bend peak, and assert membership is |d| ≤ hw — the
  // true distance, not the axis-relative gap (#153). Robust to curve steepness (curvature-invariant).
  const bendSlope = (along: number) => {
    const e = halfL * 1e-3;
    return (ZEN_LANDMARK.tunnelBendAmplitude * tun.scale * (tunnelBendShape((along + e) / halfL) - tunnelBendShape((along - e) / halfL))) / (2 * e);
  };
  /** World point at perpendicular distance d from the centreline at axial `along`. */
  const atPerpDist = (along: number, d: number) => {
    const m = bendSlope(along);
    const inv = 1 / Math.sqrt(1 + m * m);
    // local normal (in along,perp) = (−m, 1)·inv; offset the centreline point C=(along, bendOff) by d·normal.
    const aLocal = along + d * (-m) * inv;
    const pLocal = ZEN_LANDMARK.tunnelBendAmplitude * tun.scale * tunnelBendShape(along / halfL) + d * inv;
    return { x: tun.x + aLocal * tx - pLocal * tz, z: tun.z + aLocal * tz + pLocal * tx };
  };
  for (const f of [-0.5, -0.2, 0.3, 0.5]) {
    it(`at along=${f}·halfL: |d| just inside hw is ON the floor, just outside is OFF`, () => {
      const along = f * halfL;
      const inside = atPerpDist(along, hw * 0.9);
      const outside = atPerpDist(along, hw * 1.1);
      expect(queryDrivableSurface(seed, inside.x, inside.z).onSurface, `d=0.9·hw → in`).toBe(true);
      expect(queryDrivableSurface(seed, outside.x, outside.z).onSurface, `d=1.1·hw → out`).toBe(false);
    });
  }
});
