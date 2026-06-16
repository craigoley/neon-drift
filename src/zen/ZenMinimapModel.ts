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

import { ZEN, ZEN_MINIMAP, ZEN_BIOMES } from '../utils/constants';
import { mixHex } from '../utils/math';
import { biomeAt, createZenBiomeState, type ZenBiomeState } from './ZenBiome';
import { rampCenterForCell } from './ZenHeight';
import { landmarksInRadius, LANDMARK_TYPE_COUNT, type LandmarkType } from './ZenLandmarkModel';

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

/** The nearest landmark of a given type to the car (the per-type compass entry). */
export interface TypedNearest {
  type: LandmarkType;
  x: number;
  z: number;
  /** Straight-line world distance from the car. */
  dist: number;
}

/**
 * The NEAREST landmark of EACH type to (carX, carZ) — the per-type radar compass. Deterministic
 * (the same placement field the world uses), found by an outward expanding-radius scan: gather all
 * landmarks in a disk and keep the closest per type, doubling the radius until all five types are
 * found or the cap is hit (a rare/far type — e.g. a vista — may need a wide scan). "Actually
 * nearest" is exact: a full disk scan returns ALL landmarks in range, so the per-type minimum is
 * the true nearest within it (and anything beyond is farther). Returns only the types found.
 *
 * Called on the minimap's THROTTLED resample (not per frame), so the re-scan cost is amortised.
 */
export function nearestOfEachType(seed: number, carX: number, carZ: number): TypedNearest[] {
  const best: ({ x: number; z: number; d2: number } | null)[] = new Array(LANDMARK_TYPE_COUNT).fill(null);
  let radius = ZEN_MINIMAP.compassSearchStart;
  for (;;) {
    for (const lm of landmarksInRadius(seed, carX, carZ, radius)) {
      const dx = lm.x - carX;
      const dz = lm.z - carZ;
      const d2 = dx * dx + dz * dz;
      const cur = best[lm.type];
      if (!cur || d2 < cur.d2) best[lm.type] = { x: lm.x, z: lm.z, d2 };
    }
    if (best.every((b) => b !== null) || radius >= ZEN_MINIMAP.compassSearchMax) break;
    radius *= 2;
  }
  const out: TypedNearest[] = [];
  for (let t = 0; t < best.length; t++) {
    const b = best[t];
    if (b) out.push({ type: t as LandmarkType, x: b.x, z: b.z, dist: Math.sqrt(b.d2) });
  }
  return out;
}

/** Pixel scale: world units → radar pixels (radarPixelRadius / worldRadius). */
export function radarScale(radarPixelRadius: number): number {
  return radarPixelRadius / ZEN_MINIMAP.worldRadius;
}
