// @ts-nocheck — diagnostic-only (diag branch), keeps `npm run build`/tsc green.
/**
 * DIAGNOSTIC (diag/zen-world-blank, NOT for merge) — funnel telemetry for the "Zen world
 * renders blank" regression. Counts at each pipeline stage to find the FIRST broken one.
 * Exercises the PURE world/height logic AND constructs the three.js scenery/terrain
 * (InstancedMesh / LineSegments build with no GL context) to read instance counts +
 * vertex buffers. Run: npx vitest run src/zen/__tests__/diag_zen_world.test.ts
 */
import { describe, it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { ZEN, SCENERY } from '../../utils/constants';
import { ZenChunkField, chunkProps, maxActiveChunks } from '../ZenWorld';
import { heightAt, slopeAlong } from '../ZenHeight';
import { ZenScenery } from '../ZenScenery';
import { ZenTerrain } from '../ZenTerrain';

const OUT = '/tmp/zen_diag.log';
writeFileSync(OUT, '');
const log = (...a: unknown[]) =>
  appendFileSync(OUT, '[DIAG] ' + a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ') + '\n');

describe('DIAG: Zen world pipeline funnel', () => {
  it('STAGE 1 — chunk generation (is the active set 0?)', () => {
    log('constants:', {
      chunkSize: ZEN.chunkSize, chunkRadius: ZEN.chunkRadius, propsPerChunk: ZEN.propsPerChunk,
      terrainAmplitude: ZEN.terrainAmplitude, terrainSegmentsPerChunk: ZEN.terrainSegmentsPerChunk,
      worldSeed: ZEN.worldSeed, kinds: SCENERY.layers.length,
    });
    const field = new ZenChunkField(ZEN.worldSeed, ZEN.chunkRadius, SCENERY.layers.length);
    const changed = field.update(0, 0);
    log('field.update(0,0) ->', changed, '| activeChunks=', field.activeChunkCount,
      '(expected', maxActiveChunks(ZEN.chunkRadius), ') | activeProps=', field.activePropCount);
    // Sample a handful of chunk prop lists.
    let total = 0;
    for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
      total += chunkProps(ZEN.worldSeed, cx, cz, SCENERY.layers.length).length;
    }
    log('props in the 5x5 around origin =', total);
  });

  it('STAGE 2 — heightAt (NaN? all-zero?)', () => {
    const samples = [[0, 0], [10, 10], [40, -40], [123, 456], [-80, 80], [800, -800]];
    for (const [x, z] of samples) {
      const h = heightAt(ZEN.worldSeed, x, z);
      log(`heightAt(${x},${z}) =`, h, Number.isNaN(h) ? '*** NaN ***' : '');
    }
    const s = slopeAlong(ZEN.worldSeed, 0, 0, 1, 0);
    log('slopeAlong(0,0,1,0) =', s, Number.isNaN(s) ? '*** NaN ***' : '');
  });

  it('STAGE 3 — ZenScenery instance counts (built but count=0?)', () => {
    const scene = new THREE.Scene();
    const scenery = new ZenScenery(scene);
    log('scenery capacity/kind =', scenery.capacity, '| children added to scene =', scene.children.length);
    scenery.update(0, 0);
    const meshes = scene.children.filter((c) => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh[];
    log('InstancedMesh count =', meshes.length);
    meshes.forEach((m, i) => log(`  kind ${i}: instanceMesh.count =`, m.count, '| visible=', m.visible));
    log('scenery.activePropCount =', scenery.activePropCount);
  });

  it('STAGE 4 — ZenTerrain mesh (added? vertices? NaN in buffer?)', () => {
    const scene = new THREE.Scene();
    const terrain = new ZenTerrain(scene, ZEN.worldSeed);
    const lines = scene.children.filter((c) => (c as THREE.LineSegments).isLineSegments) as THREE.LineSegments[];
    log('LineSegments in scene =', lines.length, '| vertexCount =', terrain.vertexCount);
    terrain.update(0, 0); // first build
    const pos = (lines[0].geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    let nan = 0, nonZeroY = 0, maxY = -Infinity, minY = Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      if (Number.isNaN(pos[i]) || Number.isNaN(pos[i + 1]) || Number.isNaN(pos[i + 2])) nan++;
      const y = pos[i + 1];
      if (y !== 0) nonZeroY++;
      maxY = Math.max(maxY, y); minY = Math.min(minY, y);
    }
    log('terrain after update(0,0): NaN verts =', nan, '| nonZeroY verts =', nonZeroY,
      '| Y range = [', minY.toFixed(3), ',', maxY.toFixed(3), ']');
  });

  it('STAGE 5 — full per-frame path under try/catch (does anything THROW?)', () => {
    const scene = new THREE.Scene();
    let scenery: ZenScenery, terrain: ZenTerrain;
    try {
      scenery = new ZenScenery(scene);
      terrain = new ZenTerrain(scene, ZEN.worldSeed);
    } catch (e) {
      log('*** THREW during construction:', (e as Error).message);
      return;
    }
    // Simulate a few frames of motion across a chunk boundary.
    let x = 0, z = 0;
    for (let frame = 0; frame < 300; frame++) {
      x += 0.5; z -= 0.3; // ~150 units over 300 frames → crosses chunk boundaries
      try {
        terrain.update(x, z);
        scenery.update(x, z);
        const c = scenery.contactAt(x, z);
        if (Number.isNaN(c)) log(`*** contactAt NaN at frame ${frame}`);
      } catch (e) {
        log(`*** THREW at frame ${frame} (x=${x},z=${z}):`, (e as Error).message);
        return;
      }
    }
    log('300 frames simulated, no throw. final scenery.activePropCount =', scenery.activePropCount);
  });

  it('STAGE 6 — camera trajectory (does the view FRAME the world, or point away?)', () => {
    // Replicate render()'s camera math over frames driving forward from spawn, to catch a
    // #109 camera regression (NaN / view pointing away while the car stays framed).
    const v = { x: 0, z: 0, y: heightAt(ZEN.worldSeed, 0, 0) + ZEN.rideHeight, heading: 0, speed: 0 };
    const cam = { x: 0, y: ZEN.camHeight, z: ZEN.camDistance };
    let boom = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 180; i++) {
      // gentle forward drive (throttle 1, no steer) — mirror updateZen's core
      v.speed = Math.min(ZEN.maxSpeed, (v.speed + ZEN.accel * dt) * 0.99149);
      v.x += Math.sin(v.heading) * v.speed * dt;
      v.z += -Math.cos(v.heading) * v.speed * dt;
      v.y += (heightAt(ZEN.worldSeed, v.x, v.z) + ZEN.rideHeight - v.y) * (1 - Math.exp(-ZEN.terrainFollowLerp * dt));
      const f = 1 - Math.exp(-ZEN.camPosLerp * dt);
      boom += (v.heading - boom) * f;
      const dist = ZEN.camDistance;
      cam.x = v.x - Math.sin(boom) * dist;
      cam.z = v.z + Math.cos(boom) * dist;
      cam.y += (v.y + ZEN.camHeight - cam.y) * f;
      if (i % 60 === 0 || i === 179) {
        // Is the car IN FRONT of the camera (the look direction)? height above terrain?
        const lookOk = cam.z > v.z; // camera behind the car (car ahead in -z)
        log(`frame ${i}: car=(${v.x.toFixed(1)},${v.y.toFixed(2)},${v.z.toFixed(1)}) ` +
          `cam=(${cam.x.toFixed(1)},${cam.y.toFixed(2)},${cam.z.toFixed(1)}) ` +
          `camAboveTerrain=${(cam.y - heightAt(ZEN.worldSeed, cam.x, cam.z)).toFixed(2)} ` +
          `carFramed=${lookOk} ${Number.isNaN(cam.x + cam.y + cam.z + v.y) ? '*** NaN ***' : ''}`);
      }
    }
  });
});
