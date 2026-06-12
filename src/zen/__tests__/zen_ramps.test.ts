/**
 * Zen RAMPS / DUNES (discovery #1) — sparse, designed launch spots added into heightAt.
 * The FEEL is a phone playtest, but the placement + launch are unit-testable: ramps are
 * DETERMINISTIC + SPARSE, sit in GENTLE terrain (clean landing by placement), the dome is
 * CONTINUOUS (seams across chunks), and driving one at cruise reliably catches air.
 */
import { describe, expect, it } from 'vitest';
import { rampContribution, maskAt, heightAt, slopeAlong } from '../ZenHeight';
import { createZenVehicle, updateZen, updateVertical } from '../ZenVehicle';
import { ZEN } from '../../utils/constants';

const SEED = ZEN.worldSeed;
const TICK = 1 / 60;

/** Find the centre of the first ramp by scanning ramp cells (peak ramp contribution). */
function findRamp(): { x: number; z: number } {
  const cs = ZEN.rampCellSize;
  for (let cx = 0; cx < 60; cx++) {
    for (let cz = 0; cz < 60; cz++) {
      for (let ox = ZEN.rampRadius; ox < cs - ZEN.rampRadius; ox += 6) {
        for (let oz = ZEN.rampRadius; oz < cs - ZEN.rampRadius; oz += 6) {
          const x = cx * cs + ox;
          const z = cz * cs + oz;
          if (rampContribution(SEED, x, z) > ZEN.rampHeight * 0.97) return { x, z };
        }
      }
    }
  }
  throw new Error('no ramp found');
}

describe('Zen ramps — placement is deterministic, sparse, and in gentle terrain', () => {
  it('is deterministic per seed (same coords → same ramp contribution)', () => {
    const r = findRamp();
    expect(rampContribution(SEED, r.x, r.z)).toBe(rampContribution(SEED, r.x, r.z));
    expect(rampContribution(SEED, r.x, r.z)).toBeGreaterThan(0); // a ramp IS there
  });

  it('is SPARSE — only a small fraction of the world is ramp surface (a find, not litter)', () => {
    let onRamp = 0;
    let total = 0;
    for (let i = 0; i < 40000; i++) {
      const x = (i * 37) % 8000 - 4000;
      const z = (i * 53) % 8000 - 4000;
      total++;
      if (rampContribution(SEED, x, z) > 0.05) onRamp++;
    }
    expect(onRamp / total).toBeLessThan(0.03); // < 3% of the world is ramp — sparse
    expect(onRamp).toBeGreaterThan(0); // but they DO exist
  });

  it('ramps sit in GENTLE terrain (mask off) so the launch lands in open ground', () => {
    // Every ramp centre we can find is gated to mask ≤ rampMaxMask → no mountain launches.
    const cs = ZEN.rampCellSize;
    let checked = 0;
    for (let cx = 0; cx < 30 && checked < 5; cx++) {
      for (let cz = 0; cz < 30 && checked < 5; cz++) {
        for (let ox = ZEN.rampRadius; ox < cs - ZEN.rampRadius; ox += 6) {
          let hit = false;
          for (let oz = ZEN.rampRadius; oz < cs - ZEN.rampRadius; oz += 6) {
            const x = cx * cs + ox;
            const z = cz * cs + oz;
            if (rampContribution(SEED, x, z) > ZEN.rampHeight * 0.97) {
              expect(maskAt(SEED, x, z)).toBeLessThanOrEqual(ZEN.rampMaxMask);
              checked++;
              hit = true;
              break;
            }
          }
          if (hit) break;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('Zen ramps — continuous (seamless) + reliably launch at cruise', () => {
  it('the dome is CONTINUOUS — blends to 0 at its rim (no crack across chunk edges)', () => {
    const r = findRamp();
    // Sample radially outward across the rim: contribution decreases smoothly to 0, no jump.
    let prev = rampContribution(SEED, r.x, r.z);
    for (let d = 0; d <= ZEN.rampRadius + 6; d += 0.5) {
      const v = rampContribution(SEED, r.x + d, r.z);
      expect(Math.abs(v - prev)).toBeLessThan(1.0); // smooth step-to-step, never a cliff
      prev = v;
    }
    expect(rampContribution(SEED, r.x + ZEN.rampRadius + 1, r.z)).toBe(0); // 0 beyond the rim
  });

  it('driving straight through a ramp at cruise reliably LAUNCHES the car (air-time)', () => {
    const r = findRamp();
    const v = createZenVehicle();
    v.x = r.x;
    v.z = r.z + 70; // approach from +z
    v.heading = 0; // face -z (forward) → drive toward the ramp
    v.speed = ZEN.maxSpeed;
    let launched = false;
    let maxAir = 0;
    for (let i = 0; i < 300; i++) {
      const slope = v.airborne ? 0 : slopeAlong(SEED, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
      updateZen(v, 0, 1, TICK, slope);
      const groundY = heightAt(SEED, v.x, v.z) + ZEN.rideHeight;
      const wasAir = v.airborne;
      updateVertical(v, groundY, slope, TICK);
      if (!wasAir && v.airborne) launched = true;
      if (v.airborne) maxAir = Math.max(maxAir, v.y - groundY);
    }
    expect(launched).toBe(true); // a ramp is terrain SHAPED to launch you — it does
    expect(maxAir).toBeGreaterThan(3); // a satisfying arc, not a nudge
  });

  it('a ramp is a DISTINCTLY bigger jump than an ambient crest hop, and LANDS soft', () => {
    // Post-#120 every crest gives a little gentle air (ambient hops are sub-unit). A ramp
    // must read as THE bigger intentional jump — and still settle softly (#118) on landing.
    const r = findRamp();
    const v = createZenVehicle();
    v.x = r.x;
    v.z = r.z + 80;
    v.heading = 0;
    v.speed = ZEN.maxSpeed;
    let maxAir = 0;
    let maxSettleStep = 0;
    let prevY = v.y;
    for (let i = 0; i < 400; i++) {
      const slope = v.airborne ? 0 : slopeAlong(SEED, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
      updateZen(v, 0, 1, TICK, slope);
      const groundY = heightAt(SEED, v.x, v.z) + ZEN.rideHeight;
      const wasAir = v.airborne;
      updateVertical(v, groundY, slope, TICK);
      if (v.airborne) maxAir = Math.max(maxAir, v.y - groundY);
      if (!v.airborne && wasAir === false) maxSettleStep = Math.max(maxSettleStep, Math.abs(v.y - prevY)); // grounded settle step
      prevY = v.y;
    }
    expect(maxAir).toBeGreaterThan(6); // a BIG jump — far above the ~sub-unit ambient crest hops
    expect(v.airborne).toBe(false); // came back down — lands, no permanent hover
    expect(maxSettleStep).toBeLessThanOrEqual(ZEN.maxLandStep + 1e-6); // grounded settle stays #118-soft
  });
});
