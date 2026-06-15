/**
 * Zen JUMP CONSISTENCY (the "inconsistent jumping" fix). The diagnostic showed: 99% of crest
 * detaches are pleasant sub-1u micro-hops, but a thin OUTLIER TAIL (peaky biomes) produced 5-9u
 * launches that LAND HARDEST (into a rising far-side → a soft multi-frame float-up). Three changes
 * tame the tail WITHOUT touching the good micro-hops:
 *   FIX 1  maxLaunchVel 38→28   — clip the big-launch arc cap (~9u → ~4.9u); sub-cap hops untouched.
 *   FIX 2  slope-aware landing  — a steep rising far-side is ridden UP at its own climb rate (firm,
 *                                bounded by landSettleCeil), not floated up over many frames; a FLAT
 *                                far-side / wall still eases gently (the #118 no-lurch property).
 *   FIX 3  Dawn mountainAmount 2.0→1.4 — temper the biome that spawns the outlier crests, while it
 *                                stays the airiest biome (> Sunset > flat Midnight/Aurora).
 * These assert each property so a regression that re-inflates the tail (or flattens the hops) FAILS.
 */
import { describe, expect, it } from 'vitest';
import { createZenVehicle, updateVertical, updateZen } from '../ZenVehicle';
import { heightAt, slopeAlong } from '../ZenHeight';
import { biomeAt, createZenBiomeState } from '../ZenBiome';
import { ZEN, ZEN_BIOME_TERRAIN } from '../../utils/constants';

const TICK = 1 / 60;
const SEED = ZEN.worldSeed;

describe('Zen jump consistency — the outlier launch tail is clipped (FIX 1)', () => {
  it('the MAX arc is bounded by the lowered cap (~4.9u), not the old jarring ~9u', () => {
    const arcCap = (ZEN.maxLaunchVel * ZEN.maxLaunchVel) / (2 * ZEN.airGravity);
    expect(arcCap).toBeLessThan(6);     // tamed (was ~9.0u at maxLaunchVel 38)
    expect(arcCap).toBeGreaterThan(3.5); // still a REAL jump, not flattened
    // A maximal launch arcs to ~arcCap and no higher.
    const v = createZenVehicle();
    v.airborne = true;
    v.vy = ZEN.maxLaunchVel;
    let maxY = 0;
    for (let i = 0; i < 300 && v.airborne; i++) { updateVertical(v, 0, 0, TICK); maxY = Math.max(maxY, v.y); }
    expect(maxY).toBeLessThanOrEqual(arcCap + 0.2);
  });

  it('a crest can NEVER detach with more than the (lowered) cap — even a near-vertical face', () => {
    const v = createZenVehicle();
    v.speed = ZEN.maxSpeed;
    // A violent crest: a big climb then a sharp drop. The launch vy is clamped to the cap.
    updateVertical(v, 0, 3, TICK);    // steep grounded climb → large surface vy
    updateVertical(v, 0, -5, TICK);   // sharp crest → detach
    expect(v.airborne).toBe(true);
    expect(v.vy).toBeLessThanOrEqual(ZEN.maxLaunchVel + 1e-9); // clipped, not a rocket
  });
});

describe('Zen jump consistency — the gentle micro-hops are PRESERVED (only the tail moved)', () => {
  it('a gentle crest still DETACHES (the #120 bounciness is the good part — kept)', () => {
    const v = createZenVehicle();
    v.speed = ZEN.maxSpeed;
    updateVertical(v, 0, 0.5, TICK);   // mild climb
    updateVertical(v, 0, -0.5, TICK);  // gentle crest
    expect(v.airborne).toBe(true);     // still hops — we did NOT kill the crest-detach feel
  });

  it('a sub-cap launch arcs EXACTLY as before — the cap only clips the outlier top', () => {
    // A small launch (vy well under the cap) is untouched by maxLaunchVel: arc = vy²/2g.
    const vy = 8; // far below the 28 cap
    const v = createZenVehicle();
    v.airborne = true;
    v.vy = vy;
    let maxY = 0;
    for (let i = 0; i < 120 && v.airborne; i++) { updateVertical(v, 0, 0, TICK); maxY = Math.max(maxY, v.y); }
    // A small sub-cap hop (~vy²/2g ≈ 0.4u): clearly present (not clipped to nothing) and clearly a
    // micro-hop (nowhere near the ~4.9u cap) — the cap (28) doesn't touch launches below it.
    expect(maxY).toBeGreaterThan(0.25);
    expect(maxY).toBeLessThan(0.6);
  });
});

