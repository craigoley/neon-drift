/**
 * Zen AIR-TIME (the car catches air off sharp crests at speed, then lands smoothly). The
 * FEEL is a phone playtest, but the launch CONDITION + flight physics are unit-testable:
 * a sharp crest at speed launches (capped, gentle); a gentle hill never does; too-slow
 * never does; airborne is a clean parabola that lands without crash/penalty/NaN; and over
 * the real terrain the gentle (mask-off) majority NEVER launches.
 */
import { describe, expect, it } from 'vitest';
import { createZenVehicle, updateVertical, updateZen } from '../ZenVehicle';
import { heightAt, maskAt, slopeAlong } from '../ZenHeight';
import { ZEN } from '../../utils/constants';

const TICK = 1 / 60;

describe('Zen air-time — launch conditions', () => {
  it('a SHARP crest at speed launches the car (upward, but CAPPED — gentle, not violent)', () => {
    const v = createZenVehicle();
    v.speed = 80;
    updateVertical(v, 0, 0.4, TICK); // grounded climb → carries upward surface velocity
    expect(v.airborne).toBe(false);
    updateVertical(v, 0, -0.4, TICK); // crest: surface drops away hard → launch
    expect(v.airborne).toBe(true);
    expect(v.vy).toBeGreaterThan(0); // launched UP
    expect(v.vy).toBeLessThanOrEqual(ZEN.maxLaunchVel); // capped → a float, not a rocket
  });

  it('a GENTLE hill crest does NOT launch (the surface curves too gently)', () => {
    const v = createZenVehicle();
    v.speed = 80;
    let launched = false;
    for (let i = 0; i <= 100; i++) {
      // slope eases +0.3 → -0.3 over ~1.7s (a broad, gentle swell) — gentle curvature.
      updateVertical(v, 0, 0.3 * Math.cos((i / 100) * Math.PI), TICK);
      if (v.airborne) launched = true;
    }
    expect(launched).toBe(false);
  });

  it('too SLOW to launch even on a sharp crest (needs real upward momentum)', () => {
    const v = createZenVehicle();
    v.speed = 10; // crawling
    updateVertical(v, 0, 0.4, TICK);
    updateVertical(v, 0, -0.4, TICK);
    expect(v.airborne).toBe(false); // vy = 0.4×10 = 4 < launchMinUpVel → stays grounded
  });

  it('airborne is a PARABOLA that lands smoothly (no crash / no NaN / no speed penalty)', () => {
    const v = createZenVehicle();
    v.speed = 80;
    v.airborne = true;
    v.vy = ZEN.maxLaunchVel;
    let maxY = 0;
    let landed = false;
    for (let i = 0; i < 600; i++) {
      updateVertical(v, 0, 0, TICK); // groundY = 0
      maxY = Math.max(maxY, v.y);
      expect(Number.isNaN(v.y) || Number.isNaN(v.vy)).toBe(false);
      if (!v.airborne) {
        landed = true;
        break;
      }
    }
    expect(maxY).toBeGreaterThan(2); // there WAS air
    expect(landed).toBe(true); // and it came back down
    expect(v.y).toBe(0); // resting on the surface
    expect(v.vy).toBe(0); // settled
    expect(v.speed).toBe(80); // forward speed untouched — no punishing landing (zen)
  });

  it('IGNORES the slope while airborne (no terrain grip in the air)', () => {
    const v = createZenVehicle();
    v.speed = 80;
    v.airborne = true;
    v.vy = ZEN.maxLaunchVel;
    v.y = 5;
    const vyBefore = v.vy;
    updateVertical(v, 0, 5.0, TICK); // a huge slope arg must be ignored mid-flight
    expect(v.vy).toBeCloseTo(vyBefore - ZEN.airGravity * TICK, 6); // only gravity acted
  });
});

describe('Zen air-time — gentle hills stay grounded over the REAL terrain', () => {
  it('launches ONLY in steep/mountain terrain — gentle hills (mask off) never throw you', () => {
    const v = createZenVehicle();
    let gentleLaunches = 0;
    let launches = 0;
    for (let i = 0; i < 6000; i++) {
      const slope = v.airborne
        ? 0
        : slopeAlong(ZEN.worldSeed, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
      updateZen(v, Math.sin(i * 0.005), 1, TICK, slope); // full throttle, lazy wandering
      const groundY = heightAt(ZEN.worldSeed, v.x, v.z) + ZEN.rideHeight;
      const wasAir = v.airborne;
      updateVertical(v, groundY, slope, TICK);
      if (!wasAir && v.airborne) {
        launches++;
        if (maskAt(ZEN.worldSeed, v.x, v.z) <= 0) gentleLaunches++; // launched on a GENTLE hill?
      }
      expect(Number.isNaN(v.y)).toBe(false);
    }
    expect(gentleLaunches).toBe(0); // the gentle-hills majority NEVER launches (Craig's ask)
    // (launches may be 0+ depending on the path; the synthetic test above proves the
    //  mechanism. This guards the no-accidental-launch invariant on real terrain.)
    expect(launches).toBeGreaterThanOrEqual(0);
  });
});
