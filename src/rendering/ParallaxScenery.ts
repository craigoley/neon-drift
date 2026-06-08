/**
 * Roadside parallax scenery: layered neon props (near pylons, mid light-poles,
 * far city blocks) that stream past to sell speed and depth. Three.js layer —
 * READS the travelled distance, never mutates game state.
 *
 * BOUNDED POOL: one InstancedMesh per layer, sized once to `count * 2` (a prop
 * on each side of the road). Each frame every instance is repositioned by pure
 * index math (utils/parallax.ts) into a fixed streaming window — the active
 * instance count is CONSTANT for any distance, and nothing is allocated per
 * frame. Props sit well outside ROAD.halfWidth and are cyan/magenta-coded (never
 * the orange threat hue), and they fade with the scene fog into the horizon.
 */

import * as THREE from 'three';
import { SCENERY, type SceneryLayer } from '../utils/constants';
import { parallaxRenderZ } from '../utils/parallax';

export class ParallaxScenery {
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly geos: THREE.BoxGeometry[] = [];
  private readonly mats: THREE.MeshBasicMaterial[] = [];
  private readonly dummy = new THREE.Object3D();
  /** Total instances across all layers — constant; exposed for the debug funnel. */
  readonly activeCount: number;

  constructor(scene: THREE.Scene) {
    let total = 0;
    for (const layer of SCENERY.layers) {
      // Unit-tall box anchored at its base (y in [0, height]); fog:true so the
      // props melt into the horizon haze with distance.
      const geo = new THREE.BoxGeometry(layer.width, layer.height, layer.width);
      geo.translate(0, layer.height / 2, 0);
      const mat = new THREE.MeshBasicMaterial({
        color: layer.color,
        transparent: true,
        opacity: layer.opacity,
        fog: true,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, layer.count * 2);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Disable frustum culling (matching TrafficRenderer / SpeedLines /
      // Starfield): an InstancedMesh's auto bounding sphere is derived from the
      // GEOMETRY (one box at the origin), not the instance matrices — which here
      // span z ∈ [-640, 160] — so leaving culling on can wrongly cull the whole
      // layer depending on camera orientation. The streaming window is bounded
      // and always near the camera, so skipping the cull test is cheap + correct.
      mesh.frustumCulled = false;
      this.geos.push(geo);
      this.mats.push(mat);
      this.meshes.push(mesh);
      scene.add(mesh);
      total += layer.count * 2;
    }
    this.activeCount = total;
  }

  /** Reposition every prop into its streaming slot for the given travelled
   *  distance. `roadCenter` is the road's lateral centre at the player's distance
   *  (roadCenterAt) — the props are anchored to the ROAD, not the camera/player, so
   *  they never slide onto the road when the player drives to an edge (a camera/
   *  player-lateral anchor put the opposite-side props on the road at the edges). */
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
    // parallaxRenderZ returns camera-relative z already (negative = ahead, the
    // three.js −z convention shared by every other renderer), so assign it
    // directly to position.z — no extra negation.
    const z = parallaxRenderZ(distance, layer.parallax, layer.gap, index, SCENERY.behind);
    // Lateral anchor = the ROAD centre (offsetX is well outside ROAD.halfWidth), so
    // props sit beside the road regardless of where the player is across it.
    this.dummy.position.set(roadCenter + side * layer.offsetX, SCENERY.baseY, z);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(n, this.dummy.matrix);
  }

  /** Free GPU resources (parity with the other renderers; called on teardown). */
  dispose(): void {
    for (const m of this.meshes) m.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
