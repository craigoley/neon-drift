/**
 * ZEN SKY-SLIDE MESH — the three.js layer that builds the enclosed neon TUBE + floor the car rides
 * on the Vista Sky-Slide. Swept in WORLD space along the pure ZenSlidePath centreline (the slide is
 * anchored to one launch vista, so world-space is simplest). The cross-section mirrors the tunnel's
 * arched ribs + railed floor (reused aesthetic: gold tube, cyan road, bloom-lit, fog:false), but the
 * arch always opens to WORLD-UP (no roll) — the car + camera bank within it, the tube stays level, so
 * a fast twist reads cleanly. Built once on launch, disposed on landing.
 */

import * as THREE from 'three';
import { ZEN_SLIDE } from '../utils/constants';
import { ZenSlidePath } from './ZenSlidePath';

function lineGeo(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return g;
}

function neonMat(colorHex: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 1,
    fog: false, // reads through the haze, like the landmark beacons
    depthWrite: false,
  });
}

/** Build the slide's tube + floor as a disposable Group, swept along the path centreline. */
export function buildSlideMesh(path: ZenSlidePath): THREE.Group {
  const hw = ZEN_SLIDE.tubeHalfWidth;
  const head = ZEN_SLIDE.tubeHeadroom;
  const arcN = ZEN_SLIDE.arcSegments;
  const rings = Math.max(2, Math.ceil(path.length / ZEN_SLIDE.ringSpacing));

  const tube: number[] = [];
  const floor: number[] = [];
  const seg = (buf: number[], ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
    buf.push(ax, ay, az, bx, by, bz);

  // Per-ring world frame: centre on the path, "side" = the horizontal perpendicular to the XZ tangent,
  // "up" = world up. (No roll — the tube stays level; the car banks inside it.)
  let prevRib: Array<[number, number, number]> | null = null;
  let prevApex: [number, number, number] | null = null;
  let prevFloor: { lx: number; ly: number; lz: number; rx: number; ry: number; rz: number } | null = null;

  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    const c = path.pointAt(u);
    const cx = c.x;
    const cy = c.y;
    const cz = c.z;
    const t = path.tangentAt(u);
    // Horizontal perpendicular to the tangent (rotate the XZ tangent 90°), normalized.
    let sx = t.z;
    let sz = -t.x;
    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl;
    sz /= sl;

    // Arched rib: floor-left → up over the top → floor-right (arch opens to world-up).
    const rib: Array<[number, number, number]> = [];
    for (let k = 0; k <= arcN; k++) {
      const a = Math.PI * (k / arcN); // 0..π
      const off = -Math.cos(a) * hw; // −hw (left) .. +hw (right)
      rib.push([cx + sx * off, cy + Math.sin(a) * head, cz + sz * off]);
    }
    // Lateral rib line.
    for (let k = 0; k < rib.length - 1; k++) {
      seg(tube, rib[k][0], rib[k][1], rib[k][2], rib[k + 1][0], rib[k + 1][1], rib[k + 1][2]);
    }
    // Longitudinal apex line (tube ridge).
    const apex: [number, number, number] = [cx, cy + head, cz];
    if (prevApex) seg(tube, prevApex[0], prevApex[1], prevApex[2], apex[0], apex[1], apex[2]);
    prevApex = apex;
    // A couple of longitudinal wall lines (left + right shoulders) for tube definition.
    if (prevRib) {
      const left = 0;
      const right = rib.length - 1;
      seg(tube, prevRib[left][0], prevRib[left][1], prevRib[left][2], rib[left][0], rib[left][1], rib[left][2]);
      seg(tube, prevRib[right][0], prevRib[right][1], prevRib[right][2], rib[right][0], rib[right][1], rib[right][2]);
    }
    prevRib = rib;

    // Floor: left rail, right rail, centre, + a lateral rung (the cyan road underfoot).
    const lx = cx - sx * hw;
    const lz = cz - sz * hw;
    const rx = cx + sx * hw;
    const rz = cz + sz * hw;
    if (prevFloor) {
      seg(floor, prevFloor.lx, prevFloor.ly, prevFloor.lz, lx, cy, lz);
      seg(floor, prevFloor.rx, prevFloor.ry, prevFloor.rz, rx, cy, rz);
      seg(floor, prevFloor.lx, prevFloor.ly, prevFloor.lz, cx, cy, cz); // rough centre-ish ridge
    }
    seg(floor, lx, cy, lz, rx, cy, rz); // lateral rung
    prevFloor = { lx, ly: cy, lz, rx, ry: cy, rz };
  }

  const group = new THREE.Group();
  group.add(new THREE.LineSegments(lineGeo(tube), neonMat(ZEN_SLIDE.tubeColor)));
  group.add(new THREE.LineSegments(lineGeo(floor), neonMat(ZEN_SLIDE.floorColor)));
  return group;
}

/** Dispose a slide group's geometries + materials (the Group itself is just removed from the scene). */
export function disposeSlideMesh(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  }
}
