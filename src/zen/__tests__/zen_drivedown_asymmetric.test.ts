/**
 * Zen TUNNEL DRIVE-DOWN — Stage B: THE ASYMMETRIC PROFILE CANARY (the re-verify gate).
 *
 * Stage A proved the tunnel-floor → centre-basin seam is pop-free behind the flag. Stage B makes the
 * depth profile ASYMMETRIC so the descent actually REACHES + STAYS in the basin: the ENTRY mouth still
 * eases up to the surface (drive in normally, no snap), but the FAR half HOLDS FULL DEPTH instead of
 * windowing back up. This edits tunnelDepthFactor — the SHARED pure floor function (mesh + surface,
 * #149 unify; bounded by the #154 corridor + the centre basin seam) — so the canary MUST re-verify.
 *
 * SAFETY: the asymmetric profile is FLAG-GATED (ZEN_DRIVEDOWN.enabled, OFF in production). Flag OFF →
 * tunnelDepthFactor is the original SYMMETRIC function, byte-identical → the #158 warp + the normal
 * tunnel surface un-regressed. These tests flip it on to drive the ACTUAL asymmetric descent + seam
 * (the #153 lesson: test where the pop would be, off-centre). If any go RED, Stage B FAILED → keep
 * the symmetric tunnel + the warp.
 *
 * Asserted on the asymmetric profile (flag ON):
 *  • the ENTRY mouth eases (no snap), the FAR half holds full depth (factor = 1, stays deep);
 *  • the transition entry-ramp → far-flat is smooth (no kink at the deep core);
 *  • toggles == 0 across the descent + the seam + the basin (offsets [0,12,20,28]);
 *  • maxStep < 0.6 through the descent, the seam, and the deep far half;
 *  • Y-continuity ≈ 0 at the seam (far-end-deep == basin floor == the cross-anchored deep Y);
 *  • the #154 corridor invariant holds;
 *  • the unified mesh formula == the followed surface on the asymmetric tunnel + basin.
 * And FLAG OFF → the symmetric profile is byte-identical (the far mouth windows back up).
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { queryDrivableSurface, surfaceSlopeAlong } from '../ZenLandmarkSurface';
import { createZenVehicle, updateZen, updateVertical } from '../ZenVehicle';
import { heightAt } from '../ZenHeight';
import {
  landmarksInRadius,
  tunnelDepthFactor,
  tunnelBasinDepthFactor,
  LANDMARK_TUNNEL,
} from '../ZenLandmarkModel';
import { ZEN, ZEN_LANDMARK, ZEN_DRIVEDOWN } from '../../utils/constants';
import { smoothstep } from '../ZenNoise';

const seed = ZEN.worldSeed;
const tun = landmarksInRadius(seed, 0, 0, 40000)
  .filter((l) => l.type === LANDMARK_TUNNEL)
  .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
const tx = Math.sin(tun.rotationY);
const tz = Math.cos(tun.rotationY);
const hw = ZEN_LANDMARK.tunnelHalfWidth * tun.scale;
const halfL = ZEN_LANDMARK.tunnelLength * tun.scale * 0.5;
const flatR = ZEN_DRIVEDOWN.basinFlatRadius * tun.scale;
const rimR = ZEN_DRIVEDOWN.basinRimRadius * tun.scale;
const centreGround = heightAt(seed, tun.x, tun.z);
const deepY = centreGround - ZEN_LANDMARK.tunnelDepth * tun.scale;
/** World point at axial `along` + lateral `perp` from the tunnel centre. ENTRY = −along, FAR = +along. */
const at = (along: number, perp: number) => ({ x: tun.x + along * tx - perp * tz, z: tun.z + along * tz + perp * tx });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setFlag = (on: boolean) => { (ZEN_DRIVEDOWN as any).enabled = on; };

