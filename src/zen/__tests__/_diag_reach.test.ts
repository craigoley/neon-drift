// @ts-nocheck
import { it } from 'vitest';
import { createZenVehicle, updateZen, updateVertical } from '../ZenVehicle';
import { heightAt, slopeAlong } from '../ZenHeight';
import { landmarkForCell, reachRadius, eachSolidCircle, LANDMARK_RING, LANDMARK_MONOLITH, LANDMARK_ARCH } from '../ZenLandmarkModel';
import { deflectPoint } from '../ZenWorld';
import { ZEN, ZEN_LANDMARK } from '../../utils/constants';
import * as fs from 'fs';

const SEED = ZEN.worldSeed;
const TICK = 1 / 60;
const log: string[] = [];
const P = (s: string) => log.push(s);

function findType(type: number) {
  for (let cz = 0; cz < 120; cz++) for (let cx = 0; cx < 120; cx++) {
    const lm = landmarkForCell(SEED, cx, cz);
    if (lm && lm.type === type) return lm;
  }
  throw new Error('not found ' + type);
}

// forwardDot of (target-car) onto the car's forward axis (sin h, -cos h).
function forwardDot(lm, v) {
  const fx = Math.sin(v.heading), fz = -Math.cos(v.heading);
  return (lm.x - v.x) * fx + (lm.z - v.z) * fz;
}

// Replicate ZenLandmarks.update reach+pulse state machine EXACTLY (lines 86-110).
function makeState() { return { pulseT: -1, near: false }; }
function stepReach(st, lm, v, dt) {
  const dx = lm.x - v.x, dz = lm.z - v.z;
  const dist2 = dx*dx + dz*dz;
  const rr = reachRadius(lm);
  const within = dist2 <= rr*rr;
  let fired = false;
  if (within && !st.near) { st.pulseT = 0; fired = true; }
  st.near = within;
  let env = 0;
  if (st.pulseT >= 0) {
    st.pulseT += dt;
    if (st.pulseT >= ZEN_LANDMARK.pulseSeconds) st.pulseT = -1;
    else env = Math.sin(Math.PI * (st.pulseT / ZEN_LANDMARK.pulseSeconds));
  }
  return { within, fired, env, rr, dist: Math.sqrt(dist2) };
}

function drive(lm, label, solid) {
  // Start ~220u "before" the landmark along -approach so we drive straight through/at it.
  const v = createZenVehicle();
  // approach heading 0 (facing -z). Put car at +z of landmark so it drives toward -z through center.
  v.x = lm.x; v.z = lm.z + 220; v.heading = 0; v.speed = ZEN.maxSpeed;
  v.y = heightAt(SEED, v.x, v.z);
  const st = makeState();
  let fireT = -1, firePos = null, fireFwd = null, fireDist = null;
  let peakSeen = 0, peakSeenT = -1; // max env while landmark still in front of CAMERA
  let lastVisibleT = -1;
  let envAtExit = -1; // env at the frame the landmark leaves camera view
  let maxEnv = 0, maxEnvT = -1, maxEnvFwd = null;
  let t = 0;
  for (let i = 0; i < 600; i++) {
    const slope = v.airborne ? 0 : slopeAlong(SEED, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
    updateZen(v, 0, 1, TICK, slope);
    if (solid) { // monolith: apply deflect (replicate resolve)
      eachSolidCircle(lm, (cx,cz,r) => { const o = deflectPoint(v.x, v.z, cx, cz, r); v.x = o.x; v.z = o.z; });
    }
    const gy = heightAt(SEED, v.x, v.z) + ZEN.rideHeight;
    updateVertical(v, gy, slope, TICK);
    const r = stepReach(st, lm, v, TICK);
    t += TICK;
    const fwd = forwardDot(lm, v);
    const fwdCam = fwd + ZEN.camDistance; // >0 = in front of the chase camera
    const visible = fwdCam > 0;
    if (r.fired && fireT < 0) { fireT = t; firePos = {x:v.x,z:v.z}; fireFwd = fwd; fireDist = r.dist; }
    if (r.env > maxEnv) { maxEnv = r.env; maxEnvT = t; maxEnvFwd = fwd; }
    if (visible && r.env > peakSeen) { peakSeen = r.env; peakSeenT = t; }
    if (visible) lastVisibleT = t;
    if (!visible && envAtExit < 0 && fireT >= 0) envAtExit = r.env;
  }
  P(`--- ${label} (scale=${lm.scale.toFixed(2)}, reachRadius=${reachRadius(lm).toFixed(1)}u) ---`);
  P(`  fired: ${fireT>=0 ? 'YES' : 'NO'}`);
  if (fireT>=0) {
    P(`  at fire: t=${fireT.toFixed(2)}s  dist-to-center=${fireDist.toFixed(1)}u  forwardDot=${fireFwd.toFixed(1)} (${fireFwd>0?'AHEAD':'BEHIND'} car)`);
    P(`  glow PEAK overall: env=${maxEnv.toFixed(2)} at t=${maxEnvT.toFixed(2)}s, landmark forwardDot=${maxEnvFwd.toFixed(1)} (${maxEnvFwd>0?'ahead':'BEHIND'} car)`);
    P(`  landmark leaves CAMERA view at t=${(lastVisibleT).toFixed(2)}s; env still visible peaked at ${peakSeen.toFixed(2)} (t=${peakSeenT.toFixed(2)}s)`);
    P(`  => MAX glow the player could SEE (landmark in front of camera) = env ${peakSeen.toFixed(2)} of 1.00`);
    P(`     (full pulse peak is env 1.00 at 0.80s → brighten ${(ZEN_LANDMARK.pulseBrighten*100)}% toward white; swell ${(ZEN_LANDMARK.pulseSwell*100)}%)`);
  }
}

it('diag landmark reach', () => {
  P(`constants: reachRadius=${ZEN_LANDMARK.reachRadius}u  pulseSeconds=${ZEN_LANDMARK.pulseSeconds}  pulseBrighten=${ZEN_LANDMARK.pulseBrighten}  pulseSwell=${ZEN_LANDMARK.pulseSwell}`);
  P(`         ringRadius=${ZEN_LANDMARK.ringRadius}  monolithBase=${ZEN_LANDMARK.monolithBase}  camDistance=${ZEN.camDistance}  cruise=${ZEN.maxSpeed}u/s`);
  P('');
  drive(findType(LANDMARK_RING), 'RING (drive-through, no collision)', false);
  P('');
  drive(findType(LANDMARK_ARCH), 'ARCH (drive-through opening, solid pillars)', true);
  P('');
  drive(findType(LANDMARK_MONOLITH), 'MONOLITH (drive-up-to, solid)', true);
  fs.writeFileSync('/tmp/reach.log', log.join('\n') + '\n');
});
