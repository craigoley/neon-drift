/**
 * Zen AIR-TIME (the car detaches and arcs off crests, then lands smoothly). The FEEL is a
 * phone playtest, but the detach CONDITION + flight physics are unit-testable: a sharp
 * crest detaches (capped, gentle); a gentle hill never does; flat/uphill/mild-downslope
 * stays grounded; airborne is a clean parabola that lands without crash/penalty/NaN;
 * and over the real terrain the car never snaps down faster than gravity.
 */
import { describe, expect, it } from 'vitest';
import { createZenVehicle, updateVertical, updateZen } from '../ZenVehicle';
import { heightAt, slopeAlong } from '../ZenHeight';
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

  it('DETACHES off a crest even with LOW upward momentum (the old vy-gate is gone)', () => {
    const v = createZenVehicle();
    v.speed = 80;
    updateVertical(v, 0, 0.1, TICK); // mild approach → vy carried = 8 (< the old gate 16)
    expect(v.airborne).toBe(false);
    updateVertical(v, 0, -0.3, TICK); // crest drops faster than gravity → detach anyway
    expect(v.airborne).toBe(true); // arcs off the crest (used to snap down glued)
  });

  it('NO-SNAP: once it leaves a crest the downward velocity never exceeds free-fall', () => {
    const v = createZenVehicle();
    v.speed = 80;
    updateVertical(v, 0, 0.2, TICK);
    updateVertical(v, 0, -0.4, TICK); // crest → detach
    expect(v.airborne).toBe(true);
    let prevVy = v.vy;
    for (let i = 0; i < 60; i++) {
      updateVertical(v, -1000, 0, TICK); // groundY far below → keep falling
      // the change in vertical velocity never drops faster than gravity (no glued snap)
      expect(v.vy - prevVy).toBeGreaterThanOrEqual(-ZEN.airGravity * TICK - 1e-6);
      prevVy = v.vy;
    }
  });

  it('flat / uphill / gentle downslope stays GROUNDED (only fast-dropping crests detach)', () => {
    for (const s of [0, 0.2, -0.1]) {
      const v = createZenVehicle();
      v.speed = 80;
      v.vy = s * v.speed; // already settled on this slope (no first-frame transient)
      let detached = false;
      for (let i = 0; i < 30; i++) {
        updateVertical(v, 0, s, TICK);
        if (v.airborne) detached = true;
      }
      expect(detached).toBe(false); // a steady slope drops no faster than gravity → grounded
    }
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

describe('Zen air-time — the air-shadow GAP + the raised arc', () => {
  it('grounded: car Y == terrain (shadow under the car); airborne: car Y ABOVE it (a gap)', () => {
    const v = createZenVehicle();
    v.speed = 80;
    // grounded on flat ground (groundY 0): the car sits on the surface → no gap
    updateVertical(v, 0, 0, TICK);
    expect(v.airborne).toBe(false);
    expect(v.y).toBe(0); // car Y == groundY → the terrain-anchored shadow is under the car
    // launch off a sharp crest
    updateVertical(v, 0, 0.4, TICK);
    updateVertical(v, 0, -0.4, TICK);
    expect(v.airborne).toBe(true);
    // mid-flight the car rises clearly ABOVE the terrain (groundY 0) → the shadow GAP
    let maxGap = 0;
    for (let i = 0; i < 60 && v.airborne; i++) {
      updateVertical(v, 0, 0, TICK);
      maxGap = Math.max(maxGap, v.y - 0); // car Y − terrain Y (where the shadow is drawn)
    }
    expect(maxGap).toBeGreaterThan(2); // a clearly visible gap opens between car + shadow
  });

  it('maxLaunchVel gives a TAMED, bounded arc — a real jump, no jarring rocket (consistency fix)', () => {
    const v = createZenVehicle();
    v.speed = 80;
    v.airborne = true;
    v.vy = ZEN.maxLaunchVel;
    let maxY = 0;
    for (let i = 0; i < 300 && v.airborne; i++) {
      updateVertical(v, 0, 0, TICK);
      maxY = Math.max(maxY, v.y);
    }
    const arcCap = (ZEN.maxLaunchVel * ZEN.maxLaunchVel) / (2 * ZEN.airGravity);
    expect(maxY).toBeGreaterThan(3); // still a REAL jump, clearly above the sub-1u micro-hops
    expect(maxY).toBeLessThanOrEqual(arcCap + 0.2); // BOUNDED by the cap — not an orbit
    expect(arcCap).toBeLessThan(6); // cap LOWERED (maxLaunchVel 38→28) to clip the jarring ~9u tail
  });
});

describe('Zen air-time — landing smooths the lurch (no teleport), clean landings unchanged', () => {
  it('a BIG landing discontinuity (flew into high terrain) SETTLES over frames, not a teleport', () => {
    const v = createZenVehicle();
    v.speed = 80;
    v.airborne = true;
    v.vy = -5;
    v.y = 4; // car low...
    const groundY = 22; // ...but the far-side terrain it flew into is 18u higher
    const before = v.y;
    updateVertical(v, groundY, 0, TICK); // the landing frame
    expect(v.airborne).toBe(false);
    expect(v.y - before).toBeLessThanOrEqual(ZEN.maxLandStep + 0.2); // NOT an 18u teleport
    // grounded frames settle the car up to the surface, each step bounded by the cap
    let prev = v.y;
    for (let i = 0; i < 60; i++) {
      updateVertical(v, groundY, 0, TICK);
      expect(v.y - prev).toBeLessThanOrEqual(ZEN.maxLandStep + 1e-6); // every step capped
      prev = v.y;
    }
    expect(v.y).toBeCloseTo(groundY, 1); // ends ON the ground — no permanent hover
    expect(v.airborne).toBe(false);
  });

  it('a normal touch-down still lands INSTANTLY (clean landings feel unchanged)', () => {
    const v = createZenVehicle();
    v.speed = 80;
    v.airborne = true;
    v.vy = -10;
    v.y = 0.1; // a hair above the ground, descending
    updateVertical(v, 0, 0, TICK); // groundY 0, tiny gap < maxLandStep
    expect(v.airborne).toBe(false);
    expect(v.y).toBe(0); // closed fully in one frame — immediate, not laggy
  });
});

describe('Zen air-time — over the REAL terrain: never snaps down faster than gravity', () => {
  it('while airborne over real terrain the car falls under GRAVITY, never faster (no snap)', () => {
    // The old bug glued the car to the descending surface and plunged it down a crest
    // faster than free-fall. Drive the real seeded world; whenever airborne, the car's
    // downward velocity can only grow at gravity. (That crests GIVE air on real terrain is
    // covered by the ramp launch test; the synthetic tests above cover the detach trigger.)
    const v = createZenVehicle();
    let prevVy = 0;
    let airSamples = 0;
    for (let trial = 0; trial < 8; trial++) {
      v.x = trial * 1234;
      v.z = trial * -911;
      v.heading = trial * 0.8;
      v.speed = ZEN.maxSpeed;
      v.airborne = false;
      v.vy = 0;
      for (let i = 0; i < 1500; i++) {
        const slope = v.airborne
          ? 0
          : slopeAlong(ZEN.worldSeed, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
        updateZen(v, 0, 1, TICK, slope);
        const groundY = heightAt(ZEN.worldSeed, v.x, v.z) + ZEN.rideHeight;
        const wasAir = v.airborne;
        updateVertical(v, groundY, slope, TICK);
        if (wasAir && v.airborne) {
          airSamples++;
          expect(v.vy - prevVy).toBeGreaterThanOrEqual(-ZEN.airGravity * TICK - 1e-6);
        }
        prevVy = v.vy;
        expect(Number.isNaN(v.y)).toBe(false);
      }
    }
    expect(airSamples).toBeGreaterThan(0); // the drives DID catch air (so the guarantee was exercised)
  });
});
