// @ts-nocheck
import { it } from 'vitest';
import { findReturnPortal, arrivalPose, crossedAnyGateway, snapshot, restore } from '../ZenSecret';
import { createZenVehicle, updateZen, updateVertical } from '../ZenVehicle';
import { heightAt } from '../ZenHeight';
import { surfaceSlopeAlong } from '../ZenLandmarkSurface';
import { biomeAt, createZenBiomeState } from '../ZenBiome';
import { landmarkForCell, LANDMARK_GATEWAY } from '../ZenLandmarkModel';
import { ZEN, ZEN_SECRET, ZEN_BIOMES } from '../../utils/constants';
import * as fs from 'fs';
const SEED = ZEN.worldSeed; const TICK = 1/60; const L = [];
const st = createZenBiomeState();
function biomeName(x,z){ biomeAt(SEED,x,z,st); return `${ZEN_BIOMES[st.from].displayName}(${st.from})`; }
it('trace warp',()=>{
  // 1. Destination
  const portal = findReturnPortal(SEED);
  const arr = arrivalPose(portal);
  L.push(`RETURN PORTAL: (${portal.x.toFixed(0)}, ${portal.z.toFixed(0)})  rotationY=${portal.rotationY.toFixed(2)}`);
  L.push(`  dist from origin = ${Math.hypot(portal.x,portal.z).toFixed(0)}u  (normal roam is ~0; secret band target ${ZEN_SECRET.regionX},${ZEN_SECRET.regionZ})`);
  L.push(`ARRIVAL: (${arr.x.toFixed(0)}, ${arr.z.toFixed(0)})  heading=${arr.heading.toFixed(2)}  dist to portal = ${Math.hypot(arr.x-portal.x,arr.z-portal.z).toFixed(1)}u`);
  L.push(`  biome AT destination = ${biomeName(arr.x,arr.z)}  (a NORMAL biome → looks normal; only the forced violet palette differs)`);
  L.push('');

  // 2. Simulate ENTER from a real near-origin gateway, then drive forward from arrival.
  function findGatewayNearOrigin(){for(let cz=0;cz<120;cz++)for(let cx=0;cx<120;cx++){const lm=landmarkForCell(SEED,cx,cz);if(lm&&lm.type===LANDMARK_GATEWAY)return lm;}throw 0;}
  const A = findGatewayNearOrigin();
  L.push(`ENTRY GATEWAY A (near origin): (${A.x.toFixed(0)}, ${A.z.toFixed(0)})`);
  // Replicate doTeleport ENTER:
  let inSecret = false; let saved = null;
  const v = createZenVehicle();
  v.x = A.x; v.z = A.z + 200; v.heading = 0; // pretend we just crossed A
  const beforeEnter = snapshot(v);
  // ENTER:
  saved = snapshot(v); v.x = arr.x; v.z = arr.z; v.heading = arr.heading; v.speed = 0; v.vy=0; v.airborne=false;
  v.y = heightAt(SEED, v.x, v.z) + ZEN.rideHeight; inSecret = true;
  L.push(`AFTER ENTER: inSecret=${inSecret}, car at (${v.x.toFixed(0)}, ${v.z.toFixed(0)}) = the FAR secret band? ${Math.hypot(v.x,v.z)>100000}`);

  // 3. Drive FORWARD from arrival (Craig holds gas). How long until the FIRST gateway crossing?
  let px=v.x, pz=v.z, crossedFrame=-1, crossedPortal=false;
  for(let i=0;i<240;i++){
    const slope=surfaceSlopeAlong(SEED,v.x,v.z,Math.sin(v.heading),-Math.cos(v.heading));
    updateZen(v,0,1,TICK,slope);
    const gy=heightAt(SEED,v.x,v.z)+ZEN.rideHeight; updateVertical(v,gy,slope,TICK,true);
    if(crossedAnyGateway(SEED,px,pz,v.x,v.z)){ crossedFrame=i; crossedPortal = Math.hypot(v.x-portal.x,v.z-portal.z) < 80; break; }
    px=v.x; pz=v.z;
  }
  L.push('');
  L.push(`DRIVE FORWARD from arrival: first gateway crossing at frame ${crossedFrame} (${(crossedFrame/60).toFixed(2)}s) — is it the RETURN portal? ${crossedPortal}`);
  // 4. That crossing → doTeleport with inSecret=true → RETURN
  if(crossedFrame>=0){
    // RETURN:
    restore(v, saved); inSecret=false;
    L.push(`AFTER that crossing → RETURN: inSecret=${inSecret}, car restored to (${v.x.toFixed(0)}, ${v.z.toFixed(0)}) = back near entry A`);
  }
  L.push('');
  L.push(`=> So: cross A → warp to FAR band facing return portal (60u away) → drive forward → cross it in ~${(crossedFrame/60).toFixed(1)}s → RETURN to A. Bounce A<->B; the "secret region" is normal-gen + only sky/fog go violet (grid stays normal).`);
  fs.writeFileSync('/tmp/warp.log', L.join('\n')+'\n');
});
