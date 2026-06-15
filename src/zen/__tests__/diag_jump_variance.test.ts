/**
 * DIAGNOSTIC ONLY (throwaway, diag/* branch) — measure the VARIANCE of Zen crest-detach jumps
 * across the real biomes + ramps, and CORRELATE the big/jarring ones with candidate triggers.
 * NOT a fix. Mirrors the ZenSession tick (updateZen → updateVertical) at full cruise.
 */
import { describe, it } from 'vitest';
import { ZEN } from '../../utils/constants';
import { createZenVehicle, updateZen, updateVertical } from '../ZenVehicle';
import { heightAt, slopeAlong, rampContribution } from '../ZenHeight';
import { biomeAt, createZenBiomeState } from '../ZenBiome';

const SEED = ZEN.worldSeed;
const DT = 1 / 60;
const NAMES = ['sunset', 'midnight', 'aurora', 'dawn'];

interface Jump {
  biome: number;
  arcH: number;       // peak height above launch (world units)
  durS: number;       // air time (seconds)
  launchVy: number;   // detach vertical velocity
  clamped: boolean;   // launchVy hit maxLaunchVel (the cap)
  landSlope: number;  // terrain slope along heading at landing (+ = into upslope)
  landGap: number;    // groundY − y at the landing frame (how far it had to pop up)
  capHit: boolean;    // landGap > maxLandStep (the #118 settle cap engaged)
  onRamp: boolean;    // a ramp dome under the launch point
}

const _bs = createZenBiomeState();
function dominantBiome(x: number, z: number): number {
  biomeAt(SEED, x, z, _bs);
  return _bs.blend < 0.5 ? _bs.from : _bs.to;
}

/** Drive one straight full-cruise transect, recording every jump. `cap` caps the cruise speed
 *  (to A/B the #121 speed bump 84→96 without touching constants). */
function transect(x0: number, z0: number, heading: number, frames: number, out: Jump[], cap = ZEN.maxSpeed): void {
  const v = createZenVehicle();
  v.x = x0; v.z = z0; v.heading = heading; v.speed = Math.min(cap, ZEN.maxSpeed);
  v.y = heightAt(SEED, v.x, v.z) + ZEN.rideHeight;
  let inAir = false, launchY = 0, launchVy = 0, maxAirY = 0, airFrames = 0, clamped = false, biome = 0, onRamp = false;
  for (let i = 0; i < frames; i++) {
    const dirX = Math.sin(v.heading), dirZ = -Math.cos(v.heading);
    const slope = slopeAlong(SEED, v.x, v.z, dirX, dirZ);
    const groundY = heightAt(SEED, v.x, v.z) + ZEN.rideHeight;
    const preY = v.y, wasAir = v.airborne;
    updateZen(v, 0, 1, DT, slope);          // full throttle, no steer
    if (v.speed > cap) v.speed = cap;        // hold the A/B speed cap
    updateVertical(v, groundY, slope, DT);   // allowAir defaults true (no landmark surface here)
    if (!wasAir && v.airborne) {
      inAir = true; launchY = preY; launchVy = v.vy; maxAirY = v.y; airFrames = 0;
      clamped = v.vy >= ZEN.maxLaunchVel - 1e-6; biome = dominantBiome(v.x, v.z);
      onRamp = rampContribution(SEED, v.x, v.z) > ZEN.rampHeight * 0.25;
    } else if (wasAir && v.airborne) {
      maxAirY = Math.max(maxAirY, v.y); airFrames++;
    } else if (wasAir && !v.airborne && inAir) {
      const landGap = groundY - preY;
      out.push({
        biome, arcH: maxAirY - launchY, durS: airFrames * DT, launchVy, clamped,
        landSlope: slope, landGap, capHit: landGap > ZEN.maxLandStep + 1e-9, onRamp,
      });
      inAir = false;
    }
  }
}

function stats(a: number[]) {
  if (!a.length) return { n: 0, min: 0, max: 0, mean: 0, sd: 0, p50: 0, p90: 0, p99: 0 };
  const s = [...a].sort((x, y) => x - y);
  const mean = a.reduce((p, c) => p + c, 0) / a.length;
  const sd = Math.sqrt(a.reduce((p, c) => p + (c - mean) ** 2, 0) / a.length);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: a.length, min: s[0], max: s[s.length - 1], mean, sd, p50: q(0.5), p90: q(0.9), p99: q(0.99) };
}
const f = (n: number) => n.toFixed(2);

