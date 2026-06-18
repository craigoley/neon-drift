/**
 * ZEN TUNNEL CAVERN MESH — the three.js layer that builds the BEAUTIFUL tunnel payoff space: a vast
 * amber/gold cavern of neon line-work standing on the EXISTING ground (anchored via the pure layout's
 * heightAt baseY — no terrain sculpting, no drivable-surface change). A centerpiece spire straight
 * ahead of the arrival, monuments scattered to drive around, a distant enclosing pillar shell + an
 * overhead ceiling dome for the "huge enclosed space" awe, and a bright cyan halo on the return portal
 * so the way back reads. Built ONCE (bounded), shown only while inside the tunnel space (setActive).
 * Bloom-lit (#128); fog:false so the gold reads across the amber haze (like the landmark beacons).
 */

import * as THREE from 'three';
import { ZEN_TUNNEL_CAVERN } from '../utils/constants';
import { tunnelReturnPortal } from './ZenTunnelPayoff';
import { cavernLayout, type CavernStructure } from './ZenCavernLayout';
import { heightAt } from './ZenHeight';

/** Accumulates line segments per colour, then bakes one LineSegments per colour (few draw calls). */
class LineBucket {
  private readonly byColor = new Map<number, number[]>();
  private buf(color: number): number[] {
    let b = this.byColor.get(color);
    if (!b) { b = []; this.byColor.set(color, b); }
    return b;
  }
  seg(color: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    this.buf(color).push(ax, ay, az, bx, by, bz);
  }
  /** A closed horizontal ring (polygon) at height y, centred (cx, cz), radius r, yaw rot. */
  ring(color: number, cx: number, y: number, cz: number, r: number, segs: number, rot = 0): void {
    let px = cx + Math.cos(rot) * r;
    let pz = cz + Math.sin(rot) * r;
    for (let i = 1; i <= segs; i++) {
      const a = rot + (i / segs) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      this.seg(color, px, y, pz, x, y, z);
      px = x; pz = z;
    }
  }
  /** Build a Group of LineSegments (one per colour). Each material is bloom-friendly + fog-free. */
  build(): THREE.Group {
    const g = new THREE.Group();
    for (const [color, positions] of this.byColor) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, fog: false, depthWrite: false });
      const mesh = new THREE.LineSegments(geo, mat);
      mesh.frustumCulled = false;
      g.add(mesh);
    }
    return g;
  }
}

/** A vertical faceted obelisk/spire: a base ring + a (smaller) top ring + vertical edges + an apex. */
function obelisk(b: LineBucket, color: number, s: CavernStructure, segs: number): void {
  const topR = s.radius * 0.35;
  const topY = s.baseY + s.height;
  const apexY = topY + s.height * 0.18;
  b.ring(color, s.x, s.baseY, s.z, s.radius, segs, s.rot);
  b.ring(color, s.x, topY, s.z, topR, segs, s.rot);
  for (let i = 0; i < segs; i++) {
    const a = s.rot + (i / segs) * Math.PI * 2;
    const bx = s.x + Math.cos(a) * s.radius, bz = s.z + Math.sin(a) * s.radius;
    const tx = s.x + Math.cos(a) * topR, tz = s.z + Math.sin(a) * topR;
    b.seg(color, bx, s.baseY, bz, tx, topY, tz); // vertical edge
    b.seg(color, tx, topY, tz, s.x, apexY, s.z); // converge to the apex (a crowned spire)
  }
}

export class ZenCavern {
  private readonly scene: THREE.Scene;
  private readonly group: THREE.Group;
  /** The cavern centre the geometry is built around (world x/z; the flat build puts every structure at
   *  y = 0). Placement is a rigid Group translation off this centre — see placeAtFloor. */
  private readonly centerX: number;
  private readonly centerZ: number;

