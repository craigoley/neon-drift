/**
 * Zen obstacle contact (PR3b) — props gently SLOW the car, the zen rule being: slow,
 * never stop, never end (a parallel of the MP crash=slowdown concept). Two pure pieces:
 * the contact-intensity field query (only NEARBY props, graded by how central) and the
 * bounded slowdown in updateZen (a soft bleed with a floor, composing sanely with slope).
 */
import { describe, expect, it } from 'vitest';
import { createZenVehicle, updateZen } from '../ZenVehicle';
import { ZenChunkField, chunkProps, propContactIntensity, type ZenProp } from '../ZenWorld';
import { SCENERY, ZEN } from '../../utils/constants';

const TICK = 1 / 60;
const KINDS = SCENERY.layers.length;

/** A prop of `kind` parked at (px, pz) with unit scale, for footprint tests. */
function prop(kind: number, px: number, pz: number): ZenProp {
  return { kind, x: px, z: pz, rotationY: 0, scale: 1 };
}

describe('Zen contact — prop footprint intensity', () => {
  it('is 1 dead-centre and fades to 0 at the edge of the reach', () => {
    const p = prop(0, 0, 0);
    const reach = (SCENERY.layers[0].width / 2) * 1 + ZEN.contactCarRadius;
    expect(propContactIntensity(p, 0, 0)).toBeCloseTo(1, 6);
    expect(propContactIntensity(p, reach, 0)).toBe(0); // exactly at the edge → clear
    expect(propContactIntensity(p, reach * 2, 0)).toBe(0); // well beyond → clear
  });

  it('is monotonic — closer to the prop means stronger contact', () => {
    const p = prop(2, 10, 10); // the wide city-block kind
    const near = propContactIntensity(p, 11, 10);
    const far = propContactIntensity(p, 14, 10);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(0);
  });

  it('scales the reach with the prop footprint (a wide block reaches further)', () => {
    const palm = { ...prop(0, 0, 0) };
    const block = { ...prop(2, 0, 0) };
    // 4 units out: the thin palm is clear, the wide block still bites.
    expect(propContactIntensity(palm, 4, 0)).toBe(0);
    expect(propContactIntensity(block, 4, 0)).toBeGreaterThan(0);
  });
});

describe('Zen contact — field query is bounded to nearby props', () => {
  it('returns 0 in open space and >0 on top of a real placed prop', () => {
    const field = new ZenChunkField(ZEN.worldSeed, ZEN.chunkRadius, KINDS);
    field.update(0, 0);
    // Find any actually-placed prop in a chunk near the origin.
    let target: ZenProp | undefined;
    outer: for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        const ps = chunkProps(ZEN.worldSeed, cx, cz, KINDS);
        if (ps.length) {
          target = ps[0];
          break outer;
        }
      }
    }
    expect(target).toBeDefined();
    // On the prop → contact; far away in clear space → none.
    expect(field.contactAt(target!.x, target!.z)).toBeGreaterThan(0);
    expect(field.contactAt(target!.x + 9999, target!.z + 9999)).toBe(0);
  });

  it('the bounded 3×3 scan never MISSES a contact (matches a brute-force over all props)', () => {
    // reach ≪ chunkSize, so the 3×3 neighbourhood is complete: scanning it must give the
    // same answer as checking every loaded prop. Sample many car positions to confirm.
    const field = new ZenChunkField(ZEN.worldSeed, ZEN.chunkRadius, KINDS);
    field.update(0, 0);
    for (let s = 0; s < 200; s++) {
      const x = ((s * 53) % 600) - 300;
      const z = ((s * 31) % 600) - 300;
      let brute = 0;
      field.forEachProp((p) => {
        brute = Math.max(brute, propContactIntensity(p, x, z));
      });
      expect(field.contactAt(x, z)).toBeCloseTo(brute, 9);
    }
  });
});

