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
import { drivableSurfaceY } from '../ZenLandmarkSurface';
import { landmarkForCell, reachRadius, LANDMARK_RING, LANDMARK_VISTA, LANDMARK_TUNNEL } from '../ZenLandmarkModel';
import { tunnelLocalFloorY } from '../ZenTunnelVisual';
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

describe('Zen tunnel — the ENTRANCE BEACON makes it spottable from afar (was a below-ground hole)', () => {
  it('the tunnel mesh now stands in the beacon height range (a tall portal, not a ~13u mouth)', () => {
    const scene = new THREE.Scene();
    const lms = new ZenLandmarks(scene, SEED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geo = (lms as any).geo as THREE.BufferGeometry[];
    const posAttr = geo[LANDMARK_TUNNEL].getAttribute('position') as THREE.BufferAttribute;
    let maxY = -Infinity;
    for (let i = 0; i < posAttr.count; i++) maxY = Math.max(maxY, posAttr.getY(i));
    // Before the fix the tunnel topped out at the headroom (~13u) — below the 14-46u beacon range.
    expect(maxY).toBeGreaterThanOrEqual(ZEN_LANDMARK.tunnelBeaconHeight - 1e-3); // now a tall beacon
    expect(maxY).toBeGreaterThan(ZEN_LANDMARK.tunnelHeadroom + 10); // clearly taller than the old mouth
  });
});

describe('Zen tunnel — the FLOOR is a visible neon ROAD (was a void under the car)', () => {
  function findTunnel() {
    for (let cz = 0; cz < 200; cz++) for (let cx = 0; cx < 200; cx++) {
      const lm = landmarkForCell(SEED, cx, cz);
      if (lm && lm.type === LANDMARK_TUNNEL) return lm;
    }
    throw new Error('no tunnel found');
  }

  /** Spawn the tunnel into a scene by driving the streamer onto it. */
  function spawnTunnel() {
    const tunnel = findTunnel();
    const scene = new THREE.Scene();
    const lms = new ZenLandmarks(scene, SEED);
    lms.update(tunnel.x, tunnel.z, TICK);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (lms as any).active.get(tunnel.id);
    return { tunnel, scene, lms, a };
  }

  it('a tunnel spawns a SEPARATE floor mesh (vertex-coloured, white base), added to the scene', () => {
    const { scene, a } = spawnTunnel();
    expect(a.floorMesh).toBeInstanceOf(THREE.LineSegments);
    expect(a.floorMaterial).toBeInstanceOf(THREE.LineBasicMaterial);
    // Visual-evolution contract: the road's colour rides a per-vertex gradient (cyan-held), so the
    // material is WHITE with vertexColors on (was a flat cyan material.color before Stage 1).
    expect(a.floorMaterial.vertexColors).toBe(true);
    expect(a.floorMaterial.color.getHex()).toBe(0xffffff);
    expect(a.floorMesh.geometry.getAttribute('color')).toBeTruthy(); // the gradient is present
    expect(scene.children).toContain(a.floorMesh); // actually in the scene graph
  });

  it('the road sits AT the drivable surface (car drives ON it) and runs the FULL length', () => {
    const { tunnel, a } = spawnTunnel();
    a.floorMesh.updateMatrixWorld(true);
    const pos = a.floorMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    let minY = Infinity, maxAxial = 0;
    const tx = Math.sin(tunnel.rotationY), tz = Math.cos(tunnel.rotationY);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(a.floorMesh.matrixWorld);
      minY = Math.min(minY, v.y);
      maxAxial = Math.max(maxAxial, Math.abs((v.x - tunnel.x) * tx + (v.z - tunnel.z) * tz));
    }
    // The deepest road point matches the car's drivable surface at the tunnel centre (sits ON the road).
    const carY = drivableSurfaceY(SEED, tunnel.x, tunnel.z);
    expect(Math.abs(minY - carY)).toBeLessThan(2); // road bottom ≈ where the car rides (no float/gap)
    // The road spans (about) the full tunnel half-length on each side — a long passage, not a patch.
    const halfL = ZEN_LANDMARK.tunnelLength * tunnel.scale * 0.5;
    expect(maxAxial).toBeGreaterThan(halfL * 0.9);
  });

  it('the road descends with the floor — it is not flat (a real dip you drive down into)', () => {
    const { a } = spawnTunnel();
    const pos = a.floorMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    let minLocalY = Infinity, maxLocalY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      minLocalY = Math.min(minLocalY, y);
      maxLocalY = Math.max(maxLocalY, y);
    }
    // Local floor Y runs from ~0 at the mouths to ~−tunnelDepth at the deepest.
    expect(maxLocalY).toBeCloseTo(0, 1);
    expect(minLocalY).toBeLessThan(-ZEN_LANDMARK.tunnelDepth * 0.85);
  });
});

