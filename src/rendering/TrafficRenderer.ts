/**
 * Renders typed traffic obstacles. Three.js layer: READS the pure pool and never
 * mutates it. No per-frame allocation (reused scratch Object3D + cursors).
 *
 * DETAIL VIA SHAPE, not glow (course-correction from #99): each obstacle KIND has
 * its own SHARED, instanced geometry whose silhouette reads as a believable object
 * — a flared road BARRIER (static), a low VEHICLE with a cabin (mover), a capped
 * GATE post (gate bars), and a rising boost WEDGE (ramp). One InstancedMesh per
 * family, so the draw-call count stays tiny; the richer geometry is baked once and
 * costs only vertices (cheap at scale), with per-face vertex shading standing in
 * for form. The #99 bloom-catching neon edge wireframe is GONE — no glow fill.
 *
 * Every geometry is authored in a normalized [-0.5,0.5]^3 cube and instance-scaled
 * to the obstacle's collision footprint, so a more-detailed shape NEVER exceeds the
 * hitbox (the visual stays within the same halfWidth×halfLength bounds the sim
 * collides against). Bodies are tinted per instance (warm = threat, green =
 * beneficial), matching the powerup colour language.
 *
 * Quality lever: HIGH uses the detailed geometries; LOW swaps every family to a
 * plain shaded box (cheapest) — a geometry-reference swap, same draw calls.
 */

import * as THREE from 'three';
import type { Obstacle, TrafficState } from '../game/Traffic';
import {
  GATE,
  OBSTACLE_DEFS,
  ObstacleKind,
  RAMP,
  ROAD,
  TRAFFIC,
  TRAFFIC_VIS,
} from '../utils/constants';

type Vec3 = readonly [number, number, number];

/** Accumulates flat-shaded triangles (position + per-vertex grey) into a single
 *  BufferGeometry. Built ONCE per shape at construction — never per frame. The
 *  material is DoubleSide, so face winding doesn't matter (these are small opaque
 *  instanced objects with no additive overdraw — winding-proof, fill-cheap). */
class Shaper {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];

  /** A quad p0→p1→p2→p3 at a uniform shade (two triangles). */
  quad(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, shade: number): void {
    this.tri(p0, p1, p2, shade);
    this.tri(p0, p2, p3, shade);
  }

  private tri(a: Vec3, b: Vec3, c: Vec3, shade: number): void {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 9; i++) this.col.push(shade); // 3 verts × rgb, flat grey
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

const S = TRAFFIC_VIS;
/** Per-face shades reused across the shapes. Sides reuse `bodyShade`. */
const SH = { top: S.shadeTop, front: S.shadeFront, back: S.shadeBack, bottom: S.shadeBottom, side: S.bodyShade };

/** Append an axis-aligned box [x0,x1]×[y0,y1]×[z0,z1] with per-face shading. */
function addBox(s: Shaper, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
  s.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], SH.top); // +y
  s.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], SH.bottom); // -y
  s.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], SH.front); // +z
  s.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], SH.back); // -z
  s.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], SH.side); // +x
  s.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], SH.side); // -x
}

/** LOW / fallback: a plain shaded unit box (the pre-detail look). */
function buildSimpleBox(): THREE.BufferGeometry {
  const s = new Shaper();
  addBox(s, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5);
  return s.geometry();
}

/** STATIC: a flared road barrier — full-width base tapering to an inset top. */
function buildBarrier(): THREE.BufferGeometry {
  const s = new Shaper();
  const tx = S.barrierTopHalfX;
  const tz = S.barrierTopHalfZ;
  const b = 0.5;
  // Top cap + flat base.
  s.quad([-tx, b, tz], [tx, b, tz], [tx, b, -tz], [-tx, b, -tz], SH.top);
  s.quad([-b, -b, -b], [b, -b, -b], [b, -b, b], [-b, -b, b], SH.bottom);
  // Four sloped sides (base rect → inset top rect).
  s.quad([-b, -b, b], [b, -b, b], [tx, b, tz], [-tx, b, tz], SH.front); // +z
  s.quad([b, -b, -b], [-b, -b, -b], [-tx, b, -tz], [tx, b, -tz], SH.back); // -z
  s.quad([b, -b, b], [b, -b, -b], [tx, b, -tz], [tx, b, tz], SH.side); // +x
  s.quad([-b, -b, -b], [-b, -b, b], [-tx, b, tz], [-tx, b, -tz], SH.side); // -x
  return s.geometry();
}

