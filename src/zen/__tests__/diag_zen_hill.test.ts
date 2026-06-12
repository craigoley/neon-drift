// @ts-nocheck — diagnostic-only (diag branch).
/**
 * DIAGNOSTIC (diag/zen-hill-microlaunch) — "constant downward jerks on rolling hills +
 * can't find ramps". Hypothesis: the air-time launch fires on GENTLE hills at full cruise
 * (not just sharp peaks), so cruising = constant micro-launch+settle (the jerks) AND ramps
 * are lost in the noise. Resolves the #116 "0 launches" contradiction by MEASURING on the
 * real cruise terrain (straight, full speed) — vs the #116 test's single wandering path.
 * Run: npx vitest run src/zen/__tests__/diag_zen_hill.test.ts ; cat /tmp/zen_hill.log
 */
import { it } from 'vitest';
import { writeFileSync, appendFileSync } from 'node:fs';
import { createZenVehicle, updateZen, updateVertical } from '../ZenVehicle';
import { heightAt, slopeAlong, maskAt, rampContribution } from '../ZenHeight';
import { ZEN } from '../../utils/constants';

const OUT = '/tmp/zen_hill.log';
writeFileSync(OUT, '');
const log = (...a) => appendFileSync(OUT, a.join(' ') + '\n');
const T = 1 / 60;
const dir = (h) => [Math.sin(h), -Math.cos(h)];

it('STAGE 1 — can GENTLE hills even meet the launch gates at cruise?', () => {
  log(`launchMinUpVel=${ZEN.launchMinUpVel} airGravity=${ZEN.airGravity} maxSpeed=${ZEN.maxSpeed} terrainAmplitude=${ZEN.terrainAmplitude}`);
  let maxVy = 0, maxNegAccel = 0, samples = 0;
  const S = ZEN.maxSpeed;
  for (let i = 0; i < 300000; i++) {
    const x = (i * 31) % 9000 - 4500, z = (i * 53) % 9000 - 4500;
    // ONLY gentle hills: skip mountain regions AND ramps
    if (maskAt(ZEN.worldSeed, x, z) > 0 || rampContribution(ZEN.worldSeed, x, z) > 0.01) continue;
    samples++;
    const h = i * 0.000123; const [dx, dz] = dir(h);
    const s = slopeAlong(ZEN.worldSeed, x, z, dx, dz);
    maxVy = Math.max(maxVy, Math.abs(s) * S);
    const ax = x + dx * S * T, az = z + dz * S * T;
    const accel = (slopeAlong(ZEN.worldSeed, ax, az, dx, dz) * S - s * S) / T;
    if (accel < maxNegAccel) maxNegAccel = accel;
  }
  log(`STAGE1 gentle-hill samples=${samples}: max surfaceVy=${maxVy.toFixed(1)} (gate ${ZEN.launchMinUpVel}) | most-neg surfaceAccel=${maxNegAccel.toFixed(0)} (gate ${-ZEN.airGravity})`);
  log(`  -> gentle hills CAN exceed vy gate? ${maxVy > ZEN.launchMinUpVel} | CAN exceed accel gate? ${maxNegAccel < -ZEN.airGravity}`);
});

