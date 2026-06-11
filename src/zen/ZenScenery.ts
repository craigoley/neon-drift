/**
 * ZEN FREE-ROAM scenery (PR2) — the three.js INSTANCED renderer for the chunk-streamed
 * world. REUSES the existing Neon Drift prop meshes (palm / pole / city-block) via the
 * exported geometry builders in rendering/ParallaxScenery — we reuse the MESHES, not the
 * 1D distance streaming. The 2D grid + placement + load/cull is pure (ZenWorld); this
 * layer only mirrors the active prop set onto GPU instances.
 *
 * PERF (the real risk in 2D free-roam — far more world is exposed than the 1D corridor):
 *  - ONE InstancedMesh per prop kind → draw calls = number of kinds (a small bounded
 *    constant), never per-prop draws.
 *  - The active prop count is bounded by the chunk radius (ZenWorld), so each kind's
 *    instance pool is sized once and never grows.
 *  - Instance buffers are rebuilt only when the active chunk set CHANGES (a chunk-
 *    boundary crossing), not every frame — generation is amortized to crossings.
 *  - LOW quality swaps to the plain box pillar (same lever as ParallaxScenery).
 */

import * as THREE from 'three';
import { SCENERY, ZEN } from '../utils/constants';
import { fancyGeometry, plainGeometry } from '../rendering/ParallaxScenery';
import { ZenChunkField, maxActiveChunks } from './ZenWorld';
import { heightAt } from './ZenHeight';

export class ZenScenery {
  private readonly field: ZenChunkField;
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly fancyGeos: THREE.BufferGeometry[] = [];
  private readonly plainGeos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.MeshBasicMaterial[] = [];
  private readonly dummy = new THREE.Object3D();
  /** Per-kind active instance count (reset + refilled on each rebuild). */
  private readonly counts: number[] = [];
  private neon = true;
  /** Per-kind instance capacity (the bounded prop budget). */
  readonly capacity: number;

  constructor(scene: THREE.Scene) {
    const kinds = SCENERY.layers.length;
    this.field = new ZenChunkField(ZEN.worldSeed, ZEN.chunkRadius, kinds);
    // Worst case all active props are one kind, so size each kind's pool to the WHOLE
    // active budget. Draw calls stay = kinds (one InstancedMesh each) regardless.
    this.capacity = maxActiveChunks(ZEN.chunkRadius) * ZEN.propsPerChunk;

    for (const layer of SCENERY.layers) {
      const body = new THREE.Color(layer.color);
      const fancy = fancyGeometry(layer, body);
      const plain = plainGeometry(layer, body);
      // Same material recipe as ParallaxScenery: muted vertex colours, low opacity, fog
      // on (so distant props fade into the Zen haze and the cull boundary is hidden).
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: layer.opacity,
        fog: true,
      });
      const mesh = new THREE.InstancedMesh(fancy, mat, this.capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // The instance matrices span the active window, not the geometry bounds, so the
      // auto bounding sphere would wrongly cull the layer — disable culling (parity with
      // ParallaxScenery). The window is bounded around the camera.
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.fancyGeos.push(fancy);
      this.plainGeos.push(plain);
      this.mats.push(mat);
      this.meshes.push(mesh);
      this.counts.push(0);
      scene.add(mesh);
    }
  }

  /** Quality lever (parity with ParallaxScenery): HIGH = detailed silhouettes; LOW swaps
   *  every kind back to the plain box pillar (no extra geometry/fill). */
  setNeon(on: boolean): void {
    if (on === this.neon) return;
    this.neon = on;
    for (let i = 0; i < this.meshes.length; i++) {
      this.meshes[i].geometry = on ? this.fancyGeos[i] : this.plainGeos[i];
    }
  }

  /**
   * Stream the world to the car's position. Cheap on most frames (just a chunk-coord
   * compare inside the field); only rebuilds instance buffers when the active set
   * changes (a chunk crossing) — so generation never causes a per-frame cost.
   */
  update(carX: number, carZ: number): void {
    if (!this.field.update(carX, carZ)) return;
    this.counts.fill(0);
    this.field.forEachProp((p) => {
      const n = this.counts[p.kind];
      if (n >= this.capacity) return; // guard — sizing guarantees this won't trip
      // Sit each prop ON the terrain surface (PR3a) so it rests on the hills, not floats.
      this.dummy.position.set(p.x, heightAt(ZEN.worldSeed, p.x, p.z), p.z);
      this.dummy.rotation.set(0, p.rotationY, 0);
      this.dummy.scale.setScalar(p.scale);
      this.dummy.updateMatrix();
      this.meshes[p.kind].setMatrixAt(n, this.dummy.matrix);
      this.counts[p.kind] = n + 1;
    });
    for (let i = 0; i < this.meshes.length; i++) {
      this.meshes[i].count = this.counts[i];
      this.meshes[i].instanceMatrix.needsUpdate = true;
    }
  }

  /** Bounded active prop count (debug / perf funnel). */
  get activePropCount(): number {
    return this.field.activePropCount;
  }

  /** Draw-call family count = one InstancedMesh per kind (bounded constant). */
  get drawCallCount(): number {
    return this.meshes.length;
  }

  dispose(): void {
    for (const m of this.meshes) m.removeFromParent();
    for (const g of this.fancyGeos) g.dispose();
    for (const g of this.plainGeos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
