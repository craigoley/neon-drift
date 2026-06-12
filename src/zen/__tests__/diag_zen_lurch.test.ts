// @ts-nocheck — diagnostic-only (diag branch).
/**
 * DIAGNOSTIC (diag/zen-airtime-lurch) — "the whole frame lurches on some launches".
 * The camera position.y is EASED toward v.y but the lookAt TARGET is the EXACT v.y each
 * frame. Hypothesis: during a fast plunge (launch off a ridge whose far side drops away →
 * big fall), the eased camera.y lags HIGH while lookAt aims at the plunging car → the view
 * pitches DOWN hard = the lurch. This replicates the EXACT camera math over real ridges and
 * traces the per-frame camera pitch-rate / Y-rate to locate the discontinuity.
 * Run: npx vitest run src/zen/__tests__/diag_zen_lurch.test.ts ; cat /tmp/zen_lurch.log
 */
import { it } from 'vitest';
import { writeFileSync, appendFileSync } from 'node:fs';
import { createZenVehicle, updateZen, updateVertical } from '../ZenVehicle';
import { heightAt, slopeAlong } from '../ZenHeight';
import { ZEN } from '../../utils/constants';

const OUT = '/tmp/zen_lurch.log';
writeFileSync(OUT, '');
const log = (...a) => appendFileSync(OUT, a.join(' ') + '\n');
const T = 1 / 60;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const ease = (rate) => 1 - Math.exp(-rate * T);

