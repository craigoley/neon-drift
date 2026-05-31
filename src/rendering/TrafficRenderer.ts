/**
 * Renders typed traffic obstacles. Three.js layer: READS the pure pool and never
 * mutates it. No per-frame allocation (reused scratch Object3D + cursors).
 *
 * One InstancedMesh per visual family, all sharing a single GREYSCALE unit-box
 * geometry (body faces dimmed, top + leading edge bright) that is TINTED per
 * instance via instanceColor — so the hot-rim readability is preserved while
 * each kind gets its intent colour:
 *   - boxMesh   → STATIC (orange) + MOVER (hot red): the classic dodge boxes.
 *   - gateMesh  → GATE barriers: two bars per gate flanking a passable opening.
 *   - rampMesh  → RAMP: a low, wide green boost-strip you aim FOR.
 *
 * Colours are intent-coded (warm = threat, green = beneficial), matching the
 * powerup language.
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

/** A unit BoxGeometry (1×1×1) with vertex colours: body = bodyShade grey, the
 *  top (+y) and leading (+z) faces = white. Tinted per instance. */
function greyscaleEdgeBox(): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const shade = TRAFFIC_VIS.bodyShade;
  // BoxGeometry face order: +x,-x,+y,-y,+z,-z (4 verts each); +y = 8..11, +z = 16..19.
  const colors = new Float32Array(24 * 3);
  for (let v = 0; v < 24; v++) {
    const bright = (v >= 8 && v <= 11) || (v >= 16 && v <= 19);
    const c = bright ? 1 : shade;
    colors[v * 3] = c;
    colors[v * 3 + 1] = c;
    colors[v * 3 + 2] = c;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export class TrafficRenderer {
  private readonly boxMesh: THREE.InstancedMesh;
  private readonly gateMesh: THREE.InstancedMesh;
  private readonly rampMesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  // Cached per-kind tint colours (no per-frame allocation).
  private readonly cStatic = new THREE.Color(OBSTACLE_DEFS.static.color);
  private readonly cMover = new THREE.Color(OBSTACLE_DEFS.mover.color);
  private readonly cGate = new THREE.Color(OBSTACLE_DEFS.gate.color);
  private readonly cRamp = new THREE.Color(OBSTACLE_DEFS.ramp.color);
  /** Shared material across all three meshes; its `color` is a global multiplier
   *  used for a faint biome tint (default white = no tint). */
  private readonly material: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    const geo = greyscaleEdgeBox();
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.material = mat;

    // Boxes: at most one per pool slot. Gates: up to two bars per slot.
    this.boxMesh = new THREE.InstancedMesh(geo, mat, TRAFFIC.poolSize);
    this.gateMesh = new THREE.InstancedMesh(geo, mat, TRAFFIC.poolSize * 2);
    this.rampMesh = new THREE.InstancedMesh(geo, mat, TRAFFIC.poolSize);
    for (const m of [this.boxMesh, this.gateMesh, this.rampMesh]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
    }
  }

  /** Faint biome cast applied to ALL obstacles (multiplies their intent colours).
   *  Kept subtle by the caller so threats stay orange/red, ramps green. */
  setTint(color: THREE.Color): void {
    this.material.color.copy(color);
  }

  /** Position active obstacles by kind; collapse unused instances. Car at z = 0,
   *  ahead is -z (same mapping as everything else). */
  sync(traffic: TrafficState, playerDistance: number): void {
    let boxN = 0;
    let gateN = 0;
    let rampN = 0;

    for (const o of traffic.pool) {
      if (!o.active) continue;
      const z = -(o.distance - playerDistance);

      switch (o.kind) {
        case ObstacleKind.Static:
        case ObstacleKind.Mover:
          this.place(this.boxMesh, boxN, o.lateral, TRAFFIC_VIS.meshY, z, TRAFFIC.halfWidth * 2, TRAFFIC_VIS.meshHeight, TRAFFIC.halfLength * 2);
          this.boxMesh.setColorAt(boxN, o.kind === ObstacleKind.Mover ? this.cMover : this.cStatic);
          boxN++;
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

    this.collapseTail(this.boxMesh, boxN);
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

  /** Compose a box transform into instance `i` (unit geometry scaled to size). */
  private place(
    mesh: THREE.InstancedMesh,
    i: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ): void {
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
