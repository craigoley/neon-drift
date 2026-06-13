/**
 * Zen BIOME-VARIED TERRAIN — the terrain CHARACTER now varies by biome (not just the look):
 * flat Midnight plains, gentle Aurora dunes, rolling Sunset hills, peaky Dawn mountains. The
 * FEEL is a phone playtest, but the technique is unit-testable: WEIGHTED BLENDING of the two
 * active biomes' STATIONARY height fields by the SAME biomeAt weight the look uses → heightAt
 * stays CONTINUOUS + SEAMLESS (adjacent chunk edges match, transitions are gradual), each
 * biome produces its CHARACTER (Midnight relief << Dawn relief), it's DETERMINISTIC per seed,
 * the #120 NO-SNAP guarantee holds in every biome, and ramps still launch everywhere.
 */
import { describe, expect, it } from 'vitest';
import { heightAt, slopeAlong, rampContribution } from '../ZenHeight';
import { biomeAt, createZenBiomeState } from '../ZenBiome';
import { createZenVehicle, updateZen, updateVertical } from '../ZenVehicle';
import { ZEN, ZEN_BIOME_TERRAIN, ZEN_BIOMES } from '../../utils/constants';

const SEED = ZEN.worldSeed;
const TICK = 1 / 60;

/** The blended-from biome index at (x, z). */
function biomeIndexAt(x: number, z: number): number {
  return biomeAt(SEED, x, z, createZenBiomeState()).from;
}

/** Find points deep inside a region of the target biome (blend 0), with room to drive. */
function findRegions(target: number, n: number): { x: number; z: number }[] {
  const st = createZenBiomeState();
  const out: { x: number; z: number }[] = [];
  for (let r = 200; r < 240000 && out.length < n; r += 137) {
    const x = (r * 13) % 60000 - 30000;
    const z = (r * 29) % 60000 - 30000;
    biomeAt(SEED, x, z, st);
    if (st.from === target && st.blend === 0 && st.to === target) out.push({ x, z });
  }
  return out;
}

