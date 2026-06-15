/**
 * DIAGNOSTIC ONLY (throwaway, diag/* branch) — trace the #131 tunnel beacon + minimap chevron
 * RENDER PATH, and measure the real-world encounter rate. NOT a fix, NOT to merge.
 */
import { describe, it } from 'vitest';
import * as THREE from 'three';
import { ZenLandmarks } from '../ZenLandmarks';
import { heightAt } from '../ZenHeight';
import {
  landmarkForCell,
  landmarksInRadius,
  LANDMARK_TUNNEL,
  LANDMARK_VISTA,
  LANDMARK_ARCH,
  type Landmark,
} from '../ZenLandmarkModel';
import { gatherMarkers } from '../ZenMinimapModel';
import { ZEN, ZEN_LANDMARK, ZEN_MINIMAP } from '../../utils/constants';

const SEED = ZEN.worldSeed;
const TICK = 1 / 60;
const NAMES = ['ring', 'arch', 'gateway', 'vista', 'tunnel'];

function findFirst(type: number): Landmark | null {
  for (let cz = 0; cz < 400; cz++) for (let cx = 0; cx < 400; cx++) {
    const lm = landmarkForCell(SEED, cx, cz);
    if (lm && lm.type === type) return lm;
  }
  return null;
}

/** World-space Y bounds of a mesh's geometry after its world matrix (position+rot+scale). */
function worldYBounds(mesh: THREE.LineSegments): { minY: number; maxY: number } {
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  return { minY, maxY };
}

