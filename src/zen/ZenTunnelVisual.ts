/**
 * ZEN TUNNEL VISUAL — the PURE (no three, no DOM → Node-testable) colour-gradient + decoration-placement
 * maths for the tunnel's "visual evolution" (Stage 1) and decorative crystals (Stage 2a). The three.js
 * builder (ZenLandmarks) calls these to colour the tube/floor vertices and to place the wall crystals.
 *
 * PURELY COSMETIC: nothing here is read by the drivable surface (ZenLandmarkSurface). The colour rides
 * in a per-vertex attribute and the crystals are decorative line geometry set INTO the walls — so the
 * #154 corridor, the #149 unified floor, and the off-centre canary are untouched (the path is identical).
 */

import { ZEN_LANDMARK, ZEN_TUNNEL_VISUAL } from '../utils/constants';
import { clamp, lerp } from '../utils/math';
import { smoothstep } from './ZenNoise';
import { tunnelDepthFactor } from './ZenLandmarkModel';

export type RGB = [number, number, number];

/** Unpack a 0xRRGGBB hex to linear 0..1 RGB (matches three's default sRGB-as-is handling for line work). */
function hexRGB(hex: number): RGB {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

const SHALLOW = hexRGB(ZEN_TUNNEL_VISUAL.gradientShallow);
const MID = hexRGB(ZEN_TUNNEL_VISUAL.gradientMid);
const DEEP = hexRGB(ZEN_TUNNEL_VISUAL.gradientDeep);
const CYAN = hexRGB(ZEN_TUNNEL_VISUAL.gradientShallow); // the road's held identity colour

/** DESCENT PROGRESS at a normalized axial position zNorm = along/halfL ∈ [−1, 1]: 0 at the mouths,
 *  1 at the deepest centre. The colour gradient + the deep-brightness ramp key off this. */
export function descentParam(zNorm: number): number {
  return 1 - clamp(Math.abs(zNorm), 0, 1);
}

/** The base hue at descent progress p ∈ [0, 1]: two linear ramps cyan → violet → gold (no brightness). */
function gradientBase(p: number): RGB {
  const mp = ZEN_TUNNEL_VISUAL.gradientMidPoint;
  if (p <= mp) {
    const t = mp <= 0 ? 1 : p / mp;
    return [lerp(SHALLOW[0], MID[0], t), lerp(SHALLOW[1], MID[1], t), lerp(SHALLOW[2], MID[2], t)];
  }
  const t = mp >= 1 ? 1 : (p - mp) / (1 - mp);
  return [lerp(MID[0], DEEP[0], t), lerp(MID[1], DEEP[1], t), lerp(MID[2], DEEP[2], t)];
}

/** The TUBE wall/ceiling colour at descent progress p: the full gradient, brightened toward the deep
 *  end (the subtle bloom ramp). Components may exceed 1 (HDR-ish → bloom flares them). */
export function tunnelTubeRGB(p: number): RGB {
  const b = 1 + ZEN_TUNNEL_VISUAL.deepBrightness * p;
  const g = gradientBase(p);
  return [g[0] * b, g[1] * b, g[2] * b];
}

/** The ROAD colour at descent progress p: the gradient held back TOWARD cyan (so the bright ribbon
 *  stays the readable "drive here" line) + a touch brighter than the walls + the same deep ramp. */
export function tunnelFloorRGB(p: number): RGB {
  const hold = ZEN_TUNNEL_VISUAL.floorCyanHold;
  const b = ZEN_TUNNEL_VISUAL.floorBrightness * (1 + ZEN_TUNNEL_VISUAL.deepBrightness * p);
  const g = gradientBase(p);
  return [
    lerp(g[0], CYAN[0], hold) * b,
    lerp(g[1], CYAN[1], hold) * b,
    lerp(g[2], CYAN[2], hold) * b,
  ];
}

/** The DECORATION crystal colour (a constant magenta accent — the same everywhere). */
export function tunnelDecorRGB(): RGB {
  return hexRGB(ZEN_TUNNEL_VISUAL.decorColor);
}

/** Local floor Y at axial z (the descending road): −tunnelDepth · the SHARED depth factor. Mirrors
 *  ZenLandmarks.tunnelFloorY exactly (both key off tunnelDepthFactor — used here only to place the
 *  decorative crystals ABOVE the road, never to move the drivable surface). */
export function tunnelLocalFloorY(z: number, halfL: number): number {
  return -ZEN_LANDMARK.tunnelDepth * tunnelDepthFactor(z / halfL);
}

/** Local arch (ceiling) height at axial z — tapers to ~0 at the mouths, full headroom deep inside.
 *  The single definition for the tube ceiling AND the decoration head-room test (extracted from
 *  buildTunnel so the crystals sit inside the real tube). */
export function tunnelArchHeightLocal(z: number, halfL: number): number {
  const grow = 1 - smoothstep(halfL * ZEN_LANDMARK.tunnelDepthEaseStart, halfL, Math.abs(z));
  const floor = ZEN_LANDMARK.tunnelMouthArchFloor;
  return ZEN_LANDMARK.tunnelHeadroom * (floor + (1 - floor) * grow);
}

/** One decorative-crystal station along the tube: its axial position, which WALL it's on (sign = ±1),
 *  the local floor Y + arch height there, and the crystal's centre Y. */
export interface DecorStation {
  z: number;
  /** −1 = left wall, +1 = right wall (alternating along the length). */
  sign: number;
  floorY: number;
  archH: number;
  centreY: number;
}

/** The decorative-crystal stations for a tunnel of local half-length halfL: evenly spaced along the
 *  length, skipping the shallow mouth zones where the arch is too short, alternating walls. Pure +
 *  deterministic (identical on every tunnel — Stage 2a). The builder emits a crystal at each; tests
 *  assert each sits OUT by the wall + ABOVE the road (never on the drive line). */
export function tunnelDecorStations(halfL: number): DecorStation[] {
  const out: DecorStation[] = [];
  const spacing = ZEN_TUNNEL_VISUAL.decorSpacing;
  let i = 0;
  for (let z = -halfL + spacing; z < halfL - 1e-6; z += spacing) {
    const archH = tunnelArchHeightLocal(z, halfL);
    if (archH < ZEN_TUNNEL_VISUAL.decorMinArch) continue; // near a mouth — no room, skip
    const floorY = tunnelLocalFloorY(z, halfL);
    out.push({
      z,
      sign: i % 2 === 0 ? -1 : 1,
      floorY,
      archH,
      centreY: floorY + archH * ZEN_TUNNEL_VISUAL.decorHeightFrac,
    });
    i++;
  }
  return out;
}

/** The crystal's lateral offset from the (curving) tube centre — out by the wall, inset slightly. The
 *  builder adds bend(z) to this; |offset| being near halfWidth is what keeps it off the central road. */
export function tunnelDecorWallOffset(): number {
  return ZEN_LANDMARK.tunnelHalfWidth - ZEN_TUNNEL_VISUAL.decorWallInset;
}