/** Local relief (max − min height) over a square patch around (cx, cz). */
function reliefAround(cx: number, cz: number, span = 600, step = 12): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let dx = -span; dx <= span; dx += step) {
    for (let dz = -span; dz <= span; dz += step) {
      const h = heightAt(SEED, cx + dx, cz + dz);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  return hi - lo;
}

describe('Zen biome terrain — continuous + seamless WITH blended per-biome params', () => {
  it('heightAt is a pure function of world coords (adjacent chunks sample identical edges)', () => {
    // Two chunk meshes sharing an edge sample heightAt at the SAME world (x, z); a pure
    // function returns the SAME height → the meshes line up with no crack, in any biome.
    for (let i = 0; i < 500; i++) {
      const x = (i * 131) % 50000 - 25000;
      const z = (i * 277) % 50000 - 25000;
      expect(heightAt(SEED, x, z)).toBe(heightAt(SEED, x, z));
    }
  });

  it('is CONTINUOUS across biome borders — a fine transect never cliffs', () => {
    // Walk a long transect that crosses many biome regions; every small step changes the
    // height by only a little (no discontinuity at a border — the weighted blend is smooth).
    let prev = heightAt(SEED, -20000, 777);
    let crossedABorder = false;
    let lastBiome = biomeIndexAt(-20000, 777);
    for (let d = 0.5; d <= 40000; d += 0.5) {
      const x = -20000 + d;
      const h = heightAt(SEED, x, 777);
      // A 0.5u step over the steepest legitimate terrain (a Dawn ridge or ramp rim) stays
      // small — a cliff at a biome seam would be a large jump.
      expect(Math.abs(h - prev)).toBeLessThan(1.0);
      prev = h;
      const b = biomeIndexAt(x, 777);
      if (b !== lastBiome) crossedABorder = true;
      lastBiome = b;
    }
    expect(crossedABorder).toBe(true); // the transect really did change regions
  });

  it('is deterministic per seed, and a different seed gives a different surface', () => {
    expect(heightAt(SEED, 4321, -8765)).toBe(heightAt(SEED, 4321, -8765));
    let differs = false;
    for (let i = 0; i < 50 && !differs; i++) {
      if (heightAt(SEED + 1, i * 53, i * -31) !== heightAt(SEED, i * 53, i * -31)) differs = true;
    }
    expect(differs).toBe(true);
  });
});

describe('Zen biome terrain — each biome produces its CHARACTER (pronounced contrast)', () => {
  it('the param mapping is ordered: Midnight flattest, Aurora tall dunes, Dawn the peaks', () => {
    const [sunset, midnight, aurora, dawn] = ZEN_BIOME_TERRAIN;
    // Flat plains << rolling hills < tall dunes (hill amplitude ordering).
    expect(midnight.hillAmplitude).toBeLessThan(sunset.hillAmplitude);
    expect(sunset.hillAmplitude).toBeLessThan(aurora.hillAmplitude);
    // Only Dawn (and the baseline Sunset) carry mountains; Midnight + Aurora have none.
    expect(midnight.mountainAmount).toBe(0);
    expect(aurora.mountainAmount).toBe(0);
    expect(dawn.mountainAmount).toBeGreaterThan(sunset.mountainAmount); // Dawn is the peakiest
  });

  it('relief MEASURES the character: Midnight nearly flat, Dawn dramatically peaky', () => {
    const midnight = findRegions(1, 4);
    const dawn = findRegions(3, 4);
    expect(midnight.length).toBeGreaterThan(0);
    expect(dawn.length).toBeGreaterThan(0);
    const midReliefMax = Math.max(...midnight.map((p) => reliefAround(p.x, p.z)));
    const dawnReliefMax = Math.max(...dawn.map((p) => reliefAround(p.x, p.z)));
    // Midnight plains are gentle (a few units of undulation, ignoring a rare ramp dome).
    expect(midReliefMax).toBeLessThan(ZEN.rampHeight + 8);
    // Dawn mountains tower far above the plains — a pronounced, unmistakable contrast.
    expect(dawnReliefMax).toBeGreaterThan(40);
    expect(dawnReliefMax).toBeGreaterThan(midReliefMax * 4);
  });
});

describe('Zen biome terrain — the #120 NO-SNAP guarantee holds in EVERY biome', () => {
  it('never descends faster than gravity (no super-gravity snap) on any terrain', () => {
    // Drive each biome at cruise; while airborne the car is pure ballistic — its downward
    // velocity may only ever GROW by gravity per frame, never a sudden extra drop (a snap).
    // Grounded, the surface-follow is separately capped at maxLandStep (the #118 soft settle).
    const maxFrameGravityDrop = ZEN.airGravity * TICK * 1.001 + 1e-6;
    for (let b = 0; b < ZEN_BIOMES.length; b++) {
      for (const region of findRegions(b, 2)) {
        for (const heading of [0, Math.PI / 2]) {
          const v = createZenVehicle();
          v.x = region.x;
          v.z = region.z;
          v.heading = heading;
          v.speed = ZEN.maxSpeed;
          let prevVy = v.vy;
          let wasAir = v.airborne;
          for (let i = 0; i < 1800; i++) {
            const slope = v.airborne ? 0 : slopeAlong(SEED, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
            updateZen(v, 0, 1, TICK, slope);
            const groundY = heightAt(SEED, v.x, v.z) + ZEN.rideHeight;
            updateVertical(v, groundY, slope, TICK);
            if (wasAir && v.airborne) {
              // Ballistic: vy decreased by AT MOST gravity·dt this frame (never more).
              expect(prevVy - v.vy).toBeLessThanOrEqual(maxFrameGravityDrop);
            }
            prevVy = v.vy;
            wasAir = v.airborne;
          }
        }
      }
    }
  });
});

describe('Zen biome terrain — ramps still place + launch across biomes', () => {
  it('ramps are unchanged by the biome system + occur in multiple distinct biomes', () => {
    // rampContribution is a global gentle-terrain feature, independent of biome params.
    expect(rampContribution(SEED, 123.4, -56.7)).toBe(rampContribution(SEED, 123.4, -56.7));
    const cs = ZEN.rampCellSize;
    const biomesWithRamps = new Set<number>();
    for (let cx = 0; cx < 80 && biomesWithRamps.size < 3; cx++) {
      for (let cz = 0; cz < 80 && biomesWithRamps.size < 3; cz++) {
        const x = cx * cs + cs / 2;
        const z = cz * cs + cs / 2;
        // Scan the cell centre area for a ramp dome.
        for (let ox = -cs / 2 + ZEN.rampRadius; ox < cs / 2 - ZEN.rampRadius; ox += 8) {
          if (rampContribution(SEED, x + ox, z) > ZEN.rampHeight * 0.9) {
            biomesWithRamps.add(biomeIndexAt(x + ox, z));
            break;
          }
        }
      }
    }
    // Ramps are global → they show up under more than one biome's look/terrain.
    expect(biomesWithRamps.size).toBeGreaterThanOrEqual(2);
  });

  it('driving a ramp at cruise still LAUNCHES the car (air-time), with biome terrain', () => {
    // Find any ramp and drive it; the launch still works over the new biome-varied terrain.
    const cs = ZEN.rampCellSize;
    let ramp: { x: number; z: number } | null = null;
    for (let cx = 0; cx < 40 && !ramp; cx++) {
      for (let cz = 0; cz < 40 && !ramp; cz++) {
        for (let ox = ZEN.rampRadius; ox < cs - ZEN.rampRadius && !ramp; ox += 6) {
          for (let oz = ZEN.rampRadius; oz < cs - ZEN.rampRadius; oz += 6) {
            const x = cx * cs + ox;
            const z = cz * cs + oz;
            if (rampContribution(SEED, x, z) > ZEN.rampHeight * 0.97) {
              ramp = { x, z };
              break;
            }
          }
        }
      }
    }
    expect(ramp).not.toBeNull();
    const v = createZenVehicle();
    v.x = ramp!.x;
    v.z = ramp!.z + 70;
    v.heading = 0;
    v.speed = ZEN.maxSpeed;
    let launched = false;
    for (let i = 0; i < 300; i++) {
      const slope = v.airborne ? 0 : slopeAlong(SEED, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
      updateZen(v, 0, 1, TICK, slope);
      const groundY = heightAt(SEED, v.x, v.z) + ZEN.rideHeight;
      const wasAir = v.airborne;
      updateVertical(v, groundY, slope, TICK);
      if (!wasAir && v.airborne) launched = true;
    }
    expect(launched).toBe(true);
  });
});
