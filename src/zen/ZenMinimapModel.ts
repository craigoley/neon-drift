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

/** A point of interest the radar marks. EXTENSIBLE: ramps are the first kind; landmarks /
 *  discoveries become additional `kind`s drawn by the same marker pipeline. */
export interface MinimapMarker {
  /** World position. */
  x: number;
  z: number;
  kind: 'ramp';
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
export function projectToRadar(dx: number, dz: number, heading: number): RadarOffset {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return {
    x: dx * c + dz * s, // right component
    y: dz * c - dx * s, // −forward component (forward → up; canvas y is down)
  };
}

/** The radar colour at a world point: the active biome's grid-line colour, blended across a
 *  region transition (the SAME palette the world's grid floor uses, so map ↔ world agree). */
export function biomeRadarColor(seed: number, x: number, z: number, scratch?: ZenBiomeState): number {
  const st = biomeAt(seed, x, z, scratch ?? createZenBiomeState());
  return mixHex(ZEN_BIOMES[st.from].gridLine, ZEN_BIOMES[st.to].gridLine, st.blend);
}

/**
 * Gather the markers within `radius` of the car (live — no stored map). Currently the ramp
 * domes: scan the ramp CELLS overlapping the radar box, take each gated centre, keep those
 * inside the radar CIRCLE. Pushing into one array keeps it extensible — later marker kinds
 * append here. Bounded: the cell span is ~(2·radius / rampCellSize)² (a small constant).
 */
export function gatherMarkers(seed: number, carX: number, carZ: number, radius: number): MinimapMarker[] {
  const out: MinimapMarker[] = [];
  const cs = ZEN.rampCellSize;
  const r2 = radius * radius;
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
  return out;
}

/** Pixel scale: world units → radar pixels (radarPixelRadius / worldRadius). */
export function radarScale(radarPixelRadius: number): number {
  return radarPixelRadius / ZEN_MINIMAP.worldRadius;
}
