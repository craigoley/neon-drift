/**
 * ZEN SKY-SLIDE PATH — the PURE parametric curve the car rides on the Vista Sky-Slide (no three, no
 * DOM → Node-testable). Recon (docs/vista-sky-slide-recon.md): the slide is a GUIDED ride on an
 * ABSOLUTE-Y path, because the drivable-surface override is ground-relative (can't go above ground)
 * and the ballistic launch caps at ~5u apex (can't reach the sky). So the path owns the altitude
 * itself: an ascending first segment (the scripted CATAPULT, deck → sky), a twisting descending body
 * (the slide), easing down to the ground near the vista.
 *
 * `u ∈ [0, 1]` is the normalized progress along the path (the session advances it by speed). The
 * profiles are all eased (C¹ — zero slope at the seams) so the ride is exhilarating, not twitchy. The
 * lateral TWIST reuses the tunnel's windowed-sine `bendShape` (zero value + tangent at both ends).
 */

import { ZEN_SLIDE } from '../utils/constants';
import { smoothstep } from './ZenNoise';
import { bendShape } from './ZenLandmarkModel';

const clamp01 = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u);

/** Forward distance from the launch vista at progress u (eased out + in → 0..forwardReach). */
export function slideFwdOffset(u: number): number {
  return ZEN_SLIDE.forwardReach * smoothstep(0, 1, clamp01(u));
}

/** Lateral twist offset at progress u — the windowed sine (zero + tangent at both ends), snaking
 *  `bendWaves` times across the centreline. */
export function slideLatOffset(u: number): number {
  return ZEN_SLIDE.bendAmplitude * bendShape(2 * clamp01(u) - 1, ZEN_SLIDE.bendWaves, ZEN_SLIDE.bendEaseStart);
}

/** Altitude offset above the vista DECK at progress u: rises to `climbHeight` (the catapult), then
 *  monotonically DESCENDS to `−descentDrop` (≈ the ground at the vista base). C¹ at the apex seam. */
export function slideAltOffset(u: number): number {
  const c = clamp01(u);
  const af = ZEN_SLIDE.ascentFrac;
  if (c <= af) {
    // Catapult climb: 0 → climbHeight, zero slope at both ends (gentle launch, smooth apex).
    return ZEN_SLIDE.climbHeight * smoothstep(0, af, c);
  }
  // Twisting descent: climbHeight → −descentDrop, zero slope at both ends (smooth apex + landing).
  const endAlt = -ZEN_SLIDE.descentDrop;
  return ZEN_SLIDE.climbHeight + (endAlt - ZEN_SLIDE.climbHeight) * smoothstep(af, 1, c);
}

export interface SlideVec {
  x: number;
  y: number;
  z: number;
}

/**
 * A concrete slide instance anchored at a launch vista. The centreline is the profiles above placed
 * in the launch frame (forward = the heading you drove on, right = lateral). `pointAt`/`tangentAt`
 * write reused scratch (no per-frame alloc).
 */
export class ZenSlidePath {
  /** Nominal length — the session advances u by (speed / length)·dt. */
  readonly length = ZEN_SLIDE.pathLength;
  private readonly ox: number;
  private readonly oy: number;
  private readonly oz: number;
  private readonly fx: number; // forward axis (XZ)
  private readonly fz: number;
  private readonly rx: number; // right axis (XZ)
  private readonly rz: number;
  private readonly _pt: SlideVec = { x: 0, y: 0, z: 0 };
  private readonly _tan: SlideVec = { x: 0, y: 0, z: 0 };

  constructor(origin: SlideVec, heading: number) {
    this.ox = origin.x;
    this.oy = origin.y;
    this.oz = origin.z;
    // Forward = (sin h, −cos h) (the game's forward); right = (cos h, sin h) (perpendicular).
    this.fx = Math.sin(heading);
    this.fz = -Math.cos(heading);
    this.rx = Math.cos(heading);
    this.rz = Math.sin(heading);
  }

  /** World-space centreline point at progress u (steer nudge is applied by the session, not here). */
  pointAt(u: number): SlideVec {
    const f = slideFwdOffset(u);
    const lat = slideLatOffset(u);
    this._pt.x = this.ox + this.fx * f + this.rx * lat;
    this._pt.z = this.oz + this.fz * f + this.rz * lat;
    this._pt.y = this.oy + slideAltOffset(u);
    return this._pt;
  }

  /** World-space UNIT tangent at u (central difference) — for heading + nose-pitch + camera. */
  tangentAt(u: number): SlideVec {
    const eps = 1e-3;
    const a = this.rawPoint(u - eps);
    const bx = this.rawPointX(u + eps);
    const by = this.rawPointY(u + eps);
    const bz = this.rawPointZ(u + eps);
    let tx = bx - a.x;
    let ty = by - a.y;
    let tz = bz - a.z;
    const len = Math.hypot(tx, ty, tz) || 1;
    tx /= len;
    ty /= len;
    tz /= len;
    this._tan.x = tx;
    this._tan.y = ty;
    this._tan.z = tz;
    return this._tan;
  }

  // --- internal: a SECOND scratch point for the tangent's "behind" sample (pointAt's scratch is
  //     reused by callers, so the central difference can't share it). ---
  private readonly _b: SlideVec = { x: 0, y: 0, z: 0 };
  private rawPoint(u: number): SlideVec {
    const f = slideFwdOffset(u);
    const lat = slideLatOffset(u);
    this._b.x = this.ox + this.fx * f + this.rx * lat;
    this._b.z = this.oz + this.fz * f + this.rz * lat;
    this._b.y = this.oy + slideAltOffset(u);
    return this._b;
  }
  private rawPointX(u: number): number {
    return this.ox + this.fx * slideFwdOffset(u) + this.rx * slideLatOffset(u);
  }
  private rawPointY(u: number): number {
    return this.oy + slideAltOffset(u);
  }
  private rawPointZ(u: number): number {
    return this.oz + this.fz * slideFwdOffset(u) + this.rz * slideLatOffset(u);
  }
}