  constructor(scene: THREE.Scene, seed: number) {
    this.scene = scene;
    const C = ZEN_TUNNEL_CAVERN;
    const portal = tunnelReturnPortal(seed);
    // Build the cavern on a FLAT floor (baseY = 0): the deep basin floor it now stands on is dead-flat,
    // and a flat build lets the whole cavern be RE-PLACED at the active tunnel's deep centre with a
    // single Group translation (placeAtFloor) — for the drive-down (default) and the warp fallback alike.
    const layout = cavernLayout(seed, portal, 0);
    this.centerX = layout.center.x;
    this.centerZ = layout.center.z;
    const amber = C.amberPalette;
    const b = new LineBucket();

    // CENTERPIECE: a tall tapering spire (stacked shrinking rings + vertical edges + apex) on a halo.
    const cen = layout.center;
    const gold = amber[0];
    b.ring(gold, cen.x, cen.baseY + 0.5, cen.z, C.centerpieceHaloRadius, C.centerpieceSegments); // base halo
    let prevR: number = C.centerpieceBaseRadius;
    let prevY: number = cen.baseY;
    for (let r = 1; r <= C.centerpieceRings; r++) {
      const f = r / C.centerpieceRings;
      const y = cen.baseY + f * C.centerpieceHeight;
      const rad = C.centerpieceBaseRadius * (1 - 0.85 * f);
      b.ring(gold, cen.x, y, cen.z, rad, C.centerpieceSegments);
      for (let i = 0; i < C.centerpieceSegments; i++) {
        const a = (i / C.centerpieceSegments) * Math.PI * 2;
        b.seg(gold, cen.x + Math.cos(a) * prevR, prevY, cen.z + Math.sin(a) * prevR, cen.x + Math.cos(a) * rad, y, cen.z + Math.sin(a) * rad);
      }
      prevR = rad; prevY = y;
    }
    b.seg(gold, cen.x, prevY, cen.z, cen.x, cen.baseY + C.centerpieceHeight * 1.16, cen.z); // crowning point

    // MONUMENTS: scattered obelisks to drive toward + carve around (varied amber hues).
    for (const m of layout.monuments) obelisk(b, amber[m.hue], m, C.monumentSegments);

    // ENCLOSING SHELL: a far ring of tall thin pillars (a vertical line + a couple of cross rings).
    for (const p of layout.shell) {
      b.seg(amber[2], p.x, p.baseY, p.z, p.x, p.baseY + p.height, p.z);
      b.ring(amber[2], p.x, p.baseY + p.height * 0.5, p.z, p.radius, C.shellPillarSegments);
      b.ring(amber[2], p.x, p.baseY + p.height, p.z, p.radius * 0.6, C.shellPillarSegments);
    }

    // CEILING DOME overhead (latitude rings + meridian arcs converging to an apex) — the cavern "roof".
    const apexY = cen.baseY + C.ceilingHeight;
    const rimY = cen.baseY + C.ceilingHeight * 0.45;
    for (let r = 1; r <= C.ceilingRings; r++) {
      const f = r / (C.ceilingRings + 1);
      b.ring(amber[1], cen.x, rimY + (apexY - rimY) * f, cen.z, C.ceilingRadius * (1 - f), C.ceilingSegments);
    }
    for (let m = 0; m < C.ceilingMeridians; m++) {
      const a = (m / C.ceilingMeridians) * Math.PI * 2;
      let px = cen.x + Math.cos(a) * C.ceilingRadius, pz = cen.z + Math.sin(a) * C.ceilingRadius, py = rimY;
      for (let s = 1; s <= C.ceilingMeridianSteps; s++) {
        const t = s / C.ceilingMeridianSteps;
        const rr = C.ceilingRadius * (1 - t);
        const x = cen.x + Math.cos(a) * rr, z = cen.z + Math.sin(a) * rr, y = rimY + (apexY - rimY) * t;
        b.seg(amber[1], px, py, pz, x, y, z);
        px = x; pz = z; py = y;
      }
    }

    // RETURN-PORTAL marker: a bright cyan halo + uprights at the portal, so the way back READS.
    b.ring(C.portalMarkerColor, portal.x, layout.center.baseY + 1, portal.z, C.portalMarkerRadius, C.portalMarkerSegments);
    for (let i = 0; i < C.portalMarkerUprights; i++) {
      const a = (i / C.portalMarkerUprights) * Math.PI * 2;
      const mx = portal.x + Math.cos(a) * C.portalMarkerRadius, mz = portal.z + Math.sin(a) * C.portalMarkerRadius;
      b.seg(C.portalMarkerColor, mx, layout.center.baseY + 1, mz, mx, layout.center.baseY + C.portalMarkerHeight, mz);
    }

    this.group = b.build();
    this.group.visible = false; // shown only while inside the tunnel space
    // Default placement = the WARP fallback's home: the far region at its terrain surface (the flat
    // build sat at y = 0). The drive-down (default) re-places it per-tunnel via placeAtFloor.
    this.group.position.y = heightAt(seed, this.centerX, this.centerZ);
    this.scene.add(this.group);
  }

  /** Show / hide the cavern (driven by ZenRenderer.setTunnelSecret). */
  setActive(active: boolean): void {
    this.group.visible = active;
  }

  /** RE-PLACE the cavern so its centre (the centerpiece) sits at world (x, z) on a floor at height y —
   *  a rigid translation of the flat-built geometry. The DRIVE-DOWN (Stage C1) calls this with the
   *  active tunnel's deep centre + the cross-anchored deep basin floor Y, so the cavern stands ON the
   *  basin you drive onto; the warp fallback calls it with the far region's surface Y (its original
   *  home). Y-only translation keeps the dead-flat floor flat. */
  placeAtFloor(x: number, z: number, y: number): void {
    this.group.position.set(x - this.centerX, y, z - this.centerZ);
  }

  /** Read-only child count (the bounded-growth canary for the validation sweep). */
  get meshCount(): number {
    return this.group.children.length;
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const child of this.group.children) {
      const mesh = child as THREE.LineSegments;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}
