// @ts-nocheck — diagnostic-only (diag branch).
/**
 * DIAGNOSTIC (diag/zen-airtime-unfelt) — "air-time isn't felt" funnel. Distinguishes
 * (A) launch never fires on real steep terrain, (B) fires but the air is too small to
 * feel, (C) fires at a real height but reads invisibly. Drives the REAL #115 mountain
 * terrain at full cruise, straight at the steepest crests. Writes /tmp/zen_air_diag.log.
 * Run: npx vitest run src/zen/__tests__/diag_zen_air.test.ts
 */
import { it } from 'vitest';
import { writeFileSync, appendFileSync } from 'node:fs';
import { createZenVehicle, updateZen, updateVertical } from '../ZenVehicle';
import { heightAt, maskAt, slopeAlong } from '../ZenHeight';
import { ZEN } from '../../utils/constants';

const OUT = '/tmp/zen_air_diag.log';
writeFileSync(OUT, '');
const log = (...a) => appendFileSync(OUT, a.join(' ') + '\n');
const T = 1 / 60;
const dir = (h) => [Math.sin(h), -Math.cos(h)];

it('STAGE 0 — the constants + the theoretical ceiling', () => {
  log(`launchMinUpVel=${ZEN.launchMinUpVel} airGravity=${ZEN.airGravity} maxLaunchVel=${ZEN.maxLaunchVel} maxSpeed=${ZEN.maxSpeed} terrainSlopeEps=${ZEN.terrainSlopeEps}`);
  // Up-velocity needed: slope*speed > launchMinUpVel → slope > launchMinUpVel/speed.
  log(`to even QUALIFY (vy>thresh) at cruise ${ZEN.maxSpeed}: need approach slope > ${(ZEN.launchMinUpVel / ZEN.maxSpeed).toFixed(3)} (${(Math.atan(ZEN.launchMinUpVel / ZEN.maxSpeed) * 180 / Math.PI).toFixed(1)}°)`);
  // Max arc height above the launch point with capped vy:
  log(`max arc height above launch point (vy capped ${ZEN.maxLaunchVel}): ${(ZEN.maxLaunchVel ** 2 / (2 * ZEN.airGravity)).toFixed(2)}u, hang ${(2 * ZEN.maxLaunchVel / ZEN.airGravity).toFixed(2)}s`);
});

it('STAGE 1 — how steep does the REAL terrain get at cruise? (can the gate be met?)', () => {
  // Scan a big area: max |slope| (and thus max surfaceVy) and the max frame-to-frame
  // surface acceleration a STRAIGHT drive at cruise would actually produce.
  let maxSlope = 0, maxSurfVy = 0, maxNegAccel = 0, mountainPts = 0, total = 0;
  const S = ZEN.maxSpeed;
  for (let i = 0; i < 400000; i++) {
    const x = (i * 31) % 6000 - 3000, z = (i * 53) % 6000 - 3000;
    total++;
    if (maskAt(ZEN.worldSeed, x, z) > 0) mountainPts++;
    const [dx, dz] = dir(i * 0.001);
    const s = slopeAlong(ZEN.worldSeed, x, z, dx, dz);
    maxSlope = Math.max(maxSlope, Math.abs(s));
    maxSurfVy = Math.max(maxSurfVy, Math.abs(s) * S);
    // frame-to-frame surface accel along a straight path at cruise: sample slope now vs one frame ahead
    const ax = x + dx * S * T, az = z + dz * S * T;
    const s2 = slopeAlong(ZEN.worldSeed, ax, az, dx, dz);
    const accel = (s2 * S - s * S) / T;
    if (accel < maxNegAccel) maxNegAccel = accel;
  }
  log(`STAGE1 over ${total} samples: max|slope|=${maxSlope.toFixed(2)} | max surfaceVy=${maxSurfVy.toFixed(1)} (gate=${ZEN.launchMinUpVel}) | most-negative surfaceAccel=${maxNegAccel.toFixed(0)} (gate=${-ZEN.airGravity}) | mountain coverage ${(100 * mountainPts / total).toFixed(0)}%`);
  log(`  -> surfaceVy CAN exceed gate? ${maxSurfVy > ZEN.launchMinUpVel} | surfaceAccel CAN exceed gate? ${maxNegAccel < -ZEN.airGravity}`);
});

