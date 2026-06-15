/**
 * ZEN MINIMAP model — the PURE logic behind the corner radar (no DOM, no canvas → Node-
 * testable). The radar is ME-CENTERED and ROTATES with heading (the car marker always points
 * UP); this module owns the two things that need to be exactly right + tested:
 *   1. the world → radar projection (rotate the world around the car so forward points up),
 *   2. live-sampling the infinite procedural world (biome colour per point + ramp markers in
 *      range) — there is no stored map, so everything is derived from biomeAt / ramp cells.
 *
 * The drawing layer (ZenMinimap) is a thin canvas renderer over this.
 */

import { ZEN, ZEN_MINIMAP, ZEN_LANDMARK, ZEN_BIOMES } from '../utils/constants';
import { mixHex } from '../utils/math';
import { biomeAt, createZenBiomeState, type ZenBiomeState } from './ZenBiome';
import { rampCenterForCell } from './ZenHeight';
import { landmarkForCell, landmarksInRadius, LANDMARK_TUNNEL, type LandmarkType } from './ZenLandmarkModel';

/** A point of interest the radar marks. EXTENSIBLE: ramps + landmarks so far; discoveries
 *  become additional `kind`s drawn by the same marker pipeline. */
export interface MinimapMarker {
  /** World position. */
  x: number;
  z: number;
  kind: 'ramp' | 'landmark';
  /** For `kind: 'landmark'`, the LandmarkType — so the radar can draw a type distinctly (e.g. a
   *  tunnel's down-chevron) instead of one generic dot. Undefined for ramps. */
  landmarkType?: LandmarkType;
}

/** A radar offset from the centre, in WORLD units, canvas convention (+x right, +y DOWN).
 *  Multiply by the pixel scale (radarPixelRadius / worldRadius) to get screen pixels. */
export interface RadarOffset {
  x: number;
  y: number;
}

/**
 * Project a world DELTA (worldPos − carPos) into the rotating, me-centered radar frame, so
 * the car's FORWARD (−z at heading 0) points UP and the world spins around it as you turn.
 *
 * Derivation: the car's forward axis is (sin h, −cos h) and its right axis is (cos h, sin h)
 * (heading 0 faces −z; increasing h turns right toward +x — matching ZenVehicle). Decompose
 * the delta onto those axes: RIGHT → screen +x, FORWARD → screen UP (−y, since canvas y is
 * down). This is exactly a rotation of (dx, dz) by −h.
 */
export function projectToRadar(dx: number, dz: number, heading: number, out?: RadarOffset): RadarOffset {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const o = out ?? { x: 0, y: 0 };
  o.x = dx * c + dz * s;  // right component
  o.y = dz * c - dx * s;  // −forward component (forward → up; canvas y is down)
  return o;
}

/** The radar colour at a world point: the active biome's grid-line colour, blended across a
 *  region transition (the SAME palette the world's grid floor uses, so map ↔ world agree). */
export function biomeRadarColor(seed: number, x: number, z: number, scratch?: ZenBiomeState): number {
  const st = biomeAt(seed, x, z, scratch ?? createZenBiomeState());
  return mixHex(ZEN_BIOMES[st.from].gridLine, ZEN_BIOMES[st.to].gridLine, st.blend);
}

/**
 * Gather the markers within `radius` of the car (live — no stored map). Scans the ramp CELLS for
 * ramp domes AND the (much rarer) LANDMARK cells for beacons, keeping those inside the radar
 * CIRCLE. One array keeps it extensible — later marker kinds append here. Bounded: each cell span
 * is ~(2·radius / cellSize)² (small constants).
 */
export function gatherMarkers(seed: number, carX: number, carZ: number, radius: number): MinimapMarker[] {
  const out: MinimapMarker[] = [];
  const r2 = radius * radius;
  // Ramps (the dense, common markers).
  const cs = ZEN.rampCellSize;
  const minCellX = Math.floor((carX - radius) / cs);
  const maxCellX = Math.floor((carX + radius) / cs);
  const minCellZ = Math.floor((carZ - radius) / cs);
  const maxCellZ = Math.floor((carZ + radius) / cs);
  for (let cz = minCellZ; cz <= maxCellZ; cz++) {
    for (let cx = minCellX; cx <= maxCellX; cx++) {
      const c = rampCenterForCell(seed, cx, cz);
      if (!c) continue;
      const dx = c.x - carX;
      const dz = c.z - carZ;
      if (dx * dx + dz * dz <= r2) out.push({ x: c.x, z: c.z, kind: 'ramp' });
    }
  }
  // Landmarks (the rare beacons you navigate TO — the payoff of the marker pipeline). Carry the
  // TYPE so the radar can draw tunnels (etc.) distinctly, not all as one generic dot.
  for (const lm of landmarksInRadius(seed, carX, carZ, radius)) {
    out.push({ x: lm.x, z: lm.z, kind: 'landmark', landmarkType: lm.type });
  }
  return out;
}

/** Pixel scale: world units → radar pixels (radarPixelRadius / worldRadius). */
export function radarScale(radarPixelRadius: number): number {
  return radarPixelRadius / ZEN_MINIMAP.worldRadius;
}

/** The nearest tunnel to a point: its world position + straight-line distance. */
export interface NearestTunnel {
  x: number;
  z: number;
  dist: number;
}

/**
 * The NEAREST deterministic TUNNEL landmark to (carX, carZ), or null if none within the search
 * bound. Tunnels are position-deterministic (a cell hash), so this points at a REAL tunnel that's
 * actually there when you arrive — the data behind the on-radar compass needle.
 *
 * Searches landmark cells outward in expanding Chebyshev RINGS from the car's cell, up to
 * `maxCells`, tracking the closest tunnel. Early-out: a ring at Chebyshev radius r can't contain a
 * cell nearer than (r−1)·cellSize (the car sits inside its own cell), so once we hold a candidate
 * at distance D we stop as soon as (r−1)·cellSize ≥ D. Bounded by (2·maxCells+1)² cells, and the
 * caller throttles it (the radar resample, not every frame).
 */
export function nearestTunnel(
  seed: number,
  carX: number,
  carZ: number,
  maxCells: number = ZEN_MINIMAP.tunnelCompassMaxCells,
): NearestTunnel | null {
  const cs = ZEN_LANDMARK.cellSize;
  const ccx = Math.floor(carX / cs);
  const ccz = Math.floor(carZ / cs);
  let best: NearestTunnel | null = null;
  let bestD2 = Infinity;
  for (let r = 0; r <= maxCells; r++) {
    // The nearest any ring-r cell can be is (r−1)·cs (conservative) — once that exceeds the best
    // distance found, no closer tunnel can exist further out.
    if (best && (r - 1) * cs >= best.dist) break;
    for (let cz = ccz - r; cz <= ccz + r; cz++) {
      for (let cx = ccx - r; cx <= ccx + r; cx++) {
        // Perimeter of ring r only (interior cells were scanned in earlier, nearer rings).
        if (Math.max(Math.abs(cx - ccx), Math.abs(cz - ccz)) !== r) continue;
        const lm = landmarkForCell(seed, cx, cz);
        if (!lm || lm.type !== LANDMARK_TUNNEL) continue;
        const dx = lm.x - carX;
        const dz = lm.z - carZ;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = { x: lm.x, z: lm.z, dist: Math.sqrt(d2) };
        }
      }
    }
  }
  return best;
}
