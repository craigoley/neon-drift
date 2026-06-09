/**
 * Roadside parallax scenery: layered neon props (near PALMS, mid light-poles, far city
 * blocks) that stream past to sell speed and depth. Three.js layer — READS the travelled
 * distance, never mutates game state.
 *
 * BOUNDED POOL: one InstancedMesh per layer, sized once to `count * 2` (a prop on each
 * side of the road). Each frame every instance is repositioned by pure index math
 * (utils/parallax.ts) into a fixed streaming window — the active instance count is
 * CONSTANT for any distance, and nothing is allocated per frame.
 *
 * DETAIL (HIGH): each layer uses a richer SHARED geometry (palm silhouette / light-pole +
 * lamp cap / city block + windows) built once — still ONE instanced draw call per layer,
 * no extra meshes. Bodies keep their MUTED colour + low opacity so decor stays QUIETER
 * than the orange/red hazards (BUG-01); only tiny accents (lamp cap, windows) are bright.
 * LOW (the #95/#98 quality lever) swaps back to the plain box pillar.
 */

import * as THREE from 'three';
import { SCENERY, type SceneryLayer } from '../utils/constants';
import { parallaxRenderZ } from '../utils/parallax';

/** The 12 triangles of a unit box (indices into its 8 corners), for emitting box faces. */
const BOX_TRIS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 2, 1], [0, 3, 2], // -z
  [4, 5, 6], [4, 6, 7], // +z
  [0, 4, 7], [0, 7, 3], // -x
  [1, 2, 6], [1, 6, 5], // +x
  [0, 1, 5], [0, 5, 4], // -y
  [3, 7, 6], [3, 6, 2], // +y
];

/** Append an axis-aligned box (centre c, half-sizes h) in `color` to the buffers. */
function pushBox(
  pos: number[], col: number[],
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
  color: THREE.Color,
): void {
  const corners = [
    [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz],
    [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz],
    [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz],
  ];
  for (const tri of BOX_TRIS) {
    for (const idx of tri) {
      pos.push(corners[idx][0], corners[idx][1], corners[idx][2]);
      col.push(color.r, color.g, color.b);
    }
  }
}

/** Append a single triangle (a, b, c) in `color`. */
function pushTri(
  pos: number[], col: number[],
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  color: THREE.Color,
): void {
  pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  for (let i = 0; i < 3; i++) col.push(color.r, color.g, color.b);
}

/** Build a vertex-coloured BufferGeometry from accumulated positions/colours. */
function geometryFrom(pos: number[], col: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

/** Today's plain box pillar (LOW fallback) — anchored base at y = 0, muted body. */
function plainGeometry(layer: SceneryLayer, body: THREE.Color): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  pushBox(pos, col, 0, layer.height / 2, 0, layer.width / 2, layer.height / 2, layer.width / 2, body);
  return geometryFrom(pos, col);
}

/** Near layer — an outrun PALM silhouette: a thin trunk + a fan of frond triangles, all
 *  in the muted body colour (a recognisable shape, not a glowing thing). */
function palmGeometry(layer: SceneryLayer, body: THREE.Color): THREE.BufferGeometry {
  const P = SCENERY.detail.palm;
  const pos: number[] = [];
  const col: number[] = [];
  const trunkH = layer.height * P.trunkHeightFrac;
  const hw = P.trunkWidth / 2;
  pushBox(pos, col, 0, trunkH / 2, 0, hw, trunkH / 2, hw, body);
  // Frond fan radiating from the crown (planar — faces the road as the prop approaches).
  const L = layer.height * P.frondLenFrac;
  for (const [dx, dy] of P.frondTips) {
    pushTri(
      pos, col,
      -P.frondHalfWidth, trunkH, 0,
      P.frondHalfWidth, trunkH, 0,
      dx * L, trunkH + dy * L, 0,
      body,
    );
  }
  return geometryFrom(pos, col);
}

/** Mid layer — a thin light-pole + a SMALL bright lamp cap (the only bright bit). */
function poleGeometry(layer: SceneryLayer, body: THREE.Color): THREE.BufferGeometry {
  const Q = SCENERY.detail.pole;
  const pos: number[] = [];
  const col: number[] = [];
  const shaftH = layer.height * Q.shaftHeightFrac;
  const sw = (layer.width * Q.shaftWidthFrac) / 2;
  pushBox(pos, col, 0, shaftH / 2, 0, sw, shaftH / 2, sw, body);
  const cap = new THREE.Color(Q.capColor);
  const cw = (layer.width * Q.capWidthFrac) / 2;
  pushBox(pos, col, 0, shaftH + Q.capHeight / 2, 0, cw, Q.capHeight / 2, cw, cap);
  return geometryFrom(pos, col);
}

