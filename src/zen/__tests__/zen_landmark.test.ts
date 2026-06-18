/**
 * Zen LANDMARKS — the rare neon beacons you spot from afar + journey to. The FEEL is a phone
 * playtest, but the SYSTEM is unit-testable: placement is DETERMINISTIC + RARE (rarer than
 * ramps — a beacon, not litter), gated to reachable GENTLE terrain (sits on heightAt); each
 * type's SOLID parts are correct (arch/gateway opening clear + pillars solid, ring/vista/tunnel
 * pass-through); VISTA raises + TUNNEL lowers the drivable surface; reach detection fires within
 * radius; and every landmark is marked on the minimap (kind: 'landmark') via the #124 pipeline.
 */
import { describe, expect, it } from 'vitest';
import {
  landmarkForCell,
  landmarksInRadius,
  eachSolidCircle,
  isReached,
  reachRadius,
  isDriveThrough,
  reachDuration,
  reachEnvelope,
  crossedOpening,
  signedThroughDistance,
  openingRadius,
  isSurfaceType,
  tunnelBendShape,
  LANDMARK_RING,
  LANDMARK_ARCH,
  LANDMARK_GATEWAY,
  LANDMARK_VISTA,
  LANDMARK_TUNNEL,
  LANDMARK_TYPE_COUNT,
  type Landmark,
  type LandmarkType,
} from '../ZenLandmarkModel';
import { drivableSurfaceY, onLandmarkSurface, inEnclosedTunnel } from '../ZenLandmarkSurface';
import { createZenVehicle, updateVertical } from '../ZenVehicle';
import { rampCenterForCell, maskAt, heightAt } from '../ZenHeight';
import { deflectPoint } from '../ZenWorld';
import { gatherMarkers } from '../ZenMinimapModel';
import { ZEN, ZEN_LANDMARK, ZEN_DRIVEDOWN } from '../../utils/constants';

/** Run `fn` with the drive-down basin OFF (the WARP-fallback symmetric tunnel: both mouths ease to
 *  terrain). The far mouth's "resurface" + "back to terrain at the mouth" are fallback behaviours now
 *  that the drive-down DEFAULT holds the far half deep + covers the terminus with the basin. */
function withSymmetricTunnel(fn: () => void): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prev = (ZEN_DRIVEDOWN as any).enabled;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ZEN_DRIVEDOWN as any).enabled = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  try { fn(); } finally { (ZEN_DRIVEDOWN as any).enabled = prev; }
}

const SEED = ZEN.worldSeed;

/** Collect all landmarks over a square span of cells (for counting / variety checks). */
function allLandmarks(cellsPerSide: number): Landmark[] {
  const out: Landmark[] = [];
  for (let cz = 0; cz < cellsPerSide; cz++) {
    for (let cx = 0; cx < cellsPerSide; cx++) {
      const lm = landmarkForCell(SEED, cx, cz);
      if (lm) out.push(lm);
    }
  }
  return out;
}

