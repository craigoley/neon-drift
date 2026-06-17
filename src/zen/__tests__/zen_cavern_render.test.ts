/**
 * Zen TUNNEL CAVERN — RENDER-OBJECT tests (headless: geometry/material/group, no WebGL). The cavern is
 * the beautiful payoff space; pixels can't be unit-tested, but the render objects can: it's added to
 * the scene, hidden until you warp in, holds the centerpiece + monuments, and stays BOUNDED (one region,
 * built once). It is purely decorative neon line-work — no drivable surface (proven elsewhere).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ZenCavern } from '../ZenCavern';
import { tunnelReturnPortal } from '../ZenTunnelPayoff';
import { cavernLayout } from '../ZenCavernLayout';
import { ZEN, ZEN_TUNNEL_CAVERN } from '../../utils/constants';

const SEED = ZEN.worldSeed;

describe('Zen cavern — the render group (built once, hidden until you warp in, bounded)', () => {
  it('is added to the scene and starts HIDDEN (shown only inside the tunnel space)', () => {
    const scene = new THREE.Scene();
    const cavern = new ZenCavern(scene, SEED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const group = (cavern as any).group as THREE.Group;
    expect(scene.children).toContain(group);
    expect(group.visible).toBe(false);
  });

  it('setActive toggles visibility (the warp reveals it; returning hides it)', () => {
    const cavern = new ZenCavern(new THREE.Scene(), SEED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const group = (cavern as any).group as THREE.Group;
    cavern.setActive(true);
    expect(group.visible).toBe(true);
    cavern.setActive(false);
    expect(group.visible).toBe(false);
  });

  it('holds neon line meshes (centerpiece + monuments + shell + ceiling + portal marker), BOUNDED', () => {
    const cavern = new ZenCavern(new THREE.Scene(), SEED);
    expect(cavern.meshCount).toBeGreaterThan(0);
    expect(cavern.meshCount).toBeLessThan(12); // a few colour buckets — not unbounded
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const group = (cavern as any).group as THREE.Group;
    let verts = 0;
    let hasCyanMarker = false;
    for (const child of group.children) {
      const mesh = child as THREE.LineSegments;
      verts += (mesh.geometry.getAttribute('position') as THREE.BufferAttribute).count;
      if ((mesh.material as THREE.LineBasicMaterial).color.getHex() === ZEN_TUNNEL_CAVERN.portalMarkerColor) hasCyanMarker = true;
    }
    expect(verts).toBeGreaterThan(0);
    expect(verts).toBeLessThan(20000); // one region, built once — comfortably bounded (mobile-safe)
    expect(hasCyanMarker).toBe(true); // the return-portal marker is present (the way back reads)
  });

  it('the centerpiece geometry stands at the cavern centre, rising tall off the ground', () => {
    const cavern = new ZenCavern(new THREE.Scene(), SEED);
    const layout = cavernLayout(SEED, tunnelReturnPortal(SEED));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const group = (cavern as any).group as THREE.Group;
    let near = 0;
    let maxY = -Infinity;
    for (const child of group.children) {
      const pos = (child as THREE.LineSegments).geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const dx = pos.getX(i) - layout.center.x;
        const dz = pos.getZ(i) - layout.center.z;
        if (Math.hypot(dx, dz) < ZEN_TUNNEL_CAVERN.centerpieceHaloRadius + 1) {
          near++;
          maxY = Math.max(maxY, pos.getY(i));
        }
      }
    }
    expect(near).toBeGreaterThan(0); // there IS structure at the centre
    // It rises near the full centerpiece height (a tall spire, the awe landmark).
    expect(maxY - layout.center.baseY).toBeGreaterThan(ZEN_TUNNEL_CAVERN.centerpieceHeight * 0.9);
  });
});