/** Far layer — a city block + a few DIM window dots (subtle; it's background haze). */
function blockGeometry(layer: SceneryLayer, body: THREE.Color): THREE.BufferGeometry {
  const B = SCENERY.detail.block;
  const pos: number[] = [];
  const col: number[] = [];
  const hw = layer.width / 2;
  pushBox(pos, col, 0, layer.height / 2, 0, hw, layer.height / 2, hw, body);
  const win = new THREE.Color(B.windowColor);
  const s = B.windowSize / 2;
  const zf = hw + B.windowZOffset;
  for (const [xf, yf] of B.windows) {
    const x = xf * hw;
    const y = yf * layer.height;
    pushTri(pos, col, x - s, y - s, zf, x + s, y - s, zf, x + s, y + s, zf, win);
    pushTri(pos, col, x - s, y - s, zf, x + s, y + s, zf, x - s, y + s, zf, win);
  }
  return geometryFrom(pos, col);
}

/** Build the HIGH 'fancy' geometry for a layer kind. */
function fancyGeometry(layer: SceneryLayer, body: THREE.Color): THREE.BufferGeometry {
  switch (layer.kind) {
    case 'pylon':
      return palmGeometry(layer, body);
    case 'pole':
      return poleGeometry(layer, body);
    default:
      return blockGeometry(layer, body);
  }
}

export class ParallaxScenery {
  private readonly meshes: THREE.InstancedMesh[] = [];
  /** Both geometry sets per layer (HIGH 'fancy' + LOW 'plain'); swapped by setNeon. */
  private readonly fancyGeos: THREE.BufferGeometry[] = [];
  private readonly plainGeos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.MeshBasicMaterial[] = [];
  private readonly dummy = new THREE.Object3D();
  private neon = true;
  /** Total instances across all layers — constant; exposed for the debug funnel. */
  readonly activeCount: number;

  constructor(scene: THREE.Scene) {
    let total = 0;
    for (const layer of SCENERY.layers) {
      const body = new THREE.Color(layer.color);
      const fancy = fancyGeometry(layer, body);
      const plain = plainGeometry(layer, body);
      // vertexColors: the muted body + small bright accents are baked per-vertex; the
      // material's low opacity keeps the WHOLE prop (accents included) subordinate.
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: layer.opacity,
        fog: true,
      });
      const mesh = new THREE.InstancedMesh(fancy, mat, layer.count * 2);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Disable frustum culling (matching TrafficRenderer / SpeedLines / Starfield): an
      // InstancedMesh's auto bounding sphere is derived from the GEOMETRY, not the
      // instance matrices (which span the streaming window), so leaving culling on can
      // wrongly cull the whole layer. The window is bounded + near the camera.
      mesh.frustumCulled = false;
      this.fancyGeos.push(fancy);
      this.plainGeos.push(plain);
      this.mats.push(mat);
      this.meshes.push(mesh);
      scene.add(mesh);
      total += layer.count * 2;
    }
    this.activeCount = total;
  }

  /** Quality lever (#95/#98): HIGH = the detailed silhouettes; LOW swaps every layer back
   *  to the plain box pillar (today's look — no extra geometry/fill). */
  setNeon(on: boolean): void {
    if (on === this.neon) return;
    this.neon = on;
    for (let i = 0; i < this.meshes.length; i++) {
      this.meshes[i].geometry = on ? this.fancyGeos[i] : this.plainGeos[i];
    }
  }

  /** Reposition every prop into its streaming slot for the given travelled distance.
   *  `roadCenter` is the road's lateral centre at the player's distance — props are
   *  anchored to the ROAD (not the camera) so they never slide onto it at the edges. */
  update(distance: number, roadCenter: number): void {
    for (let li = 0; li < SCENERY.layers.length; li++) {
      const layer = SCENERY.layers[li];
      const mesh = this.meshes[li];
      let n = 0;
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < layer.count; i++) {
          this.placeProp(mesh, n++, layer, i, side, distance, roadCenter);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private placeProp(
    mesh: THREE.InstancedMesh,
    n: number,
    layer: SceneryLayer,
    index: number,
    side: number,
    distance: number,
    roadCenter: number,
  ): void {
    // parallaxRenderZ returns camera-relative z already (negative = ahead).
    const z = parallaxRenderZ(distance, layer.parallax, layer.gap, index, SCENERY.behind);
    this.dummy.position.set(roadCenter + side * layer.offsetX, SCENERY.baseY, z);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(n, this.dummy.matrix);
  }

  /** Free GPU resources (parity with the other renderers; called on teardown). */
  dispose(): void {
    for (const m of this.meshes) m.removeFromParent();
    for (const g of this.fancyGeos) g.dispose();
    for (const g of this.plainGeos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
