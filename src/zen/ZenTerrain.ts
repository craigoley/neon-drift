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
 *
 * RAMP TINT: vertices on a ramp/dune lerp the grid colour toward rampTintColor by their
 * ramp height, so a launch spot reads as an inviting glowing dune you can aim for.
 */

import * as THREE from 'three';
import { ZEN } from '../utils/constants';
import { clamp } from '../utils/math';
import { worldToChunk } from './ZenWorld';
import { heightAt, rampContribution } from './ZenHeight';

export class ZenTerrain {
  private readonly seed: number;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mesh: THREE.LineSegments;
  private readonly mat: THREE.LineBasicMaterial;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  /** Lattice heights + ramp amounts (0..1) reused each rebuild (no per-rebuild allocation). */
  private readonly heights: Float32Array;
  private readonly rampAmt: Float32Array;
  /** Grid + ramp-tint colours as plain RGB (no per-vertex Color allocation). */
  private readonly grid = new THREE.Color(ZEN.gridColor);
  private readonly tint = new THREE.Color(ZEN.rampTintColor);
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
    this.colors = new Float32Array(segCount * 2 * 3);
    this.heights = new Float32Array((N + 1) * (N + 1));
    this.rampAmt = new Float32Array((N + 1) * (N + 1));
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    this.mat = new THREE.LineBasicMaterial({
      vertexColors: true, // grid colour, tinting toward rampTintColor on ramp surfaces
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

    // Sample the continuous height + ramp amount at every lattice point once.
    const h = this.heights;
    const ra = this.rampAmt;
    for (let j = 0; j <= N; j++) {
      const wz = originZ + j * seg;
      for (let i = 0; i <= N; i++) {
        const wx = originX + i * seg;
        const idx = j * stride + i;
        h[idx] = heightAt(this.seed, wx, wz);
        ra[idx] = clamp(rampContribution(this.seed, wx, wz) / ZEN.rampHeight, 0, 1);
      }
    }

    const pos = this.positions;
    const col = this.colors;
    const gr = this.grid.r, gg = this.grid.g, gb = this.grid.b;
    const tr = this.tint.r, tg = this.tint.g, tb = this.tint.b;
    let p = 0;
    // Write one vertex: position (wx, height[li], wz) + grid→tint colour by rampAmt[li].
    const vert = (wx: number, wz: number, li: number): void => {
      const a = ra[li];
      pos[p] = wx;
      pos[p + 1] = h[li];
      pos[p + 2] = wz;
      col[p] = gr + (tr - gr) * a;
      col[p + 1] = gg + (tg - gg) * a;
      col[p + 2] = gb + (tb - gb) * a;
      p += 3;
    };

    for (let j = 0; j <= N; j++) {
      const wz = originZ + j * seg;
      for (let i = 0; i < N; i++) {
        vert(originX + i * seg, wz, j * stride + i);
        vert(originX + (i + 1) * seg, wz, j * stride + i + 1);
      }
    }
    for (let i = 0; i <= N; i++) {
      const wx = originX + i * seg;
      for (let j = 0; j < N; j++) {
        vert(wx, originZ + j * seg, j * stride + i);
        vert(wx, originZ + (j + 1) * seg, (j + 1) * stride + i);
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
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