describe('DIAG — Zen jump variance + correlates', () => {
  it('measures arc/duration/landing spread per biome and the correlates', () => {
    const jumps: Jump[] = [];
    // A broad sweep: a grid of start points over ~80km, several headings, long transects.
    const STEP = 1700, SPAN = 24; // 24×24 starts × 4 headings
    for (let gx = 0; gx < SPAN; gx++) for (let gz = 0; gz < SPAN; gz++) {
      const x0 = (gx - SPAN / 2) * STEP, z0 = (gz - SPAN / 2) * STEP;
      for (const h of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 3]) transect(x0, z0, h, 700, jumps);
    }

    console.log('=== ZEN JUMP VARIANCE (full cruise, real terrain) ===');
    console.log('total jumps:', jumps.length, '| airGravity', ZEN.airGravity, 'maxLaunchVel', ZEN.maxLaunchVel,
      'maxLandStep', ZEN.maxLandStep, 'maxSpeed', ZEN.maxSpeed, 'rampHeight', ZEN.rampHeight);

    // Per-biome arc-height spread (the core "inconsistency" measure).
    console.log('\n--- arc height (u) by biome ---');
    for (let b = 0; b < 4; b++) {
      const arr = jumps.filter((j) => j.biome === b).map((j) => j.arcH);
      const s = stats(arr);
      console.log(`${NAMES[b].padEnd(9)} n=${String(s.n).padStart(4)}  min=${f(s.min)} p50=${f(s.p50)} mean=${f(s.mean)} p90=${f(s.p90)} p99=${f(s.p99)} MAX=${f(s.max)} sd=${f(s.sd)}`);
    }
    const allArc = stats(jumps.map((j) => j.arcH));
    console.log(`ALL       n=${String(allArc.n).padStart(4)}  min=${f(allArc.min)} p50=${f(allArc.p50)} mean=${f(allArc.mean)} p90=${f(allArc.p90)} p99=${f(allArc.p99)} MAX=${f(allArc.max)} sd=${f(allArc.sd)}`);

    // Jump FREQUENCY per biome (how often the "same action" even produces air).
    console.log('\n--- jump count share by biome (where the air happens) ---');
    for (let b = 0; b < 4; b++) {
      const n = jumps.filter((j) => j.biome === b).length;
      console.log(`${NAMES[b].padEnd(9)} ${n}  (${(n / jumps.length * 100).toFixed(1)}%)`);
    }

    // Bimodality: tiny hops vs big launches.
    const tiny = jumps.filter((j) => j.arcH < 1).length;
    const big = jumps.filter((j) => j.arcH > 5).length;
    console.log(`\n--- bimodality: arc<1u (hops)=${tiny} (${(tiny/jumps.length*100).toFixed(0)}%)  vs arc>5u (launches)=${big} (${(big/jumps.length*100).toFixed(0)}%)`);
    console.log('launchVy CLAMPED at maxLaunchVel:', jumps.filter((j) => j.clamped).length, `(${(jumps.filter(j=>j.clamped).length/jumps.length*100).toFixed(0)}%)`);

    // LANDING variance: the #118 settle cap, and correlation with landing slope.
    console.log('\n--- landing settle (#118 cap maxLandStep=' + ZEN.maxLandStep + ') ---');
    const capHits = jumps.filter((j) => j.capHit);
    console.log('landings hitting the cap (gap>maxLandStep):', capHits.length, `(${(capHits.length/jumps.length*100).toFixed(0)}%)`);
    const gap = stats(jumps.map((j) => j.landGap));
    console.log(`land gap (u): min=${f(gap.min)} p50=${f(gap.p50)} mean=${f(gap.mean)} p90=${f(gap.p90)} p99=${f(gap.p99)} MAX=${f(gap.max)}`);
    const intoUp = jumps.filter((j) => j.landSlope > 0.15);
    const intoDown = jumps.filter((j) => j.landSlope < -0.15);
    const upCap = intoUp.filter((j) => j.capHit).length;
    const downCap = intoDown.filter((j) => j.capHit).length;
    console.log(`landing INTO upslope: ${intoUp.length}, of which cap-hit ${upCap} (${(upCap/Math.max(1,intoUp.length)*100).toFixed(0)}%)`);
    console.log(`landing INTO downslope: ${intoDown.length}, of which cap-hit ${downCap} (${(downCap/Math.max(1,intoDown.length)*100).toFixed(0)}%)`);
    console.log('mean arcH cap-hit vs not:', f(stats(capHits.map(j=>j.arcH)).mean), 'vs', f(stats(jumps.filter(j=>!j.capHit).map(j=>j.arcH)).mean));

    // RAMP vs ambient crest.
    const ramp = jumps.filter((j) => j.onRamp), amb = jumps.filter((j) => !j.onRamp);
    console.log('\n--- ramp vs ambient-crest jumps ---');
    console.log(`ramp jumps: ${ramp.length} meanArc=${f(stats(ramp.map(j=>j.arcH)).mean)} maxArc=${f(stats(ramp.map(j=>j.arcH)).max)}`);
    console.log(`ambient   : ${amb.length} meanArc=${f(stats(amb.map(j=>j.arcH)).mean)} maxArc=${f(stats(amb.map(j=>j.arcH)).max)}`);
  });

  it('REGRESSION: re-run the same sweep at the OLD vs NEW cruise speed (#121 84→96)', () => {
    const STEP = 1700, SPAN = 16;
    for (const cap of [84, 96]) {
      const jumps: Jump[] = [];
      for (let gx = 0; gx < SPAN; gx++) for (let gz = 0; gz < SPAN; gz++) {
        const x0 = (gx - SPAN / 2) * STEP, z0 = (gz - SPAN / 2) * STEP;
        for (const h of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 3]) transect(x0, z0, h, 700, jumps, cap);
      }
      const big = jumps.filter((j) => j.arcH > 5).length;
      const capHit = jumps.filter((j) => j.capHit).length;
      const gap = stats(jumps.map((j) => j.landGap));
      const arc = stats(jumps.map((j) => j.arcH));
      console.log(`\nspeed ${cap}: jumps=${jumps.length} arc>5u=${big} maxArc=${f(arc.max)} arcP99=${f(arc.p99)} ` +
        `capHitLandings=${capHit}(${(capHit/jumps.length*100).toFixed(0)}%) gapP99=${f(gap.p99)} gapMax=${f(gap.max)}`);
    }
  });
});