it('STAGE 2 — DRIVE straight full-cruise across gentle hills: how many launches?', () => {
  let totalLaunches = 0, totalAirFrames = 0, totalFrames = 0, gentleStartDrives = 0;
  let airHeights = [], airDurs = [];
  for (let trial = 0; trial < 60; trial++) {
    const v = createZenVehicle();
    v.x = (trial * 631) % 9000 - 4500;
    v.z = (trial * 977) % 9000 - 4500;
    // only start drives that begin in gentle, ramp-free terrain
    if (maskAt(ZEN.worldSeed, v.x, v.z) > 0) continue;
    gentleStartDrives++;
    v.heading = (trial * 0.41) % (Math.PI * 2);
    v.speed = ZEN.maxSpeed;
    let airStart = -1, launchY = 0;
    for (let i = 0; i < 1800; i++) { // 30s straight
      const [dx, dz] = dir(v.heading);
      const slope = v.airborne ? 0 : slopeAlong(ZEN.worldSeed, v.x, v.z, dx, dz);
      updateZen(v, 0, 1, T, slope);
      const groundY = heightAt(ZEN.worldSeed, v.x, v.z) + ZEN.rideHeight;
      const onRampOrMtn = maskAt(ZEN.worldSeed, v.x, v.z) > 0 || rampContribution(ZEN.worldSeed, v.x, v.z) > 0.2;
      const wasAir = v.airborne;
      updateVertical(v, groundY, slope, T);
      totalFrames++;
      if (!wasAir && v.airborne && !onRampOrMtn) { totalLaunches++; airStart = i; launchY = v.y; } // launch on GENTLE hill
      if (v.airborne) totalAirFrames++;
      if (wasAir && !v.airborne && airStart >= 0) { airHeights.push(v.y - launchY); airDurs.push(i - airStart); airStart = -1; }
    }
  }
  const secs = totalFrames / 60;
  const med = (a) => a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0;
  log(`STAGE2 ${gentleStartDrives} straight full-cruise gentle-hill drives (${secs.toFixed(0)}s total):`);
  log(`  GENTLE-HILL LAUNCHES = ${totalLaunches}  (= ${(totalLaunches / secs).toFixed(2)} per second of cruising) | airborne ${(100 * totalAirFrames / totalFrames).toFixed(1)}% of frames`);
  log(`  micro-hop size: median air height=${med(airHeights).toFixed(2)}u, median duration=${med(airDurs).toFixed(0)} frames (${(med(airDurs) / 60).toFixed(2)}s) | n=${airHeights.length}`);
});

it('STAGE 3 — RAMPS: how often encountered + how distinct from hills?', () => {
  // density over a big area
  const cs = ZEN.rampCellSize; let ramps = 0, cells = 0;
  for (let cx = -15; cx < 15; cx++) for (let cz = -15; cz < 15; cz++) {
    cells++; let has = false;
    for (let ox = ZEN.rampRadius; ox < cs - ZEN.rampRadius && !has; ox += 6)
      for (let oz = ZEN.rampRadius; oz < cs - ZEN.rampRadius && !has; oz += 6)
        if (rampContribution(ZEN.worldSeed, cx * cs + ox, cz * cs + oz) > ZEN.rampHeight * 0.9) has = true;
    if (has) ramps++;
  }
  log(`STAGE3 ramps: ${ramps}/${cells} cells have one (~1 per ${(Math.sqrt(cells / Math.max(ramps,1)) * cs).toFixed(0)}u of roaming)`);
  log(`  ramp peak height=${ZEN.rampHeight}u vs rolling-hill relief ≈ ±${(ZEN.terrainAmplitude * 1.5).toFixed(1)}u -> ramp is ${(ZEN.rampHeight / (ZEN.terrainAmplitude * 1.5)).toFixed(1)}x a hill`);
  log(`  -> if hills ALSO launch you (Stage 2), a ${ZEN.rampHeight}u ramp doesn't stand out as "the" launch spot`);
});

