/**
 * Procedural player-car mesh — the shared low-poly synthwave vehicle used BOTH
 * in-game (VehicleRenderer) and in the car-picker preview (CarPreview), so the
 * geometry and the per-car cosmetic mapping live in exactly one place.
 *
 * Structure (all generated, NO imported models/textures):
 *   group                      outer transform (position = lateral)
 *   ├─ groundGlow              flat additive blob UNDER the car (stays flat —
 *   │                          sibling of chassis so body roll doesn't tilt it)
 *   └─ chassis                 the car itself (VehicleRenderer rolls/yaws THIS)
 *      ├─ hull mesh + edges    tapered wedge lower body (dark) + neon edge lines
 *      ├─ cabin mesh + edges   smaller raked greenhouse toward the rear
 *      ├─ 4 wheels + edges     octagonal prisms with glowing rims
 *      ├─ 2 side accent strips thin emissive lines in the accent colour
 *      ├─ 2 headlight quads    additive nose glow (accent)
 *      └─ forward cast quad    faint additive throw on the road ahead (accent)
 *
 * Cosmetic mapping (`applyCar`): body→hull/cabin/wheel fill, glow→all neon edge
 * lines + ground glow, accent→headlights + side strips. The whole edge material
 * is exposed so VehicleRenderer can lerp it toward the hot drift colour.
 *
 * Headlights/ground glow are PROPERLY transparent: additive blending, depthWrite
 * OFF, low opacity — so they read as light and never as the opaque triangles the
 * earlier headlight cones became (#13).
 *
 * Local frame: forward is -z, width is x, ground is y = 0 (wheels rest on it).
 */

import * as THREE from 'three';
import { CAR_GEO, CAR_VIS, PALETTE, type CarDef } from '../utils/constants';

