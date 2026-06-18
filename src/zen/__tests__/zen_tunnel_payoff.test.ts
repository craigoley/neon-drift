/**
 * Zen TUNNEL BOTTOM-PAYOFF (Stage 4 slice) — the PURE trigger + round-trip logic. Descending a tunnel
 * to its DEEP POINT warps to a distinct tunnel space; a return portal brings you back NEAR THE
 * ENTRANCE. The fade/teleport/palette orchestration lives in ZenSession over a WebGL renderer (not
 * headless-testable, like the secret-area warp); these assert the testable core:
 *   - coveringTunnel detects "in a tunnel" + the signed along-position (deep point = 0),
 *   - passedDeepPoint is the once-per-descent "bottomed out" edge,
 *   - the payoff region is a real, deterministic, DISTINCT-from-the-secret-area portal,
 *   - the palette is distinct from the gateway secret area,
 *   - entrance save → warp away → restore = back near the ENTRANCE (not the deep point).
 * The drivable surface (ZenLandmarkSurface) is UNTOUCHED — these only read placement/bend.
 */
import { describe, expect, it } from 'vitest';
import { coveringTunnel, passedDeepPoint, tunnelReturnPortal } from '../ZenTunnelPayoff';
import { snapshot, arrivalPose, findReturnPortal } from '../ZenSecret';
import { landmarksInRadius, LANDMARK_TUNNEL, LANDMARK_GATEWAY } from '../ZenLandmarkModel';
import { createZenVehicle } from '../ZenVehicle';
import { wrapToPi } from '../../utils/math';
import { ZEN, ZEN_LANDMARK, ZEN_SECRET_BIOME, ZEN_TUNNEL_SECRET_BIOME } from '../../utils/constants';

const SEED = ZEN.worldSeed;
const tunnel = landmarksInRadius(SEED, 0, 0, 40000)
  .filter((l) => l.type === LANDMARK_TUNNEL)
  .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
const tx = Math.sin(tunnel.rotationY);
const tz = Math.cos(tunnel.rotationY);
const halfL = ZEN_LANDMARK.tunnelLength * tunnel.scale * 0.5;
/** A world point at axial `along` (and optional lateral `perp`) from the tunnel centre. */
const at = (along: number, perp = 0) => ({ x: tunnel.x + along * tx - perp * tz, z: tunnel.z + along * tz + perp * tx });

describe('Zen tunnel payoff — coveringTunnel detects the tube + the signed along-position', () => {
  it('reports the covering tunnel at the deep centre, with along ~ 0 (the deep point)', () => {
    const c = coveringTunnel(SEED, tunnel.x, tunnel.z);
    expect(c).not.toBeNull();
    expect(c!.tunnel.id).toBe(tunnel.id);
    expect(Math.abs(c!.along)).toBeLessThan(halfL * 0.05); // centre → near the deep point
    expect(c!.halfL).toBeCloseTo(halfL, 3);
  });

  it('reports OPPOSITE along signs at the two mouths (you descend from + to − through 0)', () => {
    const a = coveringTunnel(SEED, at(halfL * 0.8).x, at(halfL * 0.8).z);
    const b = coveringTunnel(SEED, at(-halfL * 0.8).x, at(-halfL * 0.8).z);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(Math.sign(a!.along)).toBe(1);
    expect(Math.sign(b!.along)).toBe(-1);
  });

  it('returns null outside any tunnel (you are not in the tube)', () => {
    expect(coveringTunnel(SEED, tunnel.x + 50000, tunnel.z + 50000)).toBeNull();
    expect(coveringTunnel(SEED, at(halfL + 80).x, at(halfL + 80).z)).toBeNull(); // past the mouth
  });
});

describe('Zen tunnel payoff — passedDeepPoint is the once-per-descent "bottomed out" edge', () => {
  it('fires only on a sign flip of along (crossing the deep point), never on entry or same-side motion', () => {
    expect(passedDeepPoint(null, 0.5)).toBe(false); // wasn't in a tunnel last frame
    expect(passedDeepPoint(20, 10)).toBe(false); // descending, not yet at the bottom
    expect(passedDeepPoint(5, -3)).toBe(true); // crossed 0 (+ → −) → bottomed out
    expect(passedDeepPoint(-5, 4)).toBe(true); // crossed 0 the other way too
    expect(passedDeepPoint(-8, -2)).toBe(false); // still on the same side
    expect(passedDeepPoint(3, 0)).toBe(true); // landing exactly on the deep point counts
  });
});