it('STAGE 4 — GROUNDED cruising on gentle hills: shadow gap + per-frame jerk', () => {
  let gapSum=0, gapMax=0, gapFrames=0, bigGapFrames=0;
  let jerkMax=0, jerkSum=0, jerkFrames=0, downJerks=0;
  let camJerkMax=0;
  for (let trial=0; trial<40; trial++) {
    const v = createZenVehicle();
    v.x=(trial*419)%6000-3000; v.z=(trial*733)%6000-3000;
    if (maskAt(ZEN.worldSeed,v.x,v.z)>0) continue;
    v.heading=(trial*0.3)%(Math.PI*2); v.speed=ZEN.maxSpeed;
    let camY=v.y+ZEN.camHeight, lookY=ZEN.camLookAtHeight, prevPitch=null, prevY=v.y;
    const f=1-Math.exp(-ZEN.camPosLerp*T);
    for (let i=0;i<1200;i++){
      const [dx,dz]=dir(v.heading);
      const slope=v.airborne?0:slopeAlong(ZEN.worldSeed,v.x,v.z,dx,dz);
      updateZen(v,0,1,T,slope);
      const groundY=heightAt(ZEN.worldSeed,v.x,v.z)+ZEN.rideHeight;
      updateVertical(v,groundY,slope,T);
      // only sample GENTLE, GROUNDED, ramp-free frames (the pure rolling-hill cruise)
      if (v.airborne || maskAt(ZEN.worldSeed,v.x,v.z)>0 || rampContribution(ZEN.worldSeed,v.x,v.z)>0.05){ prevY=v.y; continue; }
      const gap=Math.abs(v.y-groundY); gapSum+=gap; gapMax=Math.max(gapMax,gap); gapFrames++;
      if (gap>0.4) bigGapFrames++;
      const jerk=v.y-prevY; jerkSum+=Math.abs(jerk); jerkMax=Math.max(jerkMax,Math.abs(jerk)); jerkFrames++;
      if (jerk<-0.3) downJerks++;
      // camera
      camY+=(v.y+ZEN.camHeight-camY)*f; lookY+=(v.y+ZEN.camLookAtHeight-lookY)*f;
      const horiz=ZEN.camDistance; const pitch=Math.atan2(lookY-camY,horiz)*180/Math.PI;
      if (prevPitch!==null) camJerkMax=Math.max(camJerkMax,Math.abs(pitch-prevPitch));
      prevPitch=pitch; prevY=v.y;
    }
  }
  log(`\nSTAGE4 grounded gentle-hill cruising (${gapFrames} frames):`);
  log(`  car-vs-shadow GAP: avg=${(gapSum/gapFrames).toFixed(2)}u max=${gapMax.toFixed(2)}u | frames with gap>0.4u = ${(100*bigGapFrames/gapFrames).toFixed(0)}% (visible 'two shadows')`);
  log(`  per-frame carY jerk: avg=${(jerkSum/jerkFrames).toFixed(3)}u max=${jerkMax.toFixed(2)}u | downward jerks >0.3u/frame = ${downJerks} (${(downJerks/(gapFrames/60)).toFixed(2)}/s)`);
  log(`  camera pitch jerk max=${camJerkMax.toFixed(2)}°/frame (eased lookAt #118)`);
});

it('STAGE 5 — launches per second across the WHOLE world (gentle + mountain-influence)', () => {
  let launches=0, frames=0, airFrames=0; const hops=[];
  for (let trial=0; trial<80; trial++) {
    const v=createZenVehicle(); v.x=(trial*557)%14000-7000; v.z=(trial*883)%14000-7000;
    v.heading=(trial*0.27)%(Math.PI*2); v.speed=ZEN.maxSpeed;
    let airStart=-1, launchY=0, maskAtLaunch=0;
    for (let i=0;i<1800;i++){
      const [dx,dz]=dir(v.heading);
      const slope=v.airborne?0:slopeAlong(ZEN.worldSeed,v.x,v.z,dx,dz);
      updateZen(v,0,1,T,slope);
      const g=heightAt(ZEN.worldSeed,v.x,v.z)+ZEN.rideHeight; const was=v.airborne;
      updateVertical(v,g,slope,T); frames++;
      if (!was&&v.airborne){ launches++; airStart=i; launchY=v.y; maskAtLaunch=maskAt(ZEN.worldSeed,v.x,v.z); }
      if (v.airborne) airFrames++;
      if (was&&!v.airborne&&airStart>=0){ hops.push({air:v.y-launchY, dur:i-airStart, mask:maskAtLaunch}); airStart=-1; }
    }
  }
  const secs=frames/60;
  const small=hops.filter(h=>h.air<2).length, mtn=hops.filter(h=>h.mask>0).length;
  hops.sort((a,b)=>a.air-b.air); const medAir=hops.length?hops[hops.length>>1].air:0;
  log(`\nSTAGE5 whole-world straight cruise (${secs.toFixed(0)}s): ${launches} launches = ${(launches/secs).toFixed(2)}/s, one every ${(secs/launches).toFixed(1)}s | airborne ${(100*airFrames/frames).toFixed(1)}%`);
  log(`  hop air-height: median=${medAir.toFixed(2)}u | SMALL hops (<2u)=${small}/${hops.length} (${(100*small/hops.length).toFixed(0)}%) | launched in mask>0 terrain=${mtn}/${hops.length} (${(100*mtn/hops.length).toFixed(0)}%)`);
});