describe('Zen landmarks — placement is deterministic, rare, and on reachable terrain', () => {
  it('is deterministic per seed (same cell → same landmark or same null)', () => {
    for (let i = 0; i < 200; i++) {
      const cx = (i * 7) % 50;
      const cz = (i * 13) % 50;
      const a = landmarkForCell(SEED, cx, cz);
      const b = landmarkForCell(SEED, cx, cz);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  it('depends on the seed (a different seed shifts the landmark field)', () => {
    // Compare the whole field over a region across two seeds — it must not be identical.
    let differs = false;
    for (let cz = 0; cz < 40 && !differs; cz++) {
      for (let cx = 0; cx < 40 && !differs; cx++) {
        if (JSON.stringify(landmarkForCell(SEED, cx, cz)) !== JSON.stringify(landmarkForCell(SEED + 999, cx, cz))) {
          differs = true;
        }
      }
    }
    expect(differs).toBe(true);
  });

  it('is RARER than ramps — a beacon you journey to, not litter', () => {
    const span = 50000;
    const lmCells = Math.floor(span / ZEN_LANDMARK.cellSize);
    let landmarks = 0;
    for (let cz = 0; cz < lmCells; cz++) for (let cx = 0; cx < lmCells; cx++) if (landmarkForCell(SEED, cx, cz)) landmarks++;
    const rampCells = Math.floor(span / ZEN.rampCellSize);
    let ramps = 0;
    for (let cz = 0; cz < rampCells; cz++) for (let cx = 0; cx < rampCells; cx++) if (rampCenterForCell(SEED, cx, cz)) ramps++;
    expect(landmarks).toBeGreaterThan(0); // they DO exist
    expect(landmarks).toBeLessThan(ramps * 0.2); // but far rarer than ramps
  });

  it('sits on GENTLE, reachable terrain (mask gated) so you can drive to/through it', () => {
    for (const lm of allLandmarks(40)) {
      expect(maskAt(SEED, lm.x, lm.z)).toBeLessThanOrEqual(ZEN_LANDMARK.maxMask);
    }
  });

  it('uses ALL FIVE types (no monolith), each with a valid type/scale/rotation', () => {
    const seen = new Set<number>();
    for (const lm of allLandmarks(80)) {
      seen.add(lm.type);
      expect(lm.type).toBeGreaterThanOrEqual(0);
      expect(lm.type).toBeLessThan(LANDMARK_TYPE_COUNT);
      expect(lm.scale).toBeGreaterThanOrEqual(ZEN_LANDMARK.scaleMin);
      expect(lm.scale).toBeLessThanOrEqual(ZEN_LANDMARK.scaleMax);
      expect(lm.rotationY).toBeGreaterThanOrEqual(0);
      expect(lm.rotationY).toBeLessThanOrEqual(Math.PI * 2);
    }
    expect(LANDMARK_TYPE_COUNT).toBe(5); // monolith removed → ring, arch, gateway, vista, tunnel
    expect(seen.size).toBe(LANDMARK_TYPE_COUNT); // every type is placed
    // The new types are all present; the old monolith id (1, now ARCH) is never a "monolith".
    expect(seen.has(LANDMARK_GATEWAY)).toBe(true);
    expect(seen.has(LANDMARK_VISTA)).toBe(true);
    expect(seen.has(LANDMARK_TUNNEL)).toBe(true);
  });

  it('VISTA is the rarest destination; TUNNEL was bumped to ~ the common types (findability)', () => {
    // typeWeights [3,3,2,1,3]: ring/arch/tunnel = 3 (common), gateway = 2, vista = 1 (rarest).
    // Tunnel was raised 1→3 (diagnosed unfindable from pure spatial rarity) so it's now as common
    // as the drive-throughs; vista remains the rare "destination".
    const counts = [0, 0, 0, 0, 0];
    for (const lm of allLandmarks(80)) counts[lm.type]++;
    expect(counts[LANDMARK_VISTA]).toBeGreaterThan(0); // no type vanishes
    expect(counts[LANDMARK_TUNNEL]).toBeGreaterThan(0);
    // Vista (weight 1) is rarer than every weight-≥2 type, including the bumped tunnel.
    expect(counts[LANDMARK_VISTA]).toBeLessThan(counts[LANDMARK_RING]);
    expect(counts[LANDMARK_VISTA]).toBeLessThan(counts[LANDMARK_TUNNEL]);
    // Tunnel now sits with the common drive-throughs (within ~25% of ring's count, not a rare 1/10).
    expect(counts[LANDMARK_TUNNEL]).toBeGreaterThan(counts[LANDMARK_RING] * 0.75);
  });
});

describe('Zen landmarks — landmarksInRadius finds beacons in range, none outside', () => {
  it('returns only landmarks within the radius, and finds the ones that are there', () => {
    const carX = 1500;
    const carZ = -3000;
    const R = ZEN_LANDMARK.drawRadius;
    const found = landmarksInRadius(SEED, carX, carZ, R);
    for (const lm of found) {
      expect(Math.hypot(lm.x - carX, lm.z - carZ)).toBeLessThanOrEqual(R + 1e-6);
    }
    // Brute-force the overlapping cells; every in-radius landmark must be returned.
    const cs = ZEN_LANDMARK.cellSize;
    const ids = new Set(found.map((l) => l.id));
    for (let cz = Math.floor((carZ - R) / cs); cz <= Math.floor((carZ + R) / cs); cz++) {
      for (let cx = Math.floor((carX - R) / cs); cx <= Math.floor((carX + R) / cs); cx++) {
        const lm = landmarkForCell(SEED, cx, cz);
        if (lm && Math.hypot(lm.x - carX, lm.z - carZ) <= R) expect(ids.has(lm.id)).toBe(true);
      }
    }
  });
});

describe('Zen landmarks — solid parts: drive-through opening clear, solid parts deflect', () => {
  /** A representative landmark of each type (search the field). */
  function findType(type: number): Landmark {
    for (let cz = 0; cz < 80; cz++) for (let cx = 0; cx < 80; cx++) {
      const lm = landmarkForCell(SEED, cx, cz);
      if (lm && lm.type === type) return lm;
    }
    throw new Error(`no landmark of type ${type} found`);
  }

  /** Resolve a point against a landmark's solid circles (mirrors ZenLandmarks.resolve). */
  function resolve(lm: Landmark, x: number, z: number): { x: number; z: number } {
    let rx = x;
    let rz = z;
    eachSolidCircle(lm, (cx, cz, r) => {
      const o = deflectPoint(rx, rz, cx, cz, r);
      rx = o.x;
      rz = o.z;
    });
    return { x: rx, z: rz };
  }

  it('ARCH: the opening (centre) is CLEAR to drive through; the pillars are SOLID', () => {
    const arch = findType(LANDMARK_ARCH);
    let circles = 0;
    eachSolidCircle(arch, () => circles++);
    expect(circles).toBe(2); // two pillars
    // A car at the centre of the opening is NOT pushed (clear to pass through).
    const mid = resolve(arch, arch.x, arch.z);
    expect(mid.x).toBeCloseTo(arch.x, 6);
    expect(mid.z).toBeCloseTo(arch.z, 6);
    // A car ON a pillar IS pushed out to the pillar's edge (solid deflect).
    const lx = Math.cos(arch.rotationY);
    const lz = -Math.sin(arch.rotationY);
    const half = ZEN_LANDMARK.archHalfWidth * arch.scale;
    const pillarX = arch.x + lx * half;
    const pillarZ = arch.z + lz * half;
    const pushed = resolve(arch, pillarX, pillarZ);
    expect(Math.hypot(pushed.x - pillarX, pushed.z - pillarZ)).toBeGreaterThan(0.5);
  });

  it('GATEWAY: like the arch — clear opening, SOLID pillars (the bigger drive-through)', () => {
    const gw = findType(LANDMARK_GATEWAY);
    let circles = 0;
    eachSolidCircle(gw, () => circles++);
    expect(circles).toBe(2);
    const mid = resolve(gw, gw.x, gw.z); // opening centre is clear
    expect(mid.x).toBeCloseTo(gw.x, 6);
    expect(mid.z).toBeCloseTo(gw.z, 6);
    const lx = Math.cos(gw.rotationY);
    const lz = -Math.sin(gw.rotationY);
    const half = ZEN_LANDMARK.gatewayHalfWidth * gw.scale;
    const pushed = resolve(gw, gw.x + lx * half, gw.z + lz * half); // on a pillar → deflected
    expect(Math.hypot(pushed.x - (gw.x + lx * half), pushed.z - (gw.z + lz * half))).toBeGreaterThan(0.5);
  });

  it('VISTA + TUNNEL have NO solid circles (you drive onto / through their surface)', () => {
    for (const type of [LANDMARK_VISTA, LANDMARK_TUNNEL] as LandmarkType[]) {
      const lm = findType(type);
      let circles = 0;
      eachSolidCircle(lm, () => circles++);
      expect(circles).toBe(0);
      expect(isSurfaceType(type)).toBe(true);
    }
  });

  it('RING: PASS-THROUGH — no solid parts, the car glides straight through', () => {
    const ring = findType(LANDMARK_RING);
    let circles = 0;
    eachSolidCircle(ring, () => circles++);
    expect(circles).toBe(0);
    const mid = resolve(ring, ring.x, ring.z);
    expect(mid.x).toBe(ring.x);
    expect(mid.z).toBe(ring.z);
  });
});

describe('Zen landmarks — reach detection (the gentle moment trigger)', () => {
  it('isReached fires inside the reach radius and not outside', () => {
    const lm = landmarksInRadius(SEED, 0, 0, 6000)[0];
    expect(lm).toBeDefined();
    const r = reachRadius(lm);
    expect(r).toBeGreaterThan(0);
    expect(isReached(lm, lm.x, lm.z)).toBe(true); // at the centre → reached
    expect(isReached(lm, lm.x + r * 0.5, lm.z)).toBe(true); // inside
    expect(isReached(lm, lm.x + r + 2, lm.z)).toBe(false); // just outside → not reached
  });
});

describe('Zen landmarks — appear on the minimap (kind: landmark)', () => {
  it('gatherMarkers includes the landmarks in range, tagged kind=landmark', () => {
    // Pick a car spot near a known landmark so at least one is in radar range.
    const lm = landmarksInRadius(SEED, 0, 0, 8000)[0];
    expect(lm).toBeDefined();
    const markers = gatherMarkers(SEED, lm.x, lm.z, ZEN_LANDMARK.drawRadius);
    const landmarkMarkers = markers.filter((m) => m.kind === 'landmark');
    expect(landmarkMarkers.length).toBeGreaterThan(0);
    // The landmark at our position is one of them.
    expect(landmarkMarkers.some((m) => Math.hypot(m.x - lm.x, m.z - lm.z) < 1e-6)).toBe(true);
  });
});

describe('Zen landmarks — reward by type: drive-through FRONT-LOADED, arrival = sin ramp', () => {
  const SAMPLE = 0.005; // fine time sampling to locate the envelope peak

  /** The elapsed time (s) at which a type's reach envelope peaks. */
  function peakTime(type: LandmarkType): number {
    let bestT = 0;
    let bestE = -1;
    for (let t = 0; t <= reachDuration(type) + 1e-9; t += SAMPLE) {
      const e = reachEnvelope(type, t);
      if (e > bestE) { bestE = e; bestT = t; }
    }
    return bestT;
  }

  it('classifies types: ring/arch/gateway drive-through; vista/tunnel are arrival surfaces', () => {
    expect(isDriveThrough(LANDMARK_RING)).toBe(true);
    expect(isDriveThrough(LANDMARK_ARCH)).toBe(true);
    expect(isDriveThrough(LANDMARK_GATEWAY)).toBe(true);
    expect(isDriveThrough(LANDMARK_VISTA)).toBe(false);
    expect(isDriveThrough(LANDMARK_TUNNEL)).toBe(false);
  });

  it('DRIVE-THROUGH glow (ring/arch/gateway) is FRONT-LOADED — peaks EARLY, not mid-window', () => {
    const driveThrough: LandmarkType[] = [LANDMARK_RING, LANDMARK_ARCH, LANDMARK_GATEWAY];
    for (const type of driveThrough) {
      const tp = peakTime(type);
      expect(tp).toBeLessThan(0.25); // early flash (≈0.12s), NOT the old 0.80s ramp peak
      expect(reachEnvelope(type, ZEN_LANDMARK.flashRiseSeconds)).toBeGreaterThan(0.95);
      expect(reachEnvelope(type, 0.8)).toBeLessThan(reachEnvelope(type, ZEN_LANDMARK.flashRiseSeconds));
      for (let t = 0; t <= reachDuration(type); t += 0.05) {
        const e = reachEnvelope(type, t);
        expect(e).toBeGreaterThanOrEqual(0);
        expect(e).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('ARRIVAL types (vista/tunnel) use the sin ramp peaking mid-window (~0.8s) — in view on/in them', () => {
    for (const type of [LANDMARK_VISTA, LANDMARK_TUNNEL] as LandmarkType[]) {
      const tp = peakTime(type);
      expect(tp).toBeGreaterThan(0.7);
      expect(tp).toBeLessThan(0.9); // peaks at pulseSeconds/2 = 0.80s
      for (const t of [0, 0.2, 0.4, 0.8, 1.2, 1.6]) {
        expect(reachEnvelope(type, t)).toBeCloseTo(Math.sin(Math.PI * (t / ZEN_LANDMARK.pulseSeconds)), 12);
      }
      expect(reachDuration(type)).toBe(ZEN_LANDMARK.pulseSeconds);
    }
  });

  it('drive-through reach radius is LARGER than the arrival reach (flash fires while ahead)', () => {
    const ring = { id: 1, type: LANDMARK_RING, x: 0, z: 0, rotationY: 0, scale: 1 } as Landmark;
    const vista = { id: 2, type: LANDMARK_VISTA, x: 0, z: 0, rotationY: 0, scale: 1 } as Landmark;
    expect(reachRadius(ring)).toBeGreaterThan(reachRadius(vista));
    expect(reachRadius(ring)).toBeCloseTo(ZEN_LANDMARK.driveThroughReachRadius, 6);
    expect(reachRadius(vista)).toBeCloseTo(ZEN_LANDMARK.reachRadius, 6);
  });
});

describe('Zen landmarks — gate pass-through detection (crossing the opening plane)', () => {
  /** A ring at the origin facing +z (through-axis = +z); opening radius = ringRadius·scale. */
  const ring = (scale = 1, rot = 0): Landmark => ({ id: 9, type: LANDMARK_RING, x: 0, z: 0, rotationY: rot, scale });

  it('the through-axis signed distance flips sign across the opening plane', () => {
    const lm = ring();
    expect(signedThroughDistance(lm, 0, 5)).toBeGreaterThan(0);
    expect(signedThroughDistance(lm, 0, -5)).toBeLessThan(0);
    expect(signedThroughDistance(lm, 0, 0)).toBeCloseTo(0, 9);
  });

  it('FIRES when the car crosses the plane THROUGH the opening', () => {
    const lm = ring();
    expect(crossedOpening(lm, 0, 5, 0, -5)).toBe(true); // straight through the centre
    const r = openingRadius(LANDMARK_RING);
    expect(crossedOpening(lm, r * 0.5, 3, r * 0.5, -3)).toBe(true); // inside the opening, off-centre
  });

  it('does NOT fire when crossing OUTSIDE the opening (brushing past the side)', () => {
    const lm = ring();
    const r = openingRadius(LANDMARK_RING);
    expect(crossedOpening(lm, r + 10, 5, r + 10, -5)).toBe(false); // lateral beyond the opening
  });

  it('does NOT fire without a crossing (same side both frames) — single-pass debounce', () => {
    const lm = ring();
    expect(crossedOpening(lm, 0, 5, 0, 3)).toBe(false); // approached, didn't cross
    expect(crossedOpening(lm, 0, -3, 0, -5)).toBe(false); // departed, already past
  });

  it('never fires for SURFACE types (vista/tunnel have no drive-through opening)', () => {
    const vista = { id: 3, type: LANDMARK_VISTA, x: 0, z: 0, rotationY: 0, scale: 1 } as Landmark;
    const tunnel = { id: 4, type: LANDMARK_TUNNEL, x: 0, z: 0, rotationY: 0, scale: 1 } as Landmark;
    expect(crossedOpening(vista, 0, 5, 0, -5)).toBe(false);
    expect(crossedOpening(tunnel, 0, 5, 0, -5)).toBe(false);
  });

  it('respects rotation — crossing is measured along the rotated through-axis', () => {
    // Facing +x (rotationY = π/2 → through-axis (sin,cos)=(1,0)). Now crossing is in x.
    const lm = ring(1, Math.PI / 2);
    expect(crossedOpening(lm, 5, 0, -5, 0)).toBe(true); // through the centre along x
    expect(crossedOpening(lm, 5, 0, 3, 0)).toBe(false); // same side
  });
});

describe('Zen landmarks — VISTA raises + TUNNEL lowers the drivable surface (the novel part)', () => {
  /** Find a representative landmark of a type by scanning the field. */
  function findType(type: number): Landmark {
    for (let cz = 0; cz < 160; cz++) for (let cx = 0; cx < 160; cx++) {
      const lm = landmarkForCell(SEED, cx, cz);
      if (lm && lm.type === type) return lm;
    }
    throw new Error(`no landmark of type ${type} found`);
  }

  /** A world point on the tunnel's CURVED centreline at axial offset `along` (the realistic path —
   *  the car steers to follow the bend; it's not on rails). Mirrors tunnelBend in the surface. */
  function tunnelCentreline(t: Landmark, along: number): { x: number; z: number } {
    const tx = Math.sin(t.rotationY), tz = Math.cos(t.rotationY);
    const halfL = ZEN_LANDMARK.tunnelLength * t.scale * 0.5;
    const b = ZEN_LANDMARK.tunnelBendAmplitude * t.scale * tunnelBendShape(along / halfL);
    return { x: t.x + tx * along + -tz * b, z: t.z + tz * along + tx * b };
  }

  it('off any landmark, the drivable surface IS the terrain (no override elsewhere)', () => {
    // A point far from any landmark cell centre.
    const x = 137.5;
    const z = -54.2;
    expect(onLandmarkSurface(SEED, x, z)).toBe(false);
    expect(drivableSurfaceY(SEED, x, z)).toBe(heightAt(SEED, x, z));
  });

  it('VISTA: the car drives ONTO a raised flat top, eased to the terrain at the rim', () => {
    const v = findType(LANDMARK_VISTA);
    // Centre: raised ~vistaHeight above the terrain, and flagged as a landmark surface.
    expect(onLandmarkSurface(SEED, v.x, v.z)).toBe(true);
    const lift = drivableSurfaceY(SEED, v.x, v.z) - heightAt(SEED, v.x, v.z);
    expect(lift).toBeGreaterThan(ZEN_LANDMARK.vistaHeight * v.scale * 0.85);
    // Just outside the rim: back to the terrain (override off), and continuous across the rim.
    const R = ZEN_LANDMARK.vistaRadius * v.scale;
    const outX = v.x + R + 5;
    expect(onLandmarkSurface(SEED, outX, v.z)).toBe(false);
    expect(drivableSurfaceY(SEED, outX, v.z)).toBe(heightAt(SEED, outX, v.z));
    // Continuity at the rim: a tiny step across it changes the surface only a little (no cliff).
    const inRim = drivableSurfaceY(SEED, v.x + R - 0.5, v.z);
    const atRim = drivableSurfaceY(SEED, v.x + R + 0.5, v.z);
    expect(Math.abs(inRim - atRim)).toBeLessThan(1.5);
  });

  it('TUNNEL: the car goes BELOW the terrain (a first), eased to the terrain at the mouth', () => {
    const t = findType(LANDMARK_TUNNEL);
    // Centre: the drivable surface is BELOW heightAt by ~tunnelDepth — the car is underground. (Deep at
    // the centre is true under BOTH the drive-down default and the warp fallback.)
    expect(onLandmarkSurface(SEED, t.x, t.z)).toBe(true);
    const drop = heightAt(SEED, t.x, t.z) - drivableSurfaceY(SEED, t.x, t.z);
    expect(drop).toBeGreaterThan(ZEN_LANDMARK.tunnelDepth * t.scale * 0.85);
    expect(inEnclosedTunnel(SEED, t.x, t.z)).toBe(true); // deep → enclosed
    // At the mouth (half-length along the through-axis): back to terrain level (eased entry, no snap).
    // This is the SYMMETRIC tunnel (warp fallback) — under the drive-down default the FAR mouth holds
    // deep + the basin covers it (no resurface there); the eased-mouth check is the fallback's.
    withSymmetricTunnel(() => {
      const tx = Math.sin(t.rotationY);
      const tz = Math.cos(t.rotationY);
      const halfL = ZEN_LANDMARK.tunnelLength * t.scale * 0.5;
      const mouthX = t.x + tx * (halfL + 4);
      const mouthZ = t.z + tz * (halfL + 4);
      expect(onLandmarkSurface(SEED, mouthX, mouthZ)).toBe(false);
      expect(drivableSurfaceY(SEED, mouthX, mouthZ)).toBe(heightAt(SEED, mouthX, mouthZ));
    });
  });

  it('the tunnel PATH CURVES, and the tube CONTAINS its own curve (no pop off the straight axis — #148)', () => {
    const t = findType(LANDMARK_TUNNEL);
    const tx = Math.sin(t.rotationY), tz = Math.cos(t.rotationY);
    const halfL = ZEN_LANDMARK.tunnelLength * t.scale * 0.5;
    // Pick the axial position where the bend peaks (|shape| max, ~half-length in).
    const along = halfL * 0.5;
    const bWorld = ZEN_LANDMARK.tunnelBendAmplitude * t.scale * tunnelBendShape(along / halfL);
    // The channel genuinely CURVES — at the bend peak the centreline reaches most of its amplitude
    // (a real sweep, not a straight tube). (Curve gentled #148→#153 fix; measured vs the amplitude,
    // not the half-width, since the tube is now deliberately much wider than the bend — see below.)
    expect(Math.abs(bWorld)).toBeGreaterThan(ZEN_LANDMARK.tunnelBendAmplitude * t.scale * 0.8);
    // ...but the tube comfortably CONTAINS its curve with a REAL straight-driving corridor
    // (hw − bendAmplitude ≥ a usable width — the #153 proper fix, vs #149's thin 8u), so even on the
    // STRAIGHT axis the car is well ON the channel (it used to fall OFF → null → pop to ground).
    expect(ZEN_LANDMARK.tunnelHalfWidth - ZEN_LANDMARK.tunnelBendAmplitude).toBeGreaterThanOrEqual(25);
    const axisX = t.x + tx * along, axisZ = t.z + tz * along;
    expect(onLandmarkSurface(SEED, axisX, axisZ)).toBe(true);
    // On the CURVED centreline at the same axial position → ON the channel, still deep.
    const c = tunnelCentreline(t, along);
    expect(onLandmarkSurface(SEED, c.x, c.z)).toBe(true);
    expect(heightAt(SEED, c.x, c.z) - drivableSurfaceY(SEED, c.x, c.z)).toBeGreaterThan(ZEN_LANDMARK.tunnelDepth * t.scale * 0.7);
  });

  it('the passage is LONG — a real underground journey, not a 1-2s blink', () => {
    const t = findType(LANDMARK_TUNNEL);
    // Walk the full CURVED centreline and measure how far you're ON the tunnel surface + ENCLOSED.
    const halfL = ZEN_LANDMARK.tunnelLength * t.scale * 0.5;
    let onSpan = 0, enclosedSpan = 0;
    const stepU = 1; // 1u samples
    for (let s = -halfL - 10; s <= halfL + 10; s += stepU) {
      const c = tunnelCentreline(t, s);
      if (onLandmarkSurface(SEED, c.x, c.z)) onSpan += stepU;
      if (inEnclosedTunnel(SEED, c.x, c.z)) enclosedSpan += stepU;
    }
    // The drivable span ≈ the full (much longer) tunnel length, enclosed for most of it.
    expect(onSpan).toBeGreaterThan(ZEN_LANDMARK.tunnelLength * t.scale * 0.9);
    expect(onSpan).toBeGreaterThan(900); // MUCH longer than the old 380u passage
    // At cruise (96u/s) the enclosed stretch alone lasts many seconds — a real journey.
    expect(enclosedSpan / ZEN.maxSpeed).toBeGreaterThan(6); // seconds enclosed
  });

  // SYMMETRIC tunnel (warp fallback): the original descend→enclosed→ascend→RESURFACE-at-the-far-mouth
  // traverse. Under the drive-down default the far half holds deep + the basin covers the terminus, so
  // there's no far-mouth resurface — that's the new drive-down canary's job. Asserted with the basin off.
  it('a FULL traverse following the CURVE (descend → enclosed → ascend → resurface) never snaps', () => withSymmetricTunnel(() => {
    const t = findType(LANDMARK_TUNNEL);
    const halfL = ZEN_LANDMARK.tunnelLength * t.scale * 0.5;
    const dt = 1 / 60;
    const car = createZenVehicle();
    const start = tunnelCentreline(t, -(halfL + 40)); // start before the near mouth, on the centreline
    car.x = start.x;
    car.z = start.z;
    car.y = drivableSurfaceY(SEED, car.x, car.z);
    let maxStep = 0, wentEnclosed = false, resurfaced = false, onCurveDeep = true;
    const stepLen = ZEN.maxSpeed * dt;
    // Advance the AXIAL position at cruise, steering onto the curved centreline each frame.
    for (let along = -(halfL + 40); along <= halfL + 80; along += stepLen) {
      const c = tunnelCentreline(t, along);
      car.x = c.x;
      car.z = c.z;
      const onSurf = onLandmarkSurface(SEED, car.x, car.z);
      const groundY = drivableSurfaceY(SEED, car.x, car.z) + ZEN.rideHeight;
      const before = car.y;
      updateVertical(car, groundY, 0, dt, !onSurf);
      maxStep = Math.max(maxStep, Math.abs(car.y - before));
      if (inEnclosedTunnel(SEED, car.x, car.z)) wentEnclosed = true;
      // While inside the deep zone, following the curve keeps us ON the surface (sits on the floor).
      if (Math.abs(along) < halfL * 0.4 && !onSurf) onCurveDeep = false;
      if (wentEnclosed && !onSurf && Math.abs(along) > halfL) resurfaced = true;
    }
    expect(wentEnclosed).toBe(true); // actually went deep
    expect(onCurveDeep).toBe(true); // stayed on the floor through the curved deep section
    expect(resurfaced).toBe(true); // and came back out the far mouth
    expect(maxStep).toBeLessThanOrEqual(ZEN.maxLandStep + 1e-6); // eased the whole way — no teleport
  }));

  it('crest-detach is SUPPRESSED on a landmark surface (allowAir=false never goes airborne)', () => {
    const dt = 1 / 60;
    // A steep downward surface motion that WOULD detach with air allowed.
    const make = () => {
      const v = createZenVehicle();
      v.speed = ZEN.maxSpeed;
      v.vy = 0;
      return v;
    };
    const steepSlope = -3;
    const withAir = make();
    updateVertical(withAir, 0, steepSlope, dt, true);
    expect(withAir.airborne).toBe(true); // free terrain: a sharp drop detaches (crest air)
    const noAir = make();
    updateVertical(noAir, 0, steepSlope, dt, false);
    expect(noAir.airborne).toBe(false); // on a vista/tunnel surface: stays glued, no crest-jump
  });
});
