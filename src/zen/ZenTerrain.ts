/**
 * ZEN FREE-ROAM terrain (PR3a) — the three.js heightmap surface, drawn as the synthwave
 * NEON WIREFRAME draped over the rolling hills (the iconic grid look, now with relief).
 *
 * One windowed LineSegments grid spanning the active chunk window, its vertices sampled
 * from the continuous heightAt(x, z). Chunks SEAM automatically because the height comes
 * from world coords, not per-chunk state. Perf choice: ONE mesh (a single draw call)
 * rebuilt only on chunk-boundary CROSSINGS — rather than N per-chunk meshes (N draw
 * calls). Between crossings the surface is static and world-correct; the far edge sits
 * in heavy fog, so the recenter at a crossing is invisible (same trick as the props).
 */

import * as THREE from 'three';
import { ZEN } from '../utils/constants';
import { worldToChunk } from './ZenWorld';
import { heightAt } from './ZenHeight';

export class ZenTerrain {
  private readonly seed: number;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mesh: THREE.LineSegments;
  private readonly mat: THREE.LineBasicMaterial;
  private readonly positions: Float32Array;
  /** Lattice heights reused each rebuild (no per-rebuild allocation). */
  private readonly heights: Float32Array;
  /** Cells per side of the windowed grid = (2R+1) chunks × segments-per-chunk. */
  private readonly gridN: number;
  private readonly segSize: number;
  private carCx = NaN;
  private carCz = NaN;

  constructor(scene: THREE.Scene, seed: number) {
    this.seed = seed;
    const window = 2 * ZEN.chunkRadius + 1;
    this.gridN = window * ZEN.terrainSegmentsPerChunk;
    this.segSize = ZEN.chunkSize / ZEN.terrainSegmentsPerChunk;

    const N = this.gridN;
    // 2·(N+1)·N grid-line segments (horizontals + verticals), 2 verts each, xyz each.
    const segCount = 2 * (N + 1) * N;
    this.positions = new Float32Array(segCount * 2 * 3);
    this.heights = new Float32Array((N + 1) * (N + 1));
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    this.mat = new THREE.LineBasicMaterial({
      color: ZEN.gridColor,
      transparent: true,
      opacity: ZEN.terrainOpacity,
      fog: true,
    });
    this.mesh = new THREE.LineSegments(this.geo, this.mat);
    // The window spans far beyond the geometry's origin-based bounds; skip frustum cull
    // (it's bounded around the camera and fades into fog at the edge).
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Recenter + rebuild the surface when the car crosses into a new chunk (cheap rest of
   *  the time — a chunk-coord compare). */
  update(carX: number, carZ: number): void {
    const cx = worldToChunk(carX, ZEN.chunkSize);
    const cz = worldToChunk(carZ, ZEN.chunkSize);
    if (cx === this.carCx && cz === this.carCz) return;
    this.carCx = cx;
    this.carCz = cz;
    this.rebuild(cx, cz);
  }

  private rebuild(cx: number, cz: number): void {
    const N = this.gridN;
    const stride = N + 1;
    const seg = this.segSize;
    const originX = (cx - ZEN.chunkRadius) * ZEN.chunkSize;
    const originZ = (cz - ZEN.chunkRadius) * ZEN.chunkSize;

    // Sample the continuous height at every lattice point once.
    const h = this.heights;
    for (let j = 0; j <= N; j++) {
      const wz = originZ + j * seg;
      for (let i = 0; i <= N; i++) {
        h[j * stride + i] = heightAt(this.seed, originX + i * seg, wz);
      }
    }

    // Emit grid-line segments referencing the sampled heights.
    const pos = this.positions;
    let p = 0;
    for (let j = 0; j <= N; j++) {
      const wz = originZ + j * seg;
      for (let i = 0; i < N; i++) {
        pos[p++] = originX + i * seg;
        pos[p++] = h[j * stride + i];
        pos[p++] = wz;
        pos[p++] = originX + (i + 1) * seg;
        pos[p++] = h[j * stride + i + 1];
        pos[p++] = wz;
      }
    }
    for (let i = 0; i <= N; i++) {
      const wx = originX + i * seg;
      for (let j = 0; j < N; j++) {
        pos[p++] = wx;
        pos[p++] = h[j * stride + i];
        pos[p++] = originZ + j * seg;
        pos[p++] = wx;
        pos[p++] = h[(j + 1) * stride + i];
        pos[p++] = originZ + (j + 1) * seg;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
  }

  /** Vertex count of the line buffer (perf funnel). */
  get vertexCount(): number {
    return this.positions.length / 3;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