describe('DIAG — tunnel beacon render path', () => {
  it('STEP 1+3: is the tunnel mesh built + scene-added + beacon visible above ground?', () => {
    const tunnel = findFirst(LANDMARK_TUNNEL)!;
    const scene = new THREE.Scene();
    const lms = new ZenLandmarks(scene, SEED);
    // Drive from far (outside drawRadius) straight to the tunnel centre, logging spawn distance.
    const tx = Math.sin(tunnel.rotationY), tz = Math.cos(tunnel.rotationY);
    let firstSpawnDist = -1;
    for (let d = ZEN_LANDMARK.drawRadius + 400; d >= 0; d -= 40) {
      const x = tunnel.x - tx * d, z = tunnel.z - tz * d;
      lms.update(x, z, TICK);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const active = (lms as any).active as Map<number, any>;
      if (active.has(tunnel.id) && firstSpawnDist < 0) firstSpawnDist = d;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (lms as any).active.get(tunnel.id);
    const inScene = a ? scene.children.includes(a.mesh) : false;
    const groundY = heightAt(SEED, tunnel.x, tunnel.z);
    const yb = a ? worldYBounds(a.mesh) : { minY: NaN, maxY: NaN };
    // Terrain height at each MOUTH (the beacon stands at the mouths, halfL from centre).
    const halfL = ZEN_LANDMARK.tunnelLength * 0.5 * tunnel.scale;
    const m1x = tunnel.x + tx * halfL, m1z = tunnel.z + tz * halfL;
    const m2x = tunnel.x - tx * halfL, m2z = tunnel.z - tz * halfL;
    const mouthTerrain1 = heightAt(SEED, m1x, m1z);
    const mouthTerrain2 = heightAt(SEED, m2x, m2z);

    console.log('=== TUNNEL BEACON RENDER ===');
    console.log('tunnel:', { id: tunnel.id, x: Math.round(tunnel.x), z: Math.round(tunnel.z), scale: tunnel.scale.toFixed(2) });
    console.log('mesh built + in scene graph:', inScene, '| material:', a?.material?.type, '| opacity:', a?.material?.opacity?.toFixed(2));
    console.log('first spawned at distance (u):', firstSpawnDist, '/ drawRadius', ZEN_LANDMARK.drawRadius);
    console.log('mesh world-Y span: min', yb.minY.toFixed(1), 'max', yb.maxY.toFixed(1));
    console.log('groundY @ centre:', groundY.toFixed(1), '| beacon top above centre-ground:', (yb.maxY - groundY).toFixed(1));
    console.log('terrain @ mouth1:', mouthTerrain1.toFixed(1), '@ mouth2:', mouthTerrain2.toFixed(1));
    console.log('beacon base(=centre groundY) vs mouth terrain → buried by:',
      (mouthTerrain1 - groundY).toFixed(1), '/', (mouthTerrain2 - groundY).toFixed(1), '(positive = base under terrain)');
    console.log('beacon top above the HIGHER mouth terrain:', (yb.maxY - Math.max(mouthTerrain1, mouthTerrain2)).toFixed(1));
  });

  it('STEP 1c compare: arch (Craig SEES it) vs tunnel — same spawn path?', () => {
    for (const [type, name] of [[LANDMARK_ARCH, 'arch'], [LANDMARK_TUNNEL, 'tunnel'], [LANDMARK_VISTA, 'vista']] as const) {
      const lm = findFirst(type);
      if (!lm) { console.log(name, 'NONE FOUND'); continue; }
      const scene = new THREE.Scene();
      const lms = new ZenLandmarks(scene, SEED);
      lms.update(lm.x, lm.z, TICK);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = (lms as any).active.get(lm.id);
      const yb = worldYBounds(a.mesh);
      const groundY = heightAt(SEED, lm.x, lm.z);
      console.log(`${name}: inScene=${scene.children.includes(a.mesh)} top-above-ground=${(yb.maxY - groundY).toFixed(1)} bottom-below=${(groundY - yb.minY).toFixed(1)}`);
    }
  });
});

describe('DIAG — minimap chevron render path', () => {
  it('STEP 2+3: does gatherMarkers emit the tunnel within the minimap radius?', () => {
    const tunnel = findFirst(LANDMARK_TUNNEL)!;
    const R = ZEN_MINIMAP.worldRadius;
    console.log('=== MINIMAP CHEVRON ===');
    console.log('minimap worldRadius:', R, '| landmark drawRadius (3D):', ZEN_LANDMARK.drawRadius);
    // Park the car ON the tunnel and at the EDGE of the minimap radius.
    for (const d of [0, R * 0.5, R - 50, R + 50]) {
      const m = gatherMarkers(SEED, tunnel.x - d, tunnel.z, R);
      const here = m.find((mm) => mm.kind === 'landmark' && Math.hypot(mm.x - tunnel.x, mm.z - tunnel.z) < 1);
      console.log(`car ${d.toFixed(0)}u from tunnel: landmark markers=${m.filter(x=>x.kind==='landmark').length}, tunnel-marker present=${!!here}, type=${here?.landmarkType}`);
    }
  });
});

describe('DIAG — HONEST encounter rate (cellSize/chance/gate/weights in practice)', () => {
  it('STEP 3: how sparse are tunnels really, and gentle-gate pass rate?', () => {
    const cs = ZEN_LANDMARK.cellSize;
    const N = 300; // 300x300 cells = (300*2600)^2 ≈ 780km square
    const counts = [0, 0, 0, 0, 0];
    let cellsWithLandmark = 0, chancePass = 0, gatePass = 0;
    const tunnelCells: Array<[number, number]> = [];
    for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
      const lm = landmarkForCell(SEED, cx, cz);
      if (lm) { counts[lm.type]++; cellsWithLandmark++; if (lm.type === LANDMARK_TUNNEL) tunnelCells.push([lm.x, lm.z]); }
    }
    // Re-derive chance-pass vs gate-pass separately.
    for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
      // mirror landmarkForCell's two gates
      const lm = landmarkForCell(SEED, cx, cz);
      if (lm) gatePass++;
    }
    const totalCells = N * N;
    console.log('=== ENCOUNTER RATE (', N, 'x', N, 'cells, cellSize', cs, 'u ) ===');
    console.log('cells with ANY landmark:', cellsWithLandmark, '/', totalCells, '=', (cellsWithLandmark / totalCells * 100).toFixed(1) + '%');
    console.log('type counts:', NAMES.map((n, i) => `${n}=${counts[i]}`).join(' '));
    console.log('tunnel fraction of landmarks:', (counts[LANDMARK_TUNNEL] / cellsWithLandmark * 100).toFixed(1) + '%');
    const tunnelCellFrac = counts[LANDMARK_TUNNEL] / totalCells;
    console.log('tunnel-bearing cells:', (tunnelCellFrac * 100).toFixed(2) + '% of all cells');
    // Mean spacing: area per tunnel = totalArea / nTunnels; spacing ≈ sqrt(areaPerTunnel).
    const areaPerTunnel = (cs * cs) / tunnelCellFrac;
    console.log('avg area per tunnel:', (areaPerTunnel / 1e6).toFixed(2), 'km² → mean spacing ≈', Math.round(Math.sqrt(areaPerTunnel)), 'u');
    // How many tunnels fall within ONE minimap radius (1500u) of a typical point? within drawRadius (2600)?
    const density = tunnelCellFrac / (cs * cs); // tunnels per u²
    console.log('expected tunnels within minimap radius', ZEN_MINIMAP.worldRadius, 'u:', (density * Math.PI * ZEN_MINIMAP.worldRadius ** 2).toFixed(3));
    console.log('expected tunnels within 3D drawRadius', ZEN_LANDMARK.drawRadius, 'u:', (density * Math.PI * ZEN_LANDMARK.drawRadius ** 2).toFixed(3));
    console.log('expected ANY landmark within drawRadius:', ((cellsWithLandmark / totalCells / (cs*cs)) * Math.PI * ZEN_LANDMARK.drawRadius ** 2).toFixed(3));
  });
});