/** One full step: advance the vehicle AND replicate the renderer's camera, return a snapshot. */
function step(v, cam, dt) {
  const slope = v.airborne ? 0 : slopeAlong(ZEN.worldSeed, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
  updateZen(v, 0, 1, dt, slope);
  const groundY = heightAt(ZEN.worldSeed, v.x, v.z) + ZEN.rideHeight;
  const wasAir = v.airborne;
  updateVertical(v, groundY, slope, dt);
  // --- replicate ZenRenderer camera ---
  const f = ease(ZEN.camPosLerp);
  cam.boom += (v.heading - cam.boom) * f;
  cam.spd += (clamp(v.speed / ZEN.maxSpeed, 0, 1) - cam.spd) * ease(ZEN.camSpeedLerp);
  const distance = ZEN.camDistance + ZEN.camDistanceSpeedGain * cam.spd;
  cam.x = v.x - Math.sin(cam.boom) * distance;
  cam.z = v.z + Math.cos(cam.boom) * distance;
  cam.y += (v.y + ZEN.camHeight - cam.y) * f; // EASED toward the car's Y
  const horiz = Math.hypot(v.x - cam.x, v.z - cam.z);
  const pitch = Math.atan2(v.y + ZEN.camLookAtHeight - cam.y, horiz); // DIRECT lookAt at car Y
  return { groundY, wasAir, airborne: v.airborne, vy: v.vy, vy_top: v.y, camY: cam.y, pitchDeg: (pitch * 180) / Math.PI };
}

it('LURCH HUNT — drive real ridges; find the worst per-frame camera pitch/Y jump', () => {
  let worst = null;
  const trials = 120;
  for (let trial = 0; trial < trials; trial++) {
    const v = createZenVehicle();
    v.x = (trial * 911) % 12000 - 6000;
    v.z = (trial * 1307) % 12000 - 6000;
    v.heading = (trial * 0.21) % (Math.PI * 2);
    v.speed = ZEN.maxSpeed;
    const cam = { x: v.x, y: v.y + ZEN.camHeight, z: v.z, boom: v.heading, spd: 1 };
    const hist = [];
    for (let i = 0; i < 1200; i++) {
      const s = step(v, cam, T);
      hist.push(s);
      if (hist.length > 1) {
        const p = hist[hist.length - 2];
        const dPitch = Math.abs(s.pitchDeg - p.pitchDeg);   // per-frame view rotation (deg)
        const dCamY = Math.abs(s.camY - p.camY);            // per-frame camera vertical (u)
        const dVy = Math.abs(s.vy_top - p.vy_top);          // per-frame car Y change (u)
        if (!worst || dPitch > worst.dPitch) {
          worst = { trial, i, dPitch, dCamY, dVy, terrainDrop: p.groundY - s.groundY, ...s, prev: p };
        }
      }
    }
  }
  log(`WORST per-frame camera pitch jump across ${trials} drives:`);
  log(`  ΔpitchDeg=${worst.dPitch.toFixed(2)}°/frame (=${(worst.dPitch * 60).toFixed(0)}°/s) | ΔcamY=${worst.dCamY.toFixed(2)}u/frame | Δ(carY)=${worst.dVy.toFixed(2)}u/frame`);
  log(`  context: airborne ${worst.prev.airborne}->${worst.airborne} | vy=${worst.vy.toFixed(1)} | terrain drop this frame=${worst.terrainDrop.toFixed(2)}u | camY=${worst.camY.toFixed(1)} carY=${worst.vy_top.toFixed(1)}`);
});

it('TRACE — dump per-frame window around the biggest plunge launch (jerky vs the ease)', () => {
  // Find a launch followed by a big terrain drop (the "ground falls away" case) and trace it.
  let best = null;
  for (let trial = 0; trial < 200; trial++) {
    const v = createZenVehicle();
    v.x = (trial * 877) % 16000 - 8000;
    v.z = (trial * 1499) % 16000 - 8000;
    v.heading = (trial * 0.137) % (Math.PI * 2);
    v.speed = ZEN.maxSpeed;
    const cam = { x: v.x, y: v.y + ZEN.camHeight, z: v.z, boom: v.heading, spd: 1 };
    for (let i = 0; i < 1200; i++) {
      const wasAir = v.airborne;
      const s = step(v, cam, T);
      if (!wasAir && s.airborne) {
        // capture how far the car falls below the launch point over the next 90 frames
        const launchY = s.vy_top;
        let minY = launchY;
        const snap = { trial, i, launchY };
        for (let k = 0; k < 90; k++) { const s2 = step(v, cam, T); minY = Math.min(minY, s2.vy_top); }
        snap.fall = launchY - minY;
        if (!best || snap.fall > best.fall) best = snap;
        break; // one launch per trial is enough to rank
      }
    }
  }
  log(`\nBIGGEST plunge launch found: trial ${best.trial}, fell ${best.fall.toFixed(1)}u below the launch point. Re-driving it with a full trace:`);
  // Re-run that trial and dump the trace from launch.
  const trial = best.trial;
  const v = createZenVehicle();
  v.x = (trial * 877) % 16000 - 8000; v.z = (trial * 1499) % 16000 - 8000;
  v.heading = (trial * 0.137) % (Math.PI * 2); v.speed = ZEN.maxSpeed;
  const cam = { x: v.x, y: v.y + ZEN.camHeight, z: v.z, boom: v.heading, spd: 1 };
  let launched = false, frame = 0, prevPitch = null, prevCamY = null;
  for (let i = 0; i < 1200 && frame < 70; i++) {
    const wasAir = v.airborne;
    const s = step(v, cam, T);
    if (!wasAir && s.airborne) launched = true;
    if (launched) {
      const dP = prevPitch === null ? 0 : s.pitchDeg - prevPitch;
      const dC = prevCamY === null ? 0 : s.camY - prevCamY;
      log(`  f${frame.toString().padStart(2)} air=${s.airborne ? 1 : 0} carY=${s.vy_top.toFixed(1)} ground=${s.groundY.toFixed(1)} camY=${s.camY.toFixed(1)} | pitch=${s.pitchDeg.toFixed(1)}° dPitch=${dP.toFixed(2)}° dCamY=${dC.toFixed(2)}`);
      prevPitch = s.pitchDeg; prevCamY = s.camY; frame++;
    }
  }
});
