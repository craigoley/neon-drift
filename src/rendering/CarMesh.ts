/**
 * Procedural player-car mesh — the shared low-poly synthwave vehicle used BOTH
 * in-game (VehicleRenderer) and in the car-picker preview (CarPreview), so the
 * geometry and the per-car cosmetic mapping live in exactly one place.
 *
 * Each car has its OWN silhouette (see CarShape / `shape` in CARS): the builder
 * is parameterized per car so the geometry telegraphs the handling — speed cars
 * are long/low/sharp-nosed, grip cars wide/planted/blunt, drift cars short/tall/
 * compact. The collision box is STILL CAR_VIS for every car (gameplay fairness
 * lives in `handling`); only the visual shape changes.
 *
 * Structure (all generated, NO imported models/textures):
 *   group                      outer transform (position = lateral)
 *   ├─ groundGlow              flat additive blob UNDER the car (stays flat —
 *   │                          sibling of chassis so body roll doesn't tilt it)
 *   └─ chassis                 the car itself (VehicleRenderer rolls/yaws THIS)
 *      ├─ hull mesh + edges    tapered wedge lower body + neon edge lines
 *      ├─ cabin mesh + edges   smaller raked greenhouse toward the rear
 *      ├─ 4 wheels + edges     octagonal prisms with glowing rims
 *      └─ 2 side accent strips thin emissive lines in the accent colour
 *
 * Cosmetic mapping (`applyCar`): body→hull/cabin/wheel fill, glow→all neon edge
 * lines + ground glow, accent→side strips. `applyCar` ALSO rebuilds the geometry
 * when the car's shape changes (car-switch only — never per frame), keeping the
 * `chassis`/`group` and material references stable so VehicleRenderer.sync keeps
 * working. The edge material is exposed so the renderer can lerp it toward the
 * hot drift colour.
 *
 * The ground glow is PROPERLY transparent: additive blending, depthWrite OFF,
 * low opacity. There are deliberately NO headlights — forward light cones/quads
 * regressed into opaque artifacts twice (#13, #42), so they were cut entirely.
 *
 * Local frame: forward is -z, width is x, ground is y = 0 (wheels rest on it).
 */