describe('Zen tunnel — VISUAL EVOLUTION (Stage 1: depth gradient) + DECOR (Stage 2a) — no surface impact', () => {
  function findTunnel() {
    for (let cz = 0; cz < 200; cz++) for (let cx = 0; cx < 200; cx++) {
      const lm = landmarkForCell(SEED, cx, cz);
      if (lm && lm.type === LANDMARK_TUNNEL) return lm;
    }
    throw new Error('no tunnel found');
  }
  const HALF_L = ZEN_LANDMARK.tunnelLength * 0.5; // local (shared geo is scale 1)
  /** Build a headless ZenLandmarks + return the shared tube geometry. */
  function tubeGeo() {
    const lms = new ZenLandmarks(new THREE.Scene(), SEED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (lms as any).geo[LANDMARK_TUNNEL] as THREE.BufferGeometry;
  }

  it('the tube has a per-vertex COLOUR gradient (white material + vertexColors), not a flat colour', () => {
    const tunnel = findTunnel();
    const scene = new THREE.Scene();
    const lms = new ZenLandmarks(scene, SEED);
    lms.update(tunnel.x, tunnel.z, TICK);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (lms as any).active.get(tunnel.id);
    expect(a.material.vertexColors).toBe(true);
    expect(a.material.color.getHex()).toBe(0xffffff); // white base — the gradient rides the vertices
    const col = a.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    expect(col).toBeTruthy();
    expect(col.count).toBe(a.mesh.geometry.getAttribute('position').count);
  });

  it('the gradient EVOLVES with depth: cyan-ish near the mouths → gold-ish at the deepest centre', () => {
    const geo = tubeGeo();
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    // Sample the gradient TUBE vertices (exclude the magenta decor + we look at ribs along z). For the
    // shallowest (|z|→halfL) and deepest (z→0) tube vertices, read the colour and compare hue.
    let shallow = { r: 0, g: 0, b: 0, az: -1 };
    let deep = { r: 0, g: 0, b: 0, az: HALF_L + 1 };
    for (let i = 0; i < pos.count; i++) {
      const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
      const isMagenta = r > 0.9 && g < 0.1 && b > 0.9; // skip decor crystals
      if (isMagenta) continue;
      const az = Math.abs(pos.getZ(i));
      if (az > shallow.az) shallow = { r, g, b, az };
      if (az < deep.az) deep = { r, g, b, az };
    }
    // Shallow (mouths) reads CYAN: blue/green dominate red. Deep (centre) reads GOLD: red dominates blue.
    expect(shallow.b).toBeGreaterThan(shallow.r);
    expect(shallow.g).toBeGreaterThan(shallow.r);
    expect(deep.r).toBeGreaterThan(deep.b); // gold/warm at the bottom (the glowing payoff end)
  });

  it('the ROAD stays cyan-readable (held toward cyan) even where the tube wall has gone gold', () => {
    // At the deepest centre, the floor vertex must stay cyan-dominant (b >= r), while the tube wall is
    // gold (r > b) — so the "drive here" ribbon never visually merges into the gold walls.
    const tunnel = findTunnel();
    const scene = new THREE.Scene();
    const lms = new ZenLandmarks(scene, SEED);
    lms.update(tunnel.x, tunnel.z, TICK);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (lms as any).active.get(tunnel.id);
    const fpos = a.floorMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const fcol = a.floorMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    // The deepest floor vertex (min local Y).
    let bi = 0, minY = Infinity;
    for (let i = 0; i < fpos.count; i++) if (fpos.getY(i) < minY) { minY = fpos.getY(i); bi = i; }
    expect(fcol.getZ(bi)).toBeGreaterThanOrEqual(fcol.getX(bi)); // road: blue >= red (cyan-held)
  });

  it('the reach-pulse STILL brightens the vertex-lit tube (scales material.color above white)', () => {
    const tunnel = findTunnel();
    const scene = new THREE.Scene();
    const lms = new ZenLandmarks(scene, SEED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const active = (lms as any).active as Map<number, any>;
    let maxR = 0;
    for (let i = 0; i < 120; i++) {
      lms.update(tunnel.x, tunnel.z, TICK); // parked on it → within reach → the glow runs
      const a = active.get(tunnel.id);
      if (a) maxR = Math.max(maxR, a.material.color.r);
    }
    // White baseline is 1.0; the glow scales it ABOVE white (gradient amplified → bloom flares it).
    expect(maxR).toBeGreaterThan(1.0);
  });

  it('DECORATIVE crystals are present (magenta) and sit ABOVE the road (never on the drive line)', () => {
    const geo = tubeGeo();
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    let decorCount = 0;
    let minClearance = Infinity; // smallest (vertex Y − local floor Y) over all decor vertices
    for (let i = 0; i < pos.count; i++) {
      const isMagenta = col.getX(i) > 0.9 && col.getY(i) < 0.1 && col.getZ(i) > 0.9;
      if (!isMagenta) continue;
      decorCount++;
      const y = pos.getY(i);
      const floorY = tunnelLocalFloorY(pos.getZ(i), HALF_L);
      minClearance = Math.min(minClearance, y - floorY);
    }
    expect(decorCount).toBeGreaterThan(0); // crystals exist in the tube geometry
    // Every decor vertex sits ABOVE the road surface — it's wall scenery you pass, not drive over.
    expect(minClearance).toBeGreaterThan(0.5);
  });
});
