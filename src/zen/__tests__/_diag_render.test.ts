// @ts-nocheck
// DIAGNOSTIC (throwaway): trace the REAL ZenLandmarks render path (material color + scene-graph
// gate visibility) during a ring pass-through — the first diag to check pixels-bound state, not
// the reward STATE machine. Finding: state reaches the material/scene correctly (color lerps to
// near-white, gate mesh becomes visible), so the on-screen "nothing" is a thin-line/no-bloom
// PERCEPTIBILITY issue, not a logic disconnect.
import { it } from 'vitest';
import * as THREE from 'three';
import { ZenLandmarks } from '../ZenLandmarks';
import { landmarkForCell, reachRadius, LANDMARK_RING } from '../ZenLandmarkModel';
import { ZEN, ZEN_LANDMARK } from '../../utils/constants';
import * as fs from 'fs';
const SEED = ZEN.worldSeed; const TICK = 1/60; const L = [];
function findRing(){for(let cz=0;cz<200;cz++)for(let cx=0;cx<200;cx++){const lm=landmarkForCell(SEED,cx,cz);if(lm&&lm.type===LANDMARK_RING)return lm;}throw 0;}
it('trace render path',()=>{
  const ring = findRing();
  const scene = new THREE.Scene();
  const lms = new ZenLandmarks(scene, SEED);
  const active = (lms as any).active;
  const tx=Math.sin(ring.rotationY), tz=Math.cos(ring.rotationY);
  let x = ring.x - tx*220, z = ring.z - tz*220;
  const base = ZEN_LANDMARK.ringColor.toString(16).padStart(6,'0');
  for(let i=0;i<260;i++){
    x += tx*ZEN.maxSpeed*TICK; z += tz*ZEN.maxSpeed*TICK;
    lms.update(x, z, TICK);
    const a = active.get(ring.id);
    if(a){
      const dist = Math.hypot(ring.x-x, ring.z-z);
      if(dist < reachRadius(ring)+10 && i%4===0)
        L.push(`f${i} dist=${dist.toFixed(0)} matColor=#${a.material.color.getHexString()} gateVisible=${a.gateMesh?.visible} gateOpac=${(a.gateMaterial?.opacity??-1).toFixed(2)} gateY=${a.gateMesh?.position.y.toFixed(1)}`);
    }
  }
  fs.writeFileSync('/tmp/render.log', L.join('\n')+'\n');
});