import * as THREE from 'three';
import { BASE_CAR_SHAPE, CAR_GEO, CAR_VIS, GHOST, PALETTE, carShape, type CarDef, type CarDetail, type CarShape } from '../utils/constants';

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
  const roofInset = halfW * CAR_GEO.cabin.roofInsetFraction;
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
  private readonly groundGlowMat: THREE.MeshBasicMaterial;
  /** HERO taillight bar — a bright additive emissive bar that catches the bloom. */
  private readonly taillightMat: THREE.MeshBasicMaterial;
  /** Shape-independent ground-glow geometry (disposed only on full dispose). */
  private readonly groundGlowGeo: THREE.BufferGeometry;
  /** Geometry owned by the CURRENT silhouette — freed + replaced on a reshape. */
  private geometries: THREE.BufferGeometry[] = [];
  /** The shape the chassis geometry was last built for (skip rebuild if same). */
  private builtShape: CarShape;
  /** Render detail the chassis was last built for ('hero' = player, 'simple' = rival). */
  private builtDetail: CarDetail;

  constructor(car?: CarDef, detail: CarDetail = 'hero') {
    this.bodyMat = new THREE.MeshBasicMaterial({ color: PALETTE.deepPurple, side: THREE.DoubleSide });
    this.edgesMat = new THREE.LineBasicMaterial({ color: PALETTE.cyan });
    this.accentLineMat = new THREE.LineBasicMaterial({
      color: PALETTE.magenta,
      transparent: true,
      opacity: CAR_GEO.sideStrips.opacity,
    });
    this.taillightMat = new THREE.MeshBasicMaterial({
      color: PALETTE.cyan,
      transparent: true,
      opacity: CAR_GEO.taillight.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.groundGlowMat = new THREE.MeshBasicMaterial({
      color: PALETTE.cyan,
      transparent: true,
      opacity: CAR_GEO.groundGlow.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });

    // Ground glow: built once (shape-independent), a sibling of the chassis so a
    // reshape never touches it and body roll never tilts it.
    this.groundGlowGeo = new THREE.CircleGeometry(
      CAR_VIS.width * CAR_GEO.groundGlow.radiusMul,
      CAR_GEO.groundGlow.segments,
    );
    const groundGlow = new THREE.Mesh(this.groundGlowGeo, this.groundGlowMat);
    groundGlow.rotation.x = -Math.PI / 2;
    groundGlow.scale.z = CAR_GEO.groundGlow.lengthMul;
    groundGlow.position.y = CAR_GEO.groundGlow.y;
    this.group.add(groundGlow, this.chassis);

    // Build the chassis for this car's silhouette + detail, then apply its colours.
    const shape = car ? carShape(car) : BASE_CAR_SHAPE;
    this.builtShape = shape;
    this.builtDetail = detail;
    this.applyGlowIntensity();
    this.build(shape, detail);
    if (car) this.applyColours(car);
  }

  /** Build the chassis for a silhouette + detail. HERO (player) = hull + cabin +
   *  wheels + side strips + the bright taillight bar (the full glowing supercar).
   *  SIMPLE (rival / LOW player) = the tapered hull wedge + its neon edges ONLY — a
   *  stripped, schematic, cheaper silhouette that's clearly "the other car". Clears
   *  any previous chassis geometry first. */
  private build(shape: CarShape, detail: CarDetail): void {
    const width = CAR_VIS.width * shape.widthMul;
    const height = CAR_VIS.height * shape.heightMul;
    const length = CAR_VIS.length * shape.lengthMul;
    const halfW = width / 2;
    const halfL = length / 2;
    const G = CAR_GEO;

    const wheelR = height * G.wheels.radiusFraction * shape.wheelRadiusMul;
    const rideHeight = wheelR * G.wheels.rideHeightFraction;

    // --- Lower hull (tapered wedge; nose width = shape.noseFraction of rear) — both ---
    const hullH = height * G.hull.heightFraction;
    const rearHW = halfW * G.hull.rearWidthFraction;
    const frontHW = halfW * shape.noseFraction;
    const hullGeo = taperedHull(rearHW, frontHW, halfL, rideHeight, hullH, G.hull.topInsetFraction);
    this.addBody(hullGeo, 0);

    // SIMPLE rival stops here: a clean low-poly neon wedge (no cabin/wheels/strips/
    // taillight) — cheaper to render and never confusable with the hero.
    if (detail !== 'hero') return;

    // --- Cabin (raked greenhouse, set back toward the rear) ---
    const hullTopY = rideHeight + hullH;
    const cabinHalfW = rearHW * (1 - G.hull.topInsetFraction) * G.cabin.widthFraction;
    const cabinHalfL = halfL * shape.cabinLengthFraction;
    const cabinH = height * shape.cabinHeightFraction;
    const cabinZ = halfL * shape.cabinRearOffset; // + = toward rear
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
    const stripY = rideHeight + hullH * G.sideStrips.heightFraction;
    for (const sx of [-1, 1]) {
      const xRear = sx * rearHW * G.sideStrips.lateralFraction;
      const xFront = sx * frontHW * G.sideStrips.lateralFraction;
      const stripGeo = new THREE.BufferGeometry();
      const stripZ = halfL * G.sideStrips.longitudinalFraction;
      stripGeo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([xRear, stripY, stripZ, xFront, stripY, -stripZ], 3),
      );
      this.geometries.push(stripGeo);
      this.chassis.add(new THREE.LineSegments(stripGeo, this.accentLineMat));
    }

    // --- HERO taillight bar: a bright additive bar across the rear in the glow
    // colour — the signature outrun rear light. A SOLID bright surface (unlike the
    // 1px edge lines), so it catches the bloom (#95) and the player car reads as a
    // glowing neon supercar. (Rear-only — headlights were cut, #13/#42.)
    const T = G.taillight;
    const barW = rearHW * 2 * T.widthFraction;
    const barGeo = new THREE.BoxGeometry(barW, T.height, T.depth);
    this.geometries.push(barGeo);
    const taillight = new THREE.Mesh(barGeo, this.taillightMat);
    taillight.position.set(0, height * T.yFraction, halfL);
    this.chassis.add(taillight);
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

  /** Remove the current chassis meshes and dispose their geometry (keeps the
   *  shared materials, the chassis group, and the ground glow). Used before
   *  rebuilding a new shape. Each geometry is tracked in `this.geometries`. */
  private clearChassis(): void {
    this.chassis.clear();
    for (const g of this.geometries) g.dispose();
    this.geometries = [];
  }

  /** Switch render detail (hero ⇄ simple) — e.g. the player drops to 'simple' on LOW
   *  quality, or the rival is built 'simple'. Rebuilds the chassis only on a change. */
  setDetail(detail: CarDetail): void {
    if (detail === this.builtDetail) return;
    this.builtDetail = detail;
    this.applyGlowIntensity();
    this.clearChassis();
    this.build(this.builtShape, detail);
  }

  /** Hero gets a brighter underglow than the rival (visual focus on the player). */
  private applyGlowIntensity(): void {
    this.groundGlowMat.opacity =
      CAR_GEO.groundGlow.opacity * (this.builtDetail === 'hero' ? CAR_GEO.heroGroundGlowMul : 1);
  }

  /** Apply a car's cosmetic colours AND silhouette. Colours are always set;
   *  geometry is rebuilt only when the car's shape differs from the current one
   *  (car-switch / picker-cycle — never per frame). */
  applyCar(car: CarDef): void {
    const shape = carShape(car);
    if (shape !== this.builtShape) {
      this.clearChassis();
      this.build(shape, this.builtDetail);
      this.builtShape = shape;
    }
    this.applyColours(car);
  }

  /** Re-style this mesh as the translucent RIVAL GHOST: a distinct cool colour +
   *  low opacity so it reads clearly as a phantom, not the player. Keeps the car's
   *  recorded SILHOUETTE (built from its shape) but overrides colours/opacity.
   *  depthWrite off on the translucent body avoids sorting artifacts over the road. */
  applyGhostStyle(): void {
    this.bodyMat.color.setHex(GHOST.bodyColor);
    this.bodyMat.transparent = true;
    this.bodyMat.opacity = GHOST.bodyOpacity;
    this.bodyMat.depthWrite = false;
    this.edgesMat.color.setHex(GHOST.glowColor);
    this.edgesMat.transparent = true;
    this.edgesMat.opacity = GHOST.edgeOpacity;
    this.accentLineMat.color.setHex(GHOST.accentColor);
    this.accentLineMat.opacity = GHOST.edgeOpacity;
    this.groundGlowMat.color.setHex(GHOST.glowColor);
    this.groundGlowMat.opacity = GHOST.bodyOpacity * 0.5;
  }

  /** Fade the ghost further once its recording has ended (still faintly visible as
   *  it recedes behind the still-running player). */
  setGhostEnded(): void {
    this.bodyMat.opacity = GHOST.endedOpacity;
    this.edgesMat.opacity = GHOST.endedOpacity;
    this.accentLineMat.opacity = GHOST.endedOpacity;
    this.groundGlowMat.opacity = GHOST.endedOpacity * 0.5;
  }

  /** Set the material colours from a car's cosmetic (no geometry work). */
  private applyColours(car: CarDef): void {
    this.bodyMat.color.setHex(car.cosmetic.body);
    this.edgesMat.color.setHex(car.cosmetic.glow);
    this.groundGlowMat.color.setHex(car.cosmetic.glow);
    this.taillightMat.color.setHex(car.cosmetic.glow); // hero taillight tinted per car
    this.accentLineMat.color.setHex(car.cosmetic.accent);
  }

  /** Free all owned geometry + materials (CarPreview calls this on teardown). */
  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.groundGlowGeo.dispose();
    this.bodyMat.dispose();
    this.edgesMat.dispose();
    this.accentLineMat.dispose();
    this.taillightMat.dispose();
    this.groundGlowMat.dispose();
  }
}