/** A tapered hexahedron (lofted box): rear face wider than front, top inset. */
function taperedHull(
  rearHalfW: number,
  frontHalfW: number,
  halfLen: number,
  yBase: number,
  height: number,
  topInset: number,
): THREE.BufferGeometry {
  const topMul = 1 - topInset;
  const y0 = yBase;
  const y1 = yBase + height;
  // 8 corners: 0-3 bottom (rear-R, rear-L, front-L, front-R), 4-7 top (same order).
  // x: -half = right, +half = left. z: +halfLen = rear, -halfLen = front (nose).
  const v = [
    [-rearHalfW, y0, halfLen], // 0 rear-bottom-right
    [rearHalfW, y0, halfLen], // 1 rear-bottom-left
    [frontHalfW, y0, -halfLen], // 2 front-bottom-left
    [-frontHalfW, y0, -halfLen], // 3 front-bottom-right
    [-rearHalfW * topMul, y1, halfLen], // 4 rear-top-right
    [rearHalfW * topMul, y1, halfLen], // 5 rear-top-left
    [frontHalfW * topMul, y1, -halfLen], // 6 front-top-left
    [-frontHalfW * topMul, y1, -halfLen], // 7 front-top-right
  ];
  const idx = [
    0, 1, 2, 0, 2, 3, // bottom
    4, 6, 5, 4, 7, 6, // top
    1, 5, 6, 1, 6, 2, // left side
    0, 3, 7, 0, 7, 4, // right side
    0, 4, 5, 0, 5, 1, // rear
    3, 2, 6, 3, 6, 7, // front (nose)
  ];
  const pos: number[] = [];
  for (const [x, y, z] of v) pos.push(x, y, z);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** A faceted cabin: like the hull but with the front-top raked backward (a
 *  slanted windscreen) and a flat-ish roof. */
function cabin(
  halfW: number,
  halfLen: number,
  yBase: number,
  height: number,
  rake: number,
): THREE.BufferGeometry {
  const y0 = yBase;
  const y1 = yBase + height;
  const rakeZ = halfLen * 2 * rake; // front-top pulled back toward the rear
  const roofInset = halfW * 0.18;
  const v = [
    [-halfW, y0, halfLen], // 0 rear-bottom-right
    [halfW, y0, halfLen], // 1 rear-bottom-left
    [halfW, y0, -halfLen], // 2 front-bottom-left
    [-halfW, y0, -halfLen], // 3 front-bottom-right
    [-halfW + roofInset, y1, halfLen], // 4 rear-top-right
    [halfW - roofInset, y1, halfLen], // 5 rear-top-left
    [halfW - roofInset, y1, -halfLen + rakeZ], // 6 front-top-left (raked back)
    [-halfW + roofInset, y1, -halfLen + rakeZ], // 7 front-top-right
  ];
  const idx = [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    1, 5, 6, 1, 6, 2,
    0, 3, 7, 0, 7, 4,
    0, 4, 5, 0, 5, 1,
    3, 2, 6, 3, 6, 7,
  ];
  const pos: number[] = [];
  for (const [x, y, z] of v) pos.push(x, y, z);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export class CarMesh {
  /** Outer transform — VehicleRenderer sets position; ground glow stays flat. */
  readonly group = new THREE.Group();
  /** The car body — VehicleRenderer applies roll/yaw HERE, not on `group`, so
   *  the ground glow underneath never tilts with the lean. */
  readonly chassis = new THREE.Group();
  /** Neon edge lines material (shared by hull/cabin/wheel edges). Exposed so the
   *  in-game renderer can lerp it toward the hot drift colour. */
  readonly edgesMat: THREE.LineBasicMaterial;

  private readonly bodyMat: THREE.MeshBasicMaterial;
  private readonly accentLineMat: THREE.LineBasicMaterial;
  private readonly headlightMat: THREE.MeshBasicMaterial;
  private readonly groundGlowMat: THREE.MeshBasicMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor() {
    const { width, height, length } = CAR_VIS;
    const halfW = width / 2;
    const halfL = length / 2;
    const G = CAR_GEO;

    this.bodyMat = new THREE.MeshBasicMaterial({ color: PALETTE.deepPurple, side: THREE.DoubleSide });
    this.edgesMat = new THREE.LineBasicMaterial({ color: PALETTE.cyan });
    this.accentLineMat = new THREE.LineBasicMaterial({
      color: PALETTE.magenta,
      transparent: true,
      opacity: CAR_GEO.underglow.opacity,
    });
    this.headlightMat = new THREE.MeshBasicMaterial({
      color: PALETTE.magenta,
      transparent: true,
      opacity: G.headlights.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    this.groundGlowMat = new THREE.MeshBasicMaterial({
      color: PALETTE.cyan,
      transparent: true,
      opacity: G.groundGlow.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });

    const wheelR = height * G.wheels.radiusFraction;
    const rideHeight = wheelR * 0.55;

    // --- Lower hull (tapered wedge) ---
    const hullH = height * G.hull.heightFraction;
    const rearHW = halfW * G.hull.rearWidthFraction;
    const frontHW = halfW * G.hull.frontWidthFraction;
    const hullGeo = taperedHull(rearHW, frontHW, halfL, rideHeight, hullH, G.hull.topInsetFraction);
    this.addBody(hullGeo, 0);

    // --- Cabin (raked greenhouse, set back toward the rear) ---
    const hullTopY = rideHeight + hullH;
    const cabinHalfW = rearHW * (1 - G.hull.topInsetFraction) * G.cabin.widthFraction;
    const cabinHalfL = halfL * G.cabin.lengthFraction;
    const cabinH = height * G.cabin.heightFraction;
    const cabinZ = halfL * G.cabin.rearOffsetFraction; // + = toward rear
    const cabinGeo = cabin(cabinHalfW, cabinHalfL, hullTopY, cabinH, G.cabin.windshieldRake);
    this.addBody(cabinGeo, cabinZ);

    // --- Wheels (octagonal prisms with glowing rims) ---
    const wheelW = width * G.wheels.widthFraction;
    const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, wheelW, G.wheels.segments);
    wheelGeo.rotateZ(Math.PI / 2); // axle along x
    this.geometries.push(wheelGeo);
    const wheelEdgeGeo = new THREE.EdgesGeometry(wheelGeo);
    this.geometries.push(wheelEdgeGeo);
    const wx = halfW * (1 - G.wheels.lateralInset) - wheelW / 2;
    const wz = halfL * (1 - G.wheels.longitudinalInset);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const wheel = new THREE.Mesh(wheelGeo, this.bodyMat);
        wheel.position.set(sx * wx, wheelR, sz * wz);
        const rim = new THREE.LineSegments(wheelEdgeGeo, this.edgesMat);
        rim.position.copy(wheel.position);
        this.chassis.add(wheel, rim);
      }
    }

    // --- Side accent strips (thin emissive lines along the body) ---
    const stripY = rideHeight + hullH * 0.55;
    for (const sx of [-1, 1]) {
      const xRear = sx * rearHW * 0.98;
      const xFront = sx * frontHW * 0.98;
      const stripGeo = new THREE.BufferGeometry();
      stripGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [xRear, stripY, halfL * 0.96, xFront, stripY, -halfL * 0.96],
          3,
        ),
      );
      this.geometries.push(stripGeo);
      this.chassis.add(new THREE.LineSegments(stripGeo, this.accentLineMat));
    }

    // --- Headlights (additive nose quads) + forward cast ---
    const hlGeo = new THREE.PlaneGeometry(G.headlights.size, G.headlights.size);
    this.geometries.push(hlGeo);
    const hlY = height * G.headlights.heightFraction;
    for (const sx of [-1, 1]) {
      const hl = new THREE.Mesh(hlGeo, this.headlightMat);
      hl.position.set(sx * frontHW * G.headlights.lateralFraction, hlY, -halfL * 0.99);
      this.chassis.add(hl);
    }
    // Faint throw on the road just ahead of the nose (flat, additive).
    const castGeo = new THREE.PlaneGeometry(width * 1.1, length * 0.9);
    this.geometries.push(castGeo);
    const cast = new THREE.Mesh(castGeo, this.headlightMat);
    cast.rotation.x = -Math.PI / 2;
    cast.position.set(0, 0.02, -halfL - length * 0.45);
    this.chassis.add(cast);

    // --- Ground glow (flat blob under the car; sibling of chassis) ---
    const glowGeo = new THREE.CircleGeometry(width * G.groundGlow.radiusMul, 24);
    this.geometries.push(glowGeo);
    const groundGlow = new THREE.Mesh(glowGeo, this.groundGlowMat);
    groundGlow.rotation.x = -Math.PI / 2;
    groundGlow.scale.z = G.groundGlow.lengthMul;
    groundGlow.position.y = G.groundGlow.y;

    this.group.add(groundGlow, this.chassis);
  }

  /** Add a body mesh + its neon edge outline (sharing bodyMat/edgesMat), both
   *  shifted by `zOffset` along the length (so the cabin can sit toward the rear). */
  private addBody(geo: THREE.BufferGeometry, zOffset: number): THREE.Mesh {
    this.geometries.push(geo);
    const mesh = new THREE.Mesh(geo, this.bodyMat);
    mesh.position.z = zOffset;
    const edgeGeo = new THREE.EdgesGeometry(geo);
    this.geometries.push(edgeGeo);
    const edges = new THREE.LineSegments(edgeGeo, this.edgesMat);
    edges.position.z = zOffset;
    this.chassis.add(mesh, edges);
    return mesh;
  }

  /** Apply a car's cosmetic colours: body, neon glow (edges + ground), accent. */
  applyCar(car: CarDef): void {
    this.bodyMat.color.setHex(car.cosmetic.body);
    this.edgesMat.color.setHex(car.cosmetic.glow);
    this.groundGlowMat.color.setHex(car.cosmetic.glow);
    this.accentLineMat.color.setHex(car.cosmetic.accent);
    this.headlightMat.color.setHex(car.cosmetic.accent);
  }

  /** Free all owned geometry + materials (CarPreview calls this on teardown). */
  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.bodyMat.dispose();
    this.edgesMat.dispose();
    this.accentLineMat.dispose();
    this.headlightMat.dispose();
    this.groundGlowMat.dispose();
  }
}
