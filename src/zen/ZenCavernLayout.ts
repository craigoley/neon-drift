/**
 * ZEN TUNNEL CAVERN LAYOUT — the PURE (no three, no DOM → Node-testable) placement maths for the
 * beautiful tunnel payoff space. Given the region's return portal, it lays out: the cavern CENTRE
 * (straight ahead of the arrival, so you emerge facing the centerpiece), the scattered MONUMENTS, and
 * the enclosing SHELL pillars — all anchored to the EXISTING ground via heightAt (decoration on flat
 * drivable ground; the drivable surface is untouched). The three.js builder (ZenCavern) turns this into
 * neon line geometry; keeping the layout pure means the awe-framing + bounds are unit-testable.
 */

import { ZEN_TUNNEL_CAVERN } from '../utils/constants';
import { lerp } from '../utils/math';
import { hashNoise } from '../utils/rng';
import { heightAt } from './ZenHeight';
import type { Landmark } from './ZenLandmarkModel';

/** Decorrelate the cavern seed from placement/decor/etc. */
const CAVERN_SEED_OFFSET = 0xca7e0;

/** One deterministic 0..1 value for (slot index, sub-slot) — same hash pattern the rest of Zen uses. */
function unit(seed: number, i: number, sub: number): number {
  const idx = (Math.imul(i + 1, 0x9e3779b1) + sub) | 0;
  return (hashNoise((seed + CAVERN_SEED_OFFSET) | 0, idx) + 1) * 0.5;
}

/** A placed cavern structure (monument or shell pillar): footprint + how tall + look. */
export interface CavernStructure {
  x: number;
  z: number;
  /** Ground Y at (x, z) — the structure rises from the existing drivable ground (heightAt). */
  baseY: number;
  height: number;
  /** Cross-section radius (footprint) + a yaw rotation + which amber-palette hue index. */
  radius: number;
  rot: number;
  hue: number;
}

export interface CavernLayout {
  /** The cavern centre (where the centerpiece spire stands) — straight ahead of the arrival pose. */
  center: { x: number; z: number; baseY: number };
  /** The inward unit direction (portal through-axis) — the direction the car faces on arrival. */
  axis: { x: number; z: number };
  centerpieceHeight: number;
  monuments: CavernStructure[];
  shell: CavernStructure[];
}

/**
 * Lay out the cavern around the given return portal. The centre sits `centerDist` along the portal's
 * through-axis — the SAME +axis the arrival faces (ZenSecret.arrivalPose) — so the car emerges looking
 * straight at the centerpiece (the awe moment). Monuments are seeded into the open inner floor; the
 * shell is an even ring of distant pillars. Deterministic in (seed, portal): the same cavern every time.
 */
export function cavernLayout(seed: number, portal: Landmark): CavernLayout {
  const C = ZEN_TUNNEL_CAVERN;
  // The portal through-axis (matches arrivalPose's forward = (sin rot, cos rot)).
  const ax = Math.sin(portal.rotationY);
  const az = Math.cos(portal.rotationY);
  const cx = portal.x + ax * C.centerDist;
  const cz = portal.z + az * C.centerDist;

  const monuments: CavernStructure[] = [];
  for (let i = 0; i < C.monumentCount; i++) {
    const ang = unit(seed, i, 0) * Math.PI * 2;
    const rad = lerp(C.monumentMinRadius, C.monumentMaxRadius, unit(seed, i, 1));
    const x = cx + Math.cos(ang) * rad;
    const z = cz + Math.sin(ang) * rad;
    monuments.push({
      x,
      z,
      baseY: heightAt(seed, x, z),
      height: lerp(C.monumentMinHeight, C.monumentMaxHeight, unit(seed, i, 2)),
      radius: lerp(C.monumentMinBaseRadius, C.monumentMaxBaseRadius, unit(seed, i, 3)),
      rot: unit(seed, i, 4) * Math.PI * 2,
      hue: Math.floor(unit(seed, i, 5) * C.amberPalette.length) % C.amberPalette.length,
    });
  }

  const shell: CavernStructure[] = [];
  for (let i = 0; i < C.shellCount; i++) {
    const ang = (i / C.shellCount) * Math.PI * 2;
    const x = cx + Math.cos(ang) * C.shellRadius;
    const z = cz + Math.sin(ang) * C.shellRadius;
    shell.push({
      x,
      z,
      baseY: heightAt(seed, x, z),
      height: C.shellHeight,
      radius: C.shellPillarRadius,
      rot: ang,
      hue: 0,
    });
  }

  return {
    center: { x: cx, z: cz, baseY: heightAt(seed, cx, cz) },
    axis: { x: ax, z: az },
    centerpieceHeight: C.centerpieceHeight,
    monuments,
    shell,
  };
}