/** MOVER: a low vehicle — a body slab with a set-back cabin (greenhouse). */
function buildVehicle(): THREE.BufferGeometry {
  const s = new Shaper();
  addBox(s, -0.5, 0.5, -0.5, S.vehicleBodyTopY, -0.5, 0.5); // body
  addBox(s, -S.vehicleCabinHalfX, S.vehicleCabinHalfX, S.vehicleBodyTopY, S.vehicleCabinTopY, S.vehicleCabinZ0, S.vehicleCabinZ1); // cabin
  return s.geometry();
}

/** GATE bar: a capped barrier post — vertical body + a chamfered top cap. */
function buildPost(): THREE.BufferGeometry {
  const s = new Shaper();
  const b = 0.5;
  const sh = S.postShoulderY;
  const cap = S.postCapHalf;
  addBox(s, -b, b, -b, sh, -b, b); // body up to the shoulder
  // Chamfered cap: shoulder rect → inset top rect.
  s.quad([-cap, b, cap], [cap, b, cap], [cap, b, -cap], [-cap, b, -cap], SH.top);
  s.quad([-b, sh, b], [b, sh, b], [cap, b, cap], [-cap, b, cap], SH.front); // +z
  s.quad([b, sh, -b], [-b, sh, -b], [-cap, b, -cap], [cap, b, -cap], SH.back); // -z
  s.quad([b, sh, b], [b, sh, -b], [cap, b, -cap], [cap, b, cap], SH.side); // +x
  s.quad([-b, sh, -b], [-b, sh, b], [-cap, b, cap], [-cap, b, -cap], SH.side); // -x
  return s.geometry();
}

/** RAMP: a rising wedge — low lip at the near (+z) edge, full height at the far
 *  (-z) edge, so it reads as a launch ramp you drive up. */
function buildRamp(): THREE.BufferGeometry {
  const s = new Shaper();
  const b = 0.5;
  const lip = S.rampLipY;
  s.quad([-b, -b, -b], [b, -b, -b], [b, -b, b], [-b, -b, b], SH.bottom); // base
  s.quad([-b, lip, b], [b, lip, b], [b, b, -b], [-b, b, -b], SH.top); // sloped face
  s.quad([b, b, -b], [-b, b, -b], [-b, -b, -b], [b, -b, -b], SH.back); // far wall (-z)
  s.quad([-b, -b, b], [b, -b, b], [b, lip, b], [-b, lip, b], SH.front); // near lip (+z)
  s.quad([b, -b, b], [b, -b, -b], [b, b, -b], [b, lip, b], SH.side); // +x
  s.quad([-b, -b, -b], [-b, -b, b], [-b, lip, b], [-b, b, -b], SH.side); // -x
  return s.geometry();
}

export class TrafficRenderer {
  private readonly staticMesh: THREE.InstancedMesh;
  private readonly moverMesh: THREE.InstancedMesh;
  private readonly gateMesh: THREE.InstancedMesh;
  private readonly rampMesh: THREE.InstancedMesh;
  /** Detailed silhouette per family (HIGH) + a shared plain box (LOW). Kept so the
   *  quality lever can swap a mesh's geometry by reference (no rebuild). */
  private readonly detail: Map<THREE.InstancedMesh, THREE.BufferGeometry> = new Map();
  private readonly simpleBox: THREE.BufferGeometry;

  private readonly dummy = new THREE.Object3D();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  // Cached per-kind tint colours (no per-frame allocation).
  private readonly cStatic = new THREE.Color(OBSTACLE_DEFS.static.color);
  private readonly cMover = new THREE.Color(OBSTACLE_DEFS.mover.color);
  private readonly cGate = new THREE.Color(OBSTACLE_DEFS.gate.color);
  private readonly cRamp = new THREE.Color(OBSTACLE_DEFS.ramp.color);
  /** Shared material across all families; its `color` is a global multiplier used
   *  for a faint biome tint (default white = no tint). DoubleSide so the hand-built
   *  silhouettes are winding-proof (small opaque instances → negligible fill). */
  private readonly material: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.simpleBox = buildSimpleBox();