describe('Zen tunnel payoff — driving through fires the deep-point trigger EXACTLY ONCE', () => {
  // Sweep the car straight along the axis from outside one mouth to outside the other (the line a
  // player drives), at centre AND at an off-centre offset, sampling the pure detector each step.
  function sweep(offset: number) {
    let prevAlong: number | null = null;
    let crossings = 0;
    let firstInTubeAlong: number | null = null;
    let everInside = false;
    for (let s = -(halfL + 60); s <= halfL + 60; s += 4) {
      const p = at(s, offset);
      const cover = coveringTunnel(SEED, p.x, p.z);
      if (cover) {
        everInside = true;
        if (firstInTubeAlong === null) firstInTubeAlong = cover.along;
        if (passedDeepPoint(prevAlong, cover.along)) crossings++;
        prevAlong = cover.along;
      } else {
        prevAlong = null;
      }
    }
    return { crossings, firstInTubeAlong, everInside };
  }

  for (const offset of [0, 12, 20]) {
    it(`offset ${offset}u: enters the tube and crosses the deep point exactly once`, () => {
      const r = sweep(offset);
      expect(r.everInside).toBe(true);
      expect(r.crossings).toBe(1); // one payoff per descent (the session also debounces by tunnel id)
      // The ENTRANCE (first frame in the tube) is near a mouth — FAR from the deep point (along ~ 0),
      // so "return near the entrance" is a meaningfully different place from where the trigger fired.
      expect(Math.abs(r.firstInTubeAlong!)).toBeGreaterThan(halfL * 0.9);
    });
  }
});

describe('Zen tunnel payoff — the payoff region is a real, deterministic, DISTINCT place', () => {
  it('tunnelReturnPortal is a deterministic GATEWAY, far out, and different from the secret-area portal', () => {
    const a = tunnelReturnPortal(SEED);
    const b = tunnelReturnPortal(SEED);
    expect(a.type).toBe(LANDMARK_GATEWAY);
    expect(b.id).toBe(a.id); // deterministic — the same place every time
    expect(Math.hypot(a.x, a.z)).toBeGreaterThan(100000); // a place apart, reached only by warp
    // DISTINCT from the gateway secret area's portal (Craig's call: its own region, not the same space).
    const secret = findReturnPortal(SEED);
    expect(a.id).not.toBe(secret.id);
    expect(Math.hypot(a.x - secret.x, a.z - secret.z)).toBeGreaterThan(100000);
  });

  it('forces a DISTINCT palette from the gateway secret area (a different-looking hidden space)', () => {
    expect(ZEN_TUNNEL_SECRET_BIOME.id).not.toBe(ZEN_SECRET_BIOME.id);
    expect(ZEN_TUNNEL_SECRET_BIOME.fog).not.toBe(ZEN_SECRET_BIOME.fog);
    expect(ZEN_TUNNEL_SECRET_BIOME.accent).not.toBe(ZEN_SECRET_BIOME.accent);
    expect(ZEN_TUNNEL_SECRET_BIOME.gridLine).not.toBe(ZEN_SECRET_BIOME.gridLine);
  });
});

describe('Zen tunnel payoff — EXIT warps back to the tunnel ENTRANCE, FACING OUT (the loop closes)', () => {
  it('returns to the entrance position with the heading REVERSED (pointed out of the tunnel)', () => {
    // The car enters near the + mouth heading INWARD (forward = −axis, toward the deep centre), descends,
    // and the ENTRANCE is recorded there (the return target). Forward = (sin h, −cos h).
    const v = createZenVehicle();
    const entrancePt = at(halfL * 0.95); // near the mouth — where the entrance is recorded
    v.x = entrancePt.x; v.z = entrancePt.z;
    v.heading = -tunnel.rotationY; // forward = (−tx, −tz) = INWARD (toward the deep centre)
    v.speed = 70;
    const entrance = snapshot(v); // saved at entry (the return target)
    const inwardFwd = { x: Math.sin(entrance.heading), z: -Math.cos(entrance.heading) };
    expect(inwardFwd.x * tx + inwardFwd.z * tz).toBeLessThan(0); // sanity: entered heading inward

    // ENTER: at the deep-point trigger, warp to the segregated tunnel region in front of its portal.
    const pose = arrivalPose(tunnelReturnPortal(SEED));
    v.x = pose.x; v.z = pose.z; v.heading = pose.heading; v.speed = 0;
    expect(Math.hypot(v.x - entrance.x, v.z - entrance.z)).toBeGreaterThan(100000); // really teleported

    // EXIT (the new hybrid close): warp to the ENTRANCE position, heading REVERSED → facing OUT.
    v.x = entrance.x; v.z = entrance.z;
    v.heading = wrapToPi(entrance.heading + Math.PI);
    v.speed = 0; v.vy = 0; v.airborne = false;

    // Back AT the entrance (near the mouth, far from the deep point)…
    expect(v.x).toBe(entrance.x);
    expect(v.z).toBe(entrance.z);
    const backAlong = (v.x - tunnel.x) * tx + (v.z - tunnel.z) * tz;
    expect(Math.abs(backAlong)).toBeGreaterThan(halfL * 0.9);
    // …and FACING OUT: the exit forward vector points AWAY from the deep centre (out of the + mouth),
    // i.e. the exact reverse of the inward entry heading.
    const outFwd = { x: Math.sin(v.heading), z: -Math.cos(v.heading) };
    expect(outFwd.x * tx + outFwd.z * tz).toBeGreaterThan(0.999); // points out along +axis (the mouth)
    expect(outFwd.x * inwardFwd.x + outFwd.z * inwardFwd.z).toBeLessThan(-0.999); // opposite of entry
  });
});
