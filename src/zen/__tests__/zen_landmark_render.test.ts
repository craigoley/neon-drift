/**
 * Zen landmark reward — RENDER-OBJECT tests (the gap that let "fires but invisible" ship 3×).
 *
 * Prior tests asserted only the reward STATE (pulseT / envelope / crossedOpening). The reward DID
 * fire in state yet showed NOTHING on screen, because the effect's render objects were unseeable: a
 * thin 1px line-circle ~26u OVERHEAD, crossed edge-on (diag/zen-reward-not-rendering). Pixels can't
 * be unit-tested, but the render OBJECTS can — position, material type, scene presence. These assert
 * the gate ripple is now a FILLED ADDITIVE annulus at CAR HEIGHT, face-on, added to the scene + shown
 * on a crossing, and that the flash mutates the DRAWN material — so a regression to "unseeable" FAILS.
 *
 * Constructing ZenLandmarks needs only CPU three objects (geometry/material/mesh/scene) — no WebGL —
 * so it runs headless (verified by the diagnostic harness).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ZenLandmarks } from '../ZenLandmarks';
import { heightAt } from '../ZenHeight';
import { landmarkForCell, reachRadius, LANDMARK_RING, LANDMARK_VISTA } from '../ZenLandmarkModel';
import { ZEN, ZEN_LANDMARK, ZEN_BLOOM } from '../../utils/constants';

const SEED = ZEN.worldSeed;
const TICK = 1 / 60;

function findRing() {
  for (let cz = 0; cz < 200; cz++) {
    for (let cx = 0; cx < 200; cx++) {
      const lm = landmarkForCell(SEED, cx, cz);
      if (lm && lm.type === LANDMARK_RING) return lm;
    }
  }
  throw new Error('no ring found');
}

/** Drive a fresh ZenLandmarks straight through a ring at cruise; return the scene + active record. */
function driveThroughRing() {
  const ring = findRing();
  const scene = new THREE.Scene();
  const lms = new ZenLandmarks(scene, SEED);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const active = (lms as any).active as Map<number, any>;
  const tx = Math.sin(ring.rotationY);
  const tz = Math.cos(ring.rotationY);
  let x = ring.x - tx * 220;
  let z = ring.z - tz * 220;
  const base = ZEN_LANDMARK.ringColor.toString(16).padStart(6, '0');
  let colorChanged = false;
  let gateShown = false;
  let maxGateOpacity = 0;
  for (let i = 0; i < 260; i++) {
    x += tx * ZEN.maxSpeed * TICK;
    z += tz * ZEN.maxSpeed * TICK;
    lms.update(x, z, TICK);
    const a = active.get(ring.id);
    if (a) {
      if (a.material.color.getHexString() !== base) colorChanged = true;
      if (a.gateMesh && a.gateMesh.visible) gateShown = true;
      if (a.gateMaterial) maxGateOpacity = Math.max(maxGateOpacity, a.gateMaterial.opacity);
    }
  }
  return { ring, scene, lms, active, colorChanged, gateShown, maxGateOpacity };
}

describe('Zen landmark reward — the gate ripple renders SEEABLY (not the overhead edge-on line)', () => {
  it('the ripple is a FILLED ADDITIVE annulus (a Mesh) — an area the bloom can flare, not a 1px line', () => {
    const { ring, lms } = driveThroughRing();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (lms as any).active.get(ring.id);
    expect(a.gateMesh).toBeInstanceOf(THREE.Mesh); // not THREE.LineSegments
    expect(a.gateMesh.geometry).toBeInstanceOf(THREE.RingGeometry); // a filled ring, not a line loop
    expect(a.gateMaterial).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(a.gateMaterial.blending).toBe(THREE.AdditiveBlending); // additive → bloom flares it
  });

  it('the ripple sits at CAR HEIGHT, face-on — NOT ~26u overhead in a vertical edge-on plane', () => {
    const { ring, lms } = driveThroughRing();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (lms as any).active.get(ring.id);
    const groundY = heightAt(SEED, ring.x, ring.z);
    const heightAboveGround = a.gateMesh.position.y - groundY;
    expect(heightAboveGround).toBeCloseTo(ZEN_LANDMARK.gateRippleHeight, 3); // low (car level)
    // The OLD bug put it at the ring CENTRE (~ringRadius·centreFactor·scale ≈ 20u+). Guard against it.
    expect(heightAboveGround).toBeLessThan(8);
  });

  it('the ripple is ADDED to the scene and becomes VISIBLE when you cross the opening', () => {
    const { scene, gateShown, maxGateOpacity, ring, lms } = driveThroughRing();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (lms as any).active.get(ring.id);
    expect(scene.children).toContain(a.gateMesh); // actually in the scene graph
    expect(gateShown).toBe(true); // visible at some point during the pass
    expect(maxGateOpacity).toBeGreaterThan(0.5); // and substantially opaque (not a 0-opacity ghost)
  });
});