    // STATIC and MOVER are now separate families (barrier vs vehicle silhouettes);
    // gates emit up to two bars per slot. Each family is one InstancedMesh.
    this.staticMesh = new THREE.InstancedMesh(buildBarrier(), this.material, TRAFFIC.poolSize);
    this.moverMesh = new THREE.InstancedMesh(buildVehicle(), this.material, TRAFFIC.poolSize);
    this.gateMesh = new THREE.InstancedMesh(buildPost(), this.material, TRAFFIC.poolSize * 2);
    this.rampMesh = new THREE.InstancedMesh(buildRamp(), this.material, TRAFFIC.poolSize);
    for (const m of [this.staticMesh, this.moverMesh, this.gateMesh, this.rampMesh]) {
      this.detail.set(m, m.geometry);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
    }
  }

  /** Quality lever: HIGH (on) uses the detailed silhouettes; LOW (off) swaps every
   *  family to the plain shaded box (cheapest) — a geometry-reference swap, so the
   *  draw-call count is unchanged and there's no rebuild. */
  setDetail(on: boolean): void {
    for (const [mesh, geo] of this.detail) mesh.geometry = on ? geo : this.simpleBox;
  }

  /** Faint biome cast applied to ALL obstacles (multiplies their intent colours).
   *  Kept subtle by the caller so threats stay orange/red, ramps green. */
  setTint(color: THREE.Color): void {
    this.material.color.copy(color);
  }

  /** Position active obstacles by kind; collapse unused instances. Car at z = 0,
   *  ahead is -z (same mapping as everything else). */
  sync(traffic: TrafficState, playerDistance: number): void {
    let staticN = 0;
    let moverN = 0;
    let gateN = 0;
    let rampN = 0;

    for (const o of traffic.pool) {
      if (!o.active) continue;
      const z = -(o.distance - playerDistance);

      switch (o.kind) {
        case ObstacleKind.Static:
          this.place(this.staticMesh, staticN, o.lateral, TRAFFIC_VIS.meshY, z, TRAFFIC.halfWidth * 2, TRAFFIC_VIS.meshHeight, TRAFFIC.halfLength * 2);
          this.staticMesh.setColorAt(staticN, this.cStatic);
          staticN++;
          break;
        case ObstacleKind.Mover:
          this.place(this.moverMesh, moverN, o.lateral, TRAFFIC_VIS.meshY, z, TRAFFIC.halfWidth * 2, TRAFFIC_VIS.meshHeight, TRAFFIC.halfLength * 2);
          this.moverMesh.setColorAt(moverN, this.cMover);
          moverN++;
          break;
        case ObstacleKind.Gate:
          gateN = this.placeGateBars(o, z, gateN);
          break;
        case ObstacleKind.Ramp:
          this.place(this.rampMesh, rampN, o.lateral, TRAFFIC_VIS.rampY, z, RAMP.halfWidth * 2, TRAFFIC_VIS.rampHeight, RAMP.halfLength * 2);
          this.rampMesh.setColorAt(rampN, this.cRamp);
          rampN++;
          break;
      }
    }

    this.collapseTail(this.staticMesh, staticN);
    this.collapseTail(this.moverMesh, moverN);
    this.collapseTail(this.gateMesh, gateN);
    this.collapseTail(this.rampMesh, rampN);
  }

  /** Emit a gate's two barrier bars (left + right of the opening); returns the
   *  next free gate-mesh instance index. A bar narrower than the min is skipped
   *  (opening sits at a road edge). */
  private placeGateBars(o: Obstacle, z: number, gateN: number): number {
    // Road centre is recoverable without the seed: lateral = centre + laneOffset
    // (the opening fits on the road, so it is never clamped).
    const center = o.lateral - o.laneOffset;
    const leftEdge = center - ROAD.halfWidth;
    const rightEdge = center + ROAD.halfWidth;
    const openL = o.lateral - o.openingHalfWidth;
    const openR = o.lateral + o.openingHalfWidth;
    const depth = GATE.halfLength * 2;

    const leftW = openL - leftEdge;
    if (leftW > TRAFFIC_VIS.gateMinBarWidth) {
      this.place(this.gateMesh, gateN, (leftEdge + openL) / 2, TRAFFIC_VIS.gateY, z, leftW, TRAFFIC_VIS.gateHeight, depth);
      this.gateMesh.setColorAt(gateN, this.cGate);
      gateN++;
    }
    const rightW = rightEdge - openR;
    if (rightW > TRAFFIC_VIS.gateMinBarWidth) {
      this.place(this.gateMesh, gateN, (openR + rightEdge) / 2, TRAFFIC_VIS.gateY, z, rightW, TRAFFIC_VIS.gateHeight, depth);
      this.gateMesh.setColorAt(gateN, this.cGate);
      gateN++;
    }
    return gateN;
  }

  /** Compose an instance transform (normalized geometry scaled to the footprint).
   *  The geometry is authored within [-0.5,0.5]^3, so scaling by (sx,sy,sz) maps it
   *  exactly onto the collision footprint — the detail never exceeds the hitbox. */
  private place(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    this.dummy.position.set(x, y, z);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.set(sx, sy, sz);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(i, this.dummy.matrix);
  }

  /** Collapse instances [from, capacity) to zero scale and flush the buffers. */
  private collapseTail(mesh: THREE.InstancedMesh, from: number): void {
    for (let i = from; i < mesh.count; i++) mesh.setMatrixAt(i, this.hidden);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