describe('Zen contact — gentle slowdown, never stops (the zen rule)', () => {
  /** Drive at throttle holding a fixed contact for `frames` from rest; final speed. */
  function driveContact(throttle: number, contact: number, frames: number): number {
    const v = createZenVehicle();
    for (let i = 0; i < frames; i++) updateZen(v, 0, throttle, TICK, 0, contact);
    return v.speed;
  }

  it('contact while cruising slows you BELOW the clear cruise speed', () => {
    const clear = driveContact(0.6, 0, 400);
    const bumping = driveContact(0.6, 1, 400);
    expect(bumping).toBeLessThan(clear);
  });

  it('NEVER stops the car — full contact at full throttle holds a stable crawl ~floor', () => {
    const crawl = driveContact(1, 1, 1200);
    // The contact term floors at contactFloor; coast-friction then shaves a hair (a
    // stable fixed point, never drifting toward 0). It holds a crawl, never a dead stop.
    expect(crawl).toBeGreaterThan(ZEN.contactFloor * 0.95);
    expect(crawl).toBeGreaterThan(0); // explicitly: not a dead stop
  });

  it('does not speed a slow car UP — contact only ever slows', () => {
    const v = createZenVehicle();
    v.speed = 5; // already below the contact floor
    const before = v.speed;
    for (let i = 0; i < 60; i++) updateZen(v, 0, 0, TICK, 0, 1);
    expect(v.speed).toBeLessThanOrEqual(before); // contact never accelerates
  });

  it('recovers after contact ends (throttle brings the speed back up)', () => {
    const v = createZenVehicle();
    for (let i = 0; i < 60; i++) updateZen(v, 0, 1, TICK, 0, 1); // bumping at full throttle
    const bumped = v.speed;
    for (let i = 0; i < 200; i++) updateZen(v, 0, 1, TICK, 0, 0); // clear, keep driving
    expect(v.speed).toBeGreaterThan(bumped); // recovered
  });
});

describe('Zen contact — the bump is now PERCEPTIBLE (the tune)', () => {
  it('a short prop clip drops a clearly-felt amount of speed (not the old <2 u/s blip)', () => {
    const v = createZenVehicle();
    for (let i = 0; i < 400; i++) updateZen(v, 0, 1, TICK); // settle at cruise
    const cruise = v.speed;
    for (let i = 0; i < 4; i++) updateZen(v, 0, 1, TICK, 0, 1); // ~4-frame center clip
    const dip = cruise - v.speed;
    expect(dip).toBeGreaterThan(8); // clearly perceptible (was sub-perceptual ~<2)
    expect(v.speed).toBeGreaterThan(ZEN.contactFloor); // but still a soft bump, not a wall
  });

  it('arms the post-bump HOLD so the dip lingers, then recovers to cruise', () => {
    const v = createZenVehicle();
    for (let i = 0; i < 400; i++) updateZen(v, 0, 1, TICK);
    const cruise = v.speed;
    updateZen(v, 0, 1, TICK, 0, 1); // one real contact frame
    expect(v.bumpHold).toBeGreaterThan(0); // hold armed → throttle recovery is dampened
    const dipped = v.speed;
    // Drive on, clear of props — the hold expires and the throttle restores cruise.
    for (let i = 0; i < 200; i++) updateZen(v, 0, 1, TICK);
    expect(v.bumpHold).toBe(0); // hold released
    expect(v.speed).toBeGreaterThan(dipped); // recovered
    expect(v.speed).toBeGreaterThan(cruise - 1); // back to ~cruise (never permanent)
  });
});

describe('Zen contact — composes with the slope effect (no dead stop)', () => {
  it('a bump WHILE climbing never HALTS the car (stable crawl, never 0)', () => {
    const v = createZenVehicle();
    // The compound EXTREME: full throttle, steep uphill AND full contact, held 20s. With
    // the perceptible tune (firmer contact + the post-bump throttle-dampening hold) these
    // three speed-bleeds stack to a LOWER crawl than the nominal contactFloor — but it's
    // a STABLE crawl that never stalls to a halt (the zen no-death rule holds). Realistic
    // bumps are brief; this is the never-can-happen permanent embed on a hillside.
    for (let i = 0; i < 1200; i++) updateZen(v, 0, 1, TICK, 0.5, 1);
    expect(v.speed).toBeGreaterThan(3); // clearly still moving — never halts
    const stable = v.speed;
    for (let i = 0; i < 600; i++) updateZen(v, 0, 1, TICK, 0.5, 1);
    expect(v.speed).toBeGreaterThan(stable * 0.8); // holds the crawl, doesn't creep to 0
  });
});
