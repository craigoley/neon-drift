/**
 * Zen LANDMARKS — the rare neon beacons you spot from afar + journey to. The FEEL is a phone
 * playtest, but the SYSTEM is unit-testable: placement is DETERMINISTIC + RARE (rarer than
 * ramps — a beacon, not litter), gated to reachable GENTLE terrain (sits on heightAt); each
 * type's SOLID parts are correct (arch opening clear + pillars solid, monolith solid, ring
 * pass-through); reach detection fires within radius; and every landmark is marked on the
 * minimap (kind: 'landmark') via the #124 pipeline.
 */
import { describe, expect, it } from 'vitest';
import {
  landmarkForCell,
  landmarksInRadius,
  eachSolidCircle,
  isReached,
  reachRadius,
  LANDMARK_ARCH,
  LANDMARK_MONOLITH,
  LANDMARK_RING,
  LANDMARK_TYPE_COUNT,
  type Landmark,
} from '../ZenLandmarkModel';
import { rampCenterForCell, maskAt } from '../ZenHeight';
import { deflectPoint } from '../ZenWorld';
import { gatherMarkers } from '../ZenMinimapModel';
import { ZEN, ZEN_LANDMARK } from '../../utils/constants';

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

  it('uses all three types, each with a valid type/scale/rotation', () => {
    const seen = new Set<number>();
    for (const lm of allLandmarks(40)) {
      seen.add(lm.type);
      expect(lm.type).toBeGreaterThanOrEqual(0);
      expect(lm.type).toBeLessThan(LANDMARK_TYPE_COUNT);
      expect(lm.scale).toBeGreaterThanOrEqual(ZEN_LANDMARK.scaleMin);
      expect(lm.scale).toBeLessThanOrEqual(ZEN_LANDMARK.scaleMax);
      expect(lm.rotationY).toBeGreaterThanOrEqual(0);
      expect(lm.rotationY).toBeLessThanOrEqual(Math.PI * 2);
    }
    expect(seen.size).toBe(LANDMARK_TYPE_COUNT); // a MIX of types
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

  it('MONOLITH: SOLID — a car driving into it is deflected out', () => {
    const mono = findType(LANDMARK_MONOLITH);
    let circles = 0;
    eachSolidCircle(mono, () => circles++);
    expect(circles).toBe(1);
    const pushed = resolve(mono, mono.x, mono.z); // dead centre → pushed to the edge
    expect(Math.hypot(pushed.x - mono.x, pushed.z - mono.z)).toBeGreaterThan(0.5);
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