describe('Zen drive-down Stage B — FLAG OFF: tunnelDepthFactor is the SYMMETRIC profile (warp un-regressed)', () => {
  it('eases to 0 at BOTH mouths and is byte-identical to 1 − smoothstep(easeStart,1,|t|)', () => {
    setFlag(false);
    const sym = (t: number) => 1 - smoothstep(ZEN_LANDMARK.tunnelDepthEaseStart, 1, Math.abs(t));
    for (let t = -1; t <= 1.0001; t += 0.05) {
      expect(tunnelDepthFactor(t)).toBeCloseTo(sym(t), 12); // exactly the original function
    }
    expect(tunnelDepthFactor(1)).toBeCloseTo(0, 12); // FAR mouth windows back UP (the warp's tunnel)
    expect(tunnelDepthFactor(-1)).toBeCloseTo(0, 12); // ENTRY mouth at the surface
    expect(tunnelDepthFactor(0)).toBeCloseTo(1, 12); // deep at the centre
  });

  it('the far half outside-the-tube is plain terrain (no basin) — the normal tunnel unchanged', () => {
    setFlag(false);
    const p = at(0, hw + 20); // a point just outside the tube wall at the centre
    const s = queryDrivableSurface(seed, p.x, p.z);
    expect(s.onSurface).toBe(false);
    expect(s.y).toBeCloseTo(heightAt(seed, p.x, p.z), 6);
  });
});

