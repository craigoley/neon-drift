/**
 * Zen SECRET AREAS (PR1 slice) — the PURE warp logic. A secret area is a TELEPORT to a far,
 * deterministic coordinate band (the world regenerates around you), with save/restore of the only
 * world state (the ZenVehicle). These assert the testable core: the return portal is a real,
 * deterministic gateway; arrival sits in front of it facing it; a gateway crossing is the trigger;
 * and entering-then-returning restores your EXACT prior position. (The fade/teleport/camera-snap
 * orchestration lives in ZenSession over a WebGL renderer — not headless-testable.)
 */
import { describe, expect, it } from 'vitest';
import {
  snapshot,
  restore,
  arrivalPose,
  findReturnPortal,
  crossedAnyGateway,
} from '../ZenSecret';
import { createZenVehicle } from '../ZenVehicle';
import { heightAt } from '../ZenHeight';
import { landmarkForCell, LANDMARK_GATEWAY } from '../ZenLandmarkModel';
import { ZEN, ZEN_SECRET, ZEN_LANDMARK } from '../../utils/constants';

const SEED = ZEN.worldSeed;

describe('Zen secret — snapshot/restore is an EXACT round-trip (you return where you were)', () => {
  it('restore brings back x, z, y, vy, airborne, heading, speed exactly', () => {
    const v = createZenVehicle();
    v.x = 1234.5; v.z = -678.9; v.y = 7.25; v.vy = -3.1; v.airborne = true; v.heading = 0.84; v.speed = 52;
    const saved = snapshot(v);
    // Drive far away + change everything (the "in the secret area" state).
    v.x = 999999; v.z = -555555; v.y = 0; v.vy = 0; v.airborne = false; v.heading = -2; v.speed = 0;
    restore(v, saved);
    expect(v.x).toBe(1234.5);
    expect(v.z).toBe(-678.9);
    expect(v.y).toBe(7.25);
    expect(v.vy).toBe(-3.1);
    expect(v.airborne).toBe(true);
    expect(v.heading).toBe(0.84);
    expect(v.speed).toBe(52);
  });
});

describe('Zen secret — the return portal is a real, DETERMINISTIC gateway', () => {
  it('findReturnPortal returns a GATEWAY near the secret region, same every call (per seed)', () => {
    const a = findReturnPortal(SEED);
    const b = findReturnPortal(SEED);
    expect(a.type).toBe(LANDMARK_GATEWAY);
    expect(b.id).toBe(a.id); // deterministic — the same place every time
    // It really is the placed landmark at its cell (a real world structure, not invented).
    expect(landmarkForCell(SEED, Math.floor(a.x / ZEN_LANDMARK.cellSize), Math.floor(a.z / ZEN_LANDMARK.cellSize))).not.toBeNull();
  });
});

describe('Zen secret — arrival sits IN FRONT of the portal, facing it (drive forward = return)', () => {
  it('places the car arrivalApproach units along the through-axis, heading back toward the portal', () => {
    const portal = findReturnPortal(SEED);
    const pose = arrivalPose(portal);
    const tax = Math.sin(portal.rotationY);
    const taz = Math.cos(portal.rotationY);
    // Distance from the portal centre == arrivalApproach, along the through-axis.
    expect(Math.hypot(pose.x - portal.x, pose.z - portal.z)).toBeCloseTo(ZEN_SECRET.arrivalApproach, 4);
    // The car's forward (sin h, −cos h) points back toward the portal (−through-axis).
    const fx = Math.sin(pose.heading);
    const fz = -Math.cos(pose.heading);
    expect(fx).toBeCloseTo(-tax, 6);
    expect(fz).toBeCloseTo(-taz, 6);
  });

  it('the secret region is FAR from the origin (a place apart, reached only by warp)', () => {
    const portal = findReturnPortal(SEED);
    expect(Math.hypot(portal.x, portal.z)).toBeGreaterThan(100000);
  });
});

describe('Zen secret — a gateway crossing is the warp TRIGGER', () => {
  function findGateway() {
    for (let cz = 0; cz < 120; cz++) for (let cx = 0; cx < 120; cx++) {
      const lm = landmarkForCell(SEED, cx, cz);
      if (lm && lm.type === LANDMARK_GATEWAY) return lm;
    }
    throw new Error('no gateway');
  }

  it('fires when the car crosses a gateway opening, not on a near-miss or a straight pass elsewhere', () => {
    const g = findGateway();
    const tax = Math.sin(g.rotationY);
    const taz = Math.cos(g.rotationY);
    // Straight through the centre along the through-axis → crosses.
    const aheadX = g.x + tax * 8, aheadZ = g.z + taz * 8;
    const behindX = g.x - tax * 8, behindZ = g.z - taz * 8;
    expect(crossedAnyGateway(SEED, aheadX, aheadZ, behindX, behindZ)).toBe(true);
    // Same side both samples (approached, didn't cross) → no trigger.
    expect(crossedAnyGateway(SEED, aheadX, aheadZ, g.x + tax * 4, g.z + taz * 4)).toBe(false);
    // Far from any gateway → no trigger.
    expect(crossedAnyGateway(SEED, g.x + 5000, g.z + 5000, g.x + 5000 + tax, g.z + 5000 + taz)).toBe(false);
  });
});

describe('Zen secret — ENTER → RETURN restores the exact main-world position', () => {
  it('save on enter + teleport away + restore on return = back where you were', () => {
    const v = createZenVehicle();
    v.x = 4321; v.z = -8765; v.heading = 1.1; v.speed = 60;
    v.y = heightAt(SEED, v.x, v.z) + ZEN.rideHeight;
    const home = snapshot(v);

    // ENTER: save + teleport to the secret arrival (in front of the return portal).
    const saved = snapshot(v);
    const pose = arrivalPose(findReturnPortal(SEED));
    v.x = pose.x; v.z = pose.z; v.heading = pose.heading; v.speed = 0; v.vy = 0; v.airborne = false;
    expect(Math.hypot(v.x - home.x, v.z - home.z)).toBeGreaterThan(100000); // really teleported

    // RETURN: restore.
    restore(v, saved);
    expect(v.x).toBe(home.x);
    expect(v.z).toBe(home.z);
    expect(v.heading).toBe(home.heading);
    expect(v.speed).toBe(home.speed);
  });
});