describe('Zen landmark reward — the flash mutates the DRAWN material (bloom makes it read)', () => {
  it('the structure material brightens toward white during the reach flash', () => {
    const { colorChanged, ring, lms } = driveThroughRing();
    expect(colorChanged).toBe(true); // material.color lerps off the base orange (the flash)
    // The mesh's material IS the one we mutate (so the change reaches what's drawn).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (lms as any).active.get(ring.id);
    expect(a.mesh.material).toBe(a.material);
    expect(reachRadius(ring)).toBeGreaterThan(0);
  });
});

describe('Zen bloom — mobile-safe config is present (the glow that makes neon read)', () => {
  it('ZEN_BLOOM has a positive strength + a HALF-res (≤0.5) blur target (the mobile perf lever)', () => {
    expect(ZEN_BLOOM.strength).toBeGreaterThan(0);
    expect(ZEN_BLOOM.resolutionScale).toBeLessThanOrEqual(0.5); // half-res = the measured-safe config
    expect(ZEN_BLOOM.threshold).toBeGreaterThan(0);
    expect(ZEN_BLOOM.threshold).toBeLessThan(1);
    expect(ZEN_BLOOM.radius).toBeGreaterThan(0);
  });
});

describe('Zen landmark reward — VISTA sustained glow (parking on it keeps glowing, not one-shot)', () => {
  function findVista() {
    for (let cz = 0; cz < 200; cz++) for (let cx = 0; cx < 200; cx++) {
      const lm = landmarkForCell(SEED, cx, cz);
      if (lm && lm.type === LANDMARK_VISTA) return lm;
    }
    throw new Error('no vista');
  }

  it('the vista keeps glowing while parked on top (long past the one-shot pulse), dark when away', () => {
    const vista = findVista();
    const scene = new THREE.Scene();
    const lms = new ZenLandmarks(scene, SEED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const active = (lms as any).active as Map<number, any>;
    const base = ZEN_LANDMARK.vistaColor.toString(16).padStart(6, '0');

    // Park ON the vista (centre, within reach) and tick well past the one-shot pulse (1.6s ≈ 96f).
    for (let i = 0; i < 300; i++) lms.update(vista.x, vista.z, 1 / 60);
    const onTop = active.get(vista.id);
    expect(onTop).toBeDefined();
    expect(onTop.material.color.getHexString()).not.toBe(base); // STILL glowing (sustained, not faded)
    expect(onTop.sustainT).toBeGreaterThan(1.6); // the sustain has been running the whole time

    // Drive far away (off the vista) → the glow returns to the base colour (no phantom glow).
    for (let i = 0; i < 30; i++) lms.update(vista.x + 4000, vista.z + 4000, 1 / 60);
    // The vista is culled at that distance, so re-approach to read its resting colour.
    for (let i = 0; i < 5; i++) lms.update(vista.x + ZEN_LANDMARK.drawRadius - 50, vista.z, 1 / 60);
    const away = active.get(vista.id);
    if (away) {
      expect(away.material.color.getHexString()).toBe(base); // not near → base colour, no sustain
    }
  });
});