describe('Zen jump consistency — the landing is SLOPE-AWARE (FIX 2)', () => {
  it('landing into a STEEP rising far-side rides UP firmly (no float-up) — clears > maxLandStep', () => {
    const v = createZenVehicle();
    v.speed = ZEN.maxSpeed;
    v.airborne = true;
    v.vy = -10;        // descending
    v.y = 5;
    const groundY = 9; // the far-side ground is 4u above the falling car (a rising mountain face)
    updateVertical(v, groundY, 3, TICK); // steep upslope → firm, slope-matched catch-up
    expect(v.airborne).toBe(false);
    // The firm rate (|slope|·speed·landRideFactor, ceil landSettleCeil) clears the whole gap at once
    // — the car is ON the surface, not floating below it.
    expect(v.y).toBeCloseTo(groundY, 5);
  });

  it('a FLAT far-side / wall still EASES (no firm ride-up, no teleport — #118 preserved)', () => {
    const v = createZenVehicle();
    v.speed = ZEN.maxSpeed;
    v.airborne = true;
    v.vy = -10;
    v.y = 5;
    const groundY = 12; // a big gap but FLAT far-side (slope 0) → not a slope to ride up
    updateVertical(v, groundY, 0, TICK); // slope 0 → firm rate floors at maxLandStep
    expect(v.airborne).toBe(false);
    // Only maxLandStep is cleared this frame (the rest eases over frames) — the anti-lurch guarantee.
    expect(v.y).toBeLessThan(groundY);
    expect(groundY - v.y).toBeGreaterThan(0); // still below → will ease up gently, no teleport
  });

  it('a CLEAN touch-down (small gap) still snaps instantly — gentle landings unchanged', () => {
    const v = createZenVehicle();
    v.speed = ZEN.maxSpeed;
    v.airborne = true;
    v.vy = -6;
    v.y = 0.1;
    updateVertical(v, 0, 0, TICK); // tiny gap, flat → lands cleanly
    expect(v.airborne).toBe(false);
    expect(v.y).toBeCloseTo(0, 5);
  });
});

describe('Zen jump consistency — Dawn is TEMPERED but still the airiest biome (FIX 3)', () => {
  it('Dawn still has the most mountains (> Sunset > flat Midnight/Aurora), just less extreme', () => {
    const [sunset, midnight, aurora, dawn] = ZEN_BIOME_TERRAIN;
    expect(dawn.mountainAmount).toBeGreaterThan(sunset.mountainAmount); // still the peakiest
    expect(dawn.mountainAmount).toBeLessThan(2.0);                      // tempered from the old 2.0
    expect(dawn.mountainAmount).toBeGreaterThanOrEqual(1.3);            // not flattened (still airy)
    expect(midnight.mountainAmount).toBe(0);                            // flat plains
    expect(aurora.mountainAmount).toBe(0);                             // gentle dunes, no mountains
  });

  it('over real terrain, Dawn STILL gives more air than the flat biomes (peaky identity kept)', () => {
    // Find a dawn-dominant and an aurora-dominant start, drive a transect in each, compare air time.
    const findBiome = (target: number): { x: number; z: number } => {
      const bs = createZenBiomeState();
      for (let r = 1; r < 4000; r++) {
        const x = (r * 137) % 60000 - 30000, z = (r * 311) % 60000 - 30000;
        biomeAt(SEED, x, z, bs);
        if ((bs.blend < 0.3 ? bs.from : bs.to) === target) return { x, z };
      }
      throw new Error(`no region for biome ${target}`);
    };
    const airFraction = (start: { x: number; z: number }): number => {
      const v = createZenVehicle();
      v.x = start.x; v.z = start.z; v.speed = ZEN.maxSpeed;
      v.y = heightAt(SEED, v.x, v.z) + ZEN.rideHeight;
      let air = 0, n = 0;
      for (let h = 0; h < 4; h++) {
        v.heading = h * (Math.PI / 2);
        for (let i = 0; i < 1500; i++) {
          const dirX = Math.sin(v.heading), dirZ = -Math.cos(v.heading);
          const slope = slopeAlong(SEED, v.x, v.z, dirX, dirZ);
          updateZen(v, 0, 1, TICK, v.airborne ? 0 : slope);
          const groundY = heightAt(SEED, v.x, v.z) + ZEN.rideHeight;
          updateVertical(v, groundY, slope, TICK);
          if (v.airborne) air++;
          n++;
        }
      }
      return air / n;
    };
    const dawnAir = airFraction(findBiome(3));   // DAWN
    const auroraAir = airFraction(findBiome(2)); // AURORA (flat dunes)
    expect(dawnAir).toBeGreaterThan(auroraAir); // Dawn is still the airy mountain biome
  });
});