describe('Zen drive-down Stage B — FLAG ON: the ASYMMETRIC depth profile (entry eases / far holds deep)', () => {
  beforeAll(() => setFlag(true));
  afterAll(() => setFlag(false)); // never leak the flag to other tests / production

  it('ENTRY mouth eases to 0; FAR half holds FULL depth (factor = 1); the deep core is continuous', () => {
    // ENTRY side (t < 0): identical to the symmetric ease — drive in from the surface, no snap.
    const sym = (t: number) => 1 - smoothstep(ZEN_LANDMARK.tunnelDepthEaseStart, 1, Math.abs(t));
    for (let t = -1; t < 0; t += 0.05) expect(tunnelDepthFactor(t)).toBeCloseTo(sym(t), 12);
    expect(tunnelDepthFactor(-1)).toBeCloseTo(0, 12); // entry mouth still at the surface (eased)
    // FAR side (t ≥ 0): HOLDS FULL DEPTH — stays deep instead of windowing back up.
    for (let t = 0; t <= 1.0001; t += 0.02) expect(tunnelDepthFactor(t)).toBe(1);
    expect(tunnelDepthFactor(1)).toBe(1); // FAR mouth held deep (was 0 in the symmetric profile)
    // The transition is FLAT across the deep core: the symmetric entry ramp is already 1 for
    // |t| ≤ easeStart, so both sides meet at 1 around t = 0 → no kink (the descent grade is gentle).
    expect(tunnelDepthFactor(-ZEN_LANDMARK.tunnelDepthEaseStart)).toBeCloseTo(1, 12);
    expect(tunnelDepthFactor(-0.01)).toBeCloseTo(1, 12);
    expect(tunnelDepthFactor(0.01)).toBe(1);
  });

  it('the asymmetric profile adds NO new grade: its entry ramp == the symmetric ramp, far half is flat', () => {
    // The real claim about steepness: making the far half hold deep introduces no steeper segment than
    // the symmetric tunnel that already ships. Sample BOTH profiles densely and compare the worst
    // per-step Y change — the asymmetric max must NOT exceed the symmetric max (both come from the
    // identical entry ramp; the far half is dead-flat vs the symmetric far ramp of equal grade). (The
    // absolute per-frame maxStep < 0.6 the canary cares about is asserted by the driven test below;
    // the raw per-rib delta here is the same as today's shipping tunnel — not a new cliff.)
    const sym = (t: number) => 1 - smoothstep(ZEN_LANDMARK.tunnelDepthEaseStart, 1, Math.abs(t));
    const dstep = halfL * 1e-3; // far finer than rib spacing → captures the steepest smoothstep point
    let asymMax = 0, symMax = 0, farMax = 0;
    let pa: number | null = null, ps: number | null = null;
    for (let along = -halfL; along <= halfL + 1e-6; along += dstep) {
      const ya = centreGround - ZEN_LANDMARK.tunnelDepth * tun.scale * tunnelDepthFactor(along / halfL);
      const ysm = centreGround - ZEN_LANDMARK.tunnelDepth * tun.scale * sym(along / halfL);
      if (pa !== null) {
        asymMax = Math.max(asymMax, Math.abs(ya - pa));
        if (along > 0) farMax = Math.max(farMax, Math.abs(ya - pa)); // the held-deep far half
      }
      if (ps !== null) symMax = Math.max(symMax, Math.abs(ysm - ps));
      pa = ya; ps = ysm;
    }
    expect(asymMax, 'asymmetric grade is no steeper than the shipping symmetric ramp').toBeLessThanOrEqual(symMax + 1e-9);
    expect(farMax, 'the far half is dead-flat (held deep, zero grade)').toBeLessThan(1e-9);
  });

  it('Y-EQUALITY at the seam: across the tube wall inTube Y == basin Y == the cross-anchored deep Y', () => {
    // Unchanged from Stage A — the basin sits in the deep core where the tube is at full depth in BOTH
    // profiles, so making the far half deep does NOT disturb the centre seam. Re-verified on flag ON.
    for (const along of [0, 100, 200, -150]) {
      const inside = at(along, hw - 1.5);
      const outside = at(along, hw + 1.5);
      const si = queryDrivableSurface(seed, inside.x, inside.z);
      const so = queryDrivableSurface(seed, outside.x, outside.z);
      expect(si.onSurface, `inTube@${along}`).toBe(true);
      expect(so.onSurface, `basin@${along}`).toBe(true);
      expect(Math.abs(si.y - so.y), `seam ΔY@${along}`).toBeLessThan(0.01);
      expect(si.y).toBeCloseTo(deepY, 2);
    }
  });

  it('DRIVING the round trip: in the ENTRY mouth → deep → STAYS deep through the far half → no pop', () => {
    // The continuous descent the asymmetry exists for: enter the ENTRY mouth (−along), descend the
    // eased ramp, and — crucially — keep going PAST the centre into the FAR half and verify it STAYS
    // deep (does NOT window back up). Off-centre, in the #154 corridor (the #153 lesson). Stop before
    // the far-mouth terminus (the known Stage-C handoff where the held-deep floor meets terrain).
    const farWindowEnd = halfL * 0.85; // assert the deep run up to here; the terminus is out of scope
    for (const offset of [0, 12, 20, 28]) {
      const dt = 1 / 60;
      const v = createZenVehicle();
      v.x = tun.x - tx * (halfL + 30) + -tz * offset; // outside the ENTRY mouth, off-centre
      v.z = tun.z - tz * (halfL + 30) + tx * offset;
      v.heading = Math.PI - tun.rotationY; // forward = +axis (into the entry, toward the far end)
      v.y = heightAt(seed, v.x, v.z) + ZEN.rideHeight;
      v.speed = 80;
      let toggles = 0, maxStep = 0, lastOn: boolean | null = null;
      let descended = false, reachedFar = false, roseInFar = false;
      for (let f = 0; f < 2000; f++) {
        const slope = surfaceSlopeAlong(seed, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
        updateZen(v, 0, 1, dt, v.airborne ? 0 : slope);
        const surf = queryDrivableSurface(seed, v.x, v.z);
        const prevY = v.y;
        updateVertical(v, surf.y + ZEN.rideHeight, slope, dt, !surf.onSurface);
        expect(Number.isFinite(v.y)).toBe(true);
        const along = (v.x - tun.x) * tx + (v.z - tun.z) * tz;
        if (Math.abs(along) < halfL - 3) {
          maxStep = Math.max(maxStep, Math.abs(v.y - prevY));
          if (lastOn !== null && lastOn !== surf.onSurface) toggles++;
          lastOn = surf.onSurface;
          if (v.y < -2) descended = true;
        }
        // In the FAR half (along > 0, away from the entry ramp), the floor must STAY deep — the
        // surface should be the cross-anchored deepY, and the car must NOT rise back to the surface.
        if (along > flatR && along < farWindowEnd) {
          reachedFar = true;
          expect(surf.onSurface, `far stays on the tunnel surface (offset ${offset})`).toBe(true);
          expect(surf.y, `far surface held at the deep Y (offset ${offset})`).toBeCloseTo(deepY, 2);
          if (v.y > centreGround - ZEN_LANDMARK.tunnelEnclosedDepth) roseInFar = true; // came back up
        }
        if (along > farWindowEnd) break; // proven the held-deep run; stop short of the far-mouth terminus
      }
      expect(descended, `offset ${offset} descended into the tunnel`).toBe(true);
      expect(reachedFar, `offset ${offset} drove on into the held-deep far half`).toBe(true);
      expect(roseInFar, `offset ${offset} did NOT window back up in the far half (it holds deep)`).toBe(false);
      expect(toggles, `offset ${offset} → no pop (onSurface never flickers)`).toBe(0);
      expect(maxStep, `offset ${offset} → smooth descent (maxStep < 0.6)`).toBeLessThan(0.6);
    }
  });

  it('DRIVING back UP and OUT the entry mouth: the eased ascent is pop-free (the return leg)', () => {
    // The sign-off's return: from the deep core, head back toward the ENTRY mouth (−axis) and rise the
    // eased ramp out to the surface. The entry ramp is identical to the symmetric profile, so the
    // ascent must be as smooth as the descent — no snap at the mouth, no flicker.
    for (const offset of [0, 20, 28]) {
      const dt = 1 / 60;
      const v = createZenVehicle();
      const start = at(-flatR * 0.5, offset); // deep in the entry-side core, off-centre
      v.x = start.x; v.z = start.z;
      v.heading = -tun.rotationY; // forward = −axis (toward the entry mouth)
      v.y = deepY + ZEN.rideHeight;
      v.speed = 80;
      let toggles = 0, maxStep = 0, lastOn: boolean | null = null, surfaced = false;
      for (let f = 0; f < 1400; f++) {
        const slope = surfaceSlopeAlong(seed, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
        updateZen(v, 0, 1, dt, v.airborne ? 0 : slope);
        const surf = queryDrivableSurface(seed, v.x, v.z);
        const prevY = v.y;
        updateVertical(v, surf.y + ZEN.rideHeight, slope, dt, !surf.onSurface);
        expect(Number.isFinite(v.y)).toBe(true);
        const along = (v.x - tun.x) * tx + (v.z - tun.z) * tz;
        if (along > -(halfL - 3)) {
          maxStep = Math.max(maxStep, Math.abs(v.y - prevY));
          if (lastOn !== null && lastOn !== surf.onSurface) toggles++;
          lastOn = surf.onSurface;
        }
        if (along < -(halfL + 5)) { surfaced = true; break; } // drove out the entry mouth onto terrain
      }
      expect(surfaced, `offset ${offset} drove back up and out the entry mouth`).toBe(true);
      expect(toggles, `offset ${offset} → no pop on the ascent (≤ 1: the single mouth handoff)`).toBeLessThanOrEqual(1);
      expect(maxStep, `offset ${offset} → smooth ascent (maxStep < 0.6)`).toBeLessThan(0.6);
    }
  });

  it('DRIVING the seam LATERALLY: tube floor hands off to the basin pop-free (the #153 off-centre case)', () => {
    // Cross the centre basin seam sideways (the real handoff, not the un-failable centred case). With
    // the far half now deep, the seam itself is unchanged (deep core), so this must stay green.
    const dt = 1 / 60;
    const v = createZenVehicle();
    const start = at(0, -(rimR + 50)); // on terrain outside the room, heading straight ACROSS the tube
    v.x = start.x; v.z = start.z; v.heading = Math.atan2(-tz, -tx); // forward = +perp
    v.y = heightAt(seed, v.x, v.z) + ZEN.rideHeight;
    v.speed = 80;
    let seamToggles = 0, seamMaxStep = 0, wholeMaxStep = 0, lastOn: boolean | null = null;
    let crossedTube = false, enteredBasin = false;
    for (let f = 0; f < 900; f++) {
      const slope = surfaceSlopeAlong(seed, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
      updateZen(v, 0, 1, dt, v.airborne ? 0 : slope);
      const surf = queryDrivableSurface(seed, v.x, v.z);
      const prevY = v.y;
      updateVertical(v, surf.y + ZEN.rideHeight, slope, dt, !surf.onSurface);
      expect(Number.isFinite(v.y)).toBe(true);
      const along = (v.x - tun.x) * tx + (v.z - tun.z) * tz;
      const perp = -(v.x - tun.x) * tz + (v.z - tun.z) * tx;
      const r = Math.hypot(along, perp);
      wholeMaxStep = Math.max(wholeMaxStep, Math.abs(v.y - prevY));
      if (Math.abs(perp) < hw - 2) crossedTube = true;
      if (r < flatR - 5) {
        enteredBasin = true;
        if (lastOn !== null && lastOn !== surf.onSurface) seamToggles++;
        lastOn = surf.onSurface;
        seamMaxStep = Math.max(seamMaxStep, Math.abs(v.y - prevY));
      }
    }
    expect(crossedTube, 'drove through the tube').toBe(true);
    expect(enteredBasin, 'drove through the deep-flat seam zone').toBe(true);
    expect(seamToggles, 'onSurface NEVER flickers to terrain across the tube↔basin seam').toBe(0);
    expect(seamMaxStep, 'the seam is dead-flat — no pop').toBeLessThan(0.2);
    expect(wholeMaxStep, 'the whole lateral pass stays under the canary bound').toBeLessThan(0.6);
  });

  it('UNIFIED MESH: the followed surface == the shared depth formulas on the ASYMMETRIC tube + basin', () => {
    // Tube floor (inside the tube) keys off tunnelDepthFactor; basin floor off tunnelBasinDepthFactor.
    // The mesh (Stage C) builds from these SAME functions → mesh == followed surface (the #149 rule),
    // now re-verified where the far half holds deep (along > 0 → factor = 1).
    for (const along of [-200, 0, 300, 600, 900]) {
      const p = at(along, 0); // on the centreline, inside the tube
      const surf = queryDrivableSurface(seed, p.x, p.z);
      const expected = centreGround - ZEN_LANDMARK.tunnelDepth * tun.scale * tunnelDepthFactor(along / halfL);
      expect(surf.onSurface, `tube@${along}`).toBe(true);
      expect(surf.y, `tube floor == tunnelDepthFactor@${along}`).toBeCloseTo(expected, 4);
    }
    for (const [along, perp] of [[0, hw + 30], [120, hw + 60], [0, flatR - 10], [-80, hw + 5]]) {
      const p = at(along, perp);
      const surf = queryDrivableSurface(seed, p.x, p.z);
      const r = Math.hypot(along, perp);
      const expected = centreGround - ZEN_LANDMARK.tunnelDepth * tun.scale * tunnelBasinDepthFactor(r, tun.scale);
      expect(surf.onSurface, `basin@${along},${perp}`).toBe(true);
      expect(surf.y, `basin floor == tunnelBasinDepthFactor@${along},${perp}`).toBeCloseTo(expected, 4);
    }
  });

  it('the #154 corridor invariant still holds (hw − bendAmp ≥ 25), and the basin stays in the deep core', () => {
    expect(ZEN_LANDMARK.tunnelHalfWidth - ZEN_LANDMARK.tunnelBendAmplitude).toBeGreaterThanOrEqual(25);
    expect(ZEN_DRIVEDOWN.basinRimRadius).toBeLessThan(ZEN_LANDMARK.tunnelDepthEaseStart * ZEN_LANDMARK.tunnelLength * 0.5);
  });
});