it('STAGE 2 — DRIVE straight at the steepest crests; count launches + measure air', () => {
  // Find the steepest crest in a region, aim the car straight through it, drive at full
  // throttle, and watch. Repeat across several headings/start points to cover real peaks.
  let totalLaunches = 0, totalAirFrames = 0;
  let maxArcAboveLaunch = 0, maxGapToGround = 0, maxLaunchVyObs = 0, maxAirDurFrames = 0;
  let drives = 0, drivesWithLaunch = 0;

  for (let trial = 0; trial < 40; trial++) {
    const v = createZenVehicle();
    // spread start points across the world; pick a heading and just floor it straight
    v.x = (trial * 911) % 8000 - 4000;
    v.z = (trial * 1307) % 8000 - 4000;
    v.heading = (trial * 0.37) % (Math.PI * 2);
    v.speed = ZEN.maxSpeed; // start at full cruise
    drives++;
    let launchedThisDrive = false;
    let airStart = -1, launchY = 0;
    for (let i = 0; i < 1500; i++) {
      const [dx, dz] = dir(v.heading);
      const slope = v.airborne ? 0 : slopeAlong(ZEN.worldSeed, v.x, v.z, dx, dz);
      updateZen(v, 0, 1, T, slope); // straight, full throttle
      const groundY = heightAt(ZEN.worldSeed, v.x, v.z) + ZEN.rideHeight;
      const wasAir = v.airborne;
      updateVertical(v, groundY, slope, T);
      if (!wasAir && v.airborne) { // launched
        totalLaunches++; launchedThisDrive = true; airStart = i; launchY = v.y;
        maxLaunchVyObs = Math.max(maxLaunchVyObs, v.vy);
      }
      if (v.airborne) {
        totalAirFrames++;
        maxArcAboveLaunch = Math.max(maxArcAboveLaunch, v.y - launchY);
        maxGapToGround = Math.max(maxGapToGround, v.y - groundY);
      }
      if (wasAir && !v.airborne && airStart >= 0) { maxAirDurFrames = Math.max(maxAirDurFrames, i - airStart); airStart = -1; }
    }
    if (launchedThisDrive) drivesWithLaunch++;
  }
  log(`STAGE2 ${drives} straight full-cruise drives: ${drivesWithLaunch}/${drives} had ANY launch | total launches=${totalLaunches}`);
  log(`  launch up-vel observed (max)=${maxLaunchVyObs.toFixed(1)} (cap ${ZEN.maxLaunchVel}, gate ${ZEN.launchMinUpVel})`);
  log(`  MAX ARC above launch point=${maxArcAboveLaunch.toFixed(2)}u | max gap to ground below=${maxGapToGround.toFixed(2)}u | max air duration=${maxAirDurFrames} frames (${(maxAirDurFrames / 60).toFixed(2)}s)`);
  log(`  total airborne frames across all drives=${totalAirFrames}`);
});

it('STAGE 3 — camera readability: does the camera follow so tightly air is invisible?', () => {
  // Replicate the renderer's camera vertical ease over a launch. If the camera rises ~1:1
  // with the car (and the ground-glow rides with the car), a launch shows no on-screen gap.
  const f = 1 - Math.exp(-ZEN.camPosLerp * T);
  log(`camPosLerp=${ZEN.camPosLerp} -> camera Y closes ${(100 * f).toFixed(1)}% of the gap/frame`);
  // Simulate: car launches with vy=maxLaunchVel from y=0; track car-vs-camera vertical separation.
  let carY = 0, vy = ZEN.maxLaunchVel, camY = ZEN.camHeight, maxSep = 0;
  for (let i = 0; i < 60; i++) {
    vy -= ZEN.airGravity * T; carY += vy * T; if (carY < 0) { carY = 0; vy = 0; }
    camY += (carY + ZEN.camHeight - camY) * f;
    // on-screen vertical offset of the car from its resting framing = how far car rose vs camera
    maxSep = Math.max(maxSep, (carY + ZEN.camHeight - camY));
  }
  log(`STAGE3 best-case launch (vy=${ZEN.maxLaunchVel}): peak car-rise-relative-to-camera = ${maxSep.toFixed(2)}u (this is the on-screen 'lift'; ground-glow rides WITH the car so no shadow gap)`);
});
