/**
 * Zen SOLID props — DEFLECT/SLIDE collision (replaces the #113 pass-through slowdown).
 * Props are solid circles: the car can't enter them, it's pushed to the edge along the
 * normal and SLIDES around (tangential motion preserved) — no hard stop, no death, no NaN.
 * Two pure pieces: the single-circle push-out (deflectPoint) and the bounded 3×3 field
 * resolve that applies it against the real seeded world.
 */
import { describe, expect, it } from 'vitest';
import { ZenChunkField, chunkProps, deflectPoint, propSolidRadius, type ZenProp } from '../ZenWorld';
import { createZenVehicle, updateZen } from '../ZenVehicle';
import { SCENERY, ZEN } from '../../utils/constants';

const KINDS = SCENERY.layers.length;
const TICK = 1 / 60;
const dist = (x: number, z: number, px: number, pz: number) => Math.hypot(x - px, z - pz);

describe('Zen deflect — push a point out of a solid circle', () => {
  it('leaves a point OUTSIDE the circle unchanged', () => {
    const r = deflectPoint(3, 0, 0, 0, 2);
    expect(r).toEqual({ x: 3, z: 0 });
  });

  it('pushes an INSIDE point out to the edge along the normal (no penetration)', () => {
    const r = deflectPoint(0.5, 0, 0, 0, 2); // head-on, 0.5u deep
    expect(dist(r.x, r.z, 0, 0)).toBeCloseTo(2, 9); // exactly on the edge
    expect(r.z).toBeCloseTo(0, 9); // straight out along +x
  });

  it('PRESERVES the angle around the centre (so motion slides along the surface)', () => {
    const r = deflectPoint(1, 1, 0, 0, 2); // inside, at 45°
    expect(dist(r.x, r.z, 0, 0)).toBeCloseTo(2, 9); // on the edge
    expect(Math.atan2(r.z, r.x)).toBeCloseTo(Math.atan2(1, 1), 9); // same bearing → tangential kept
  });

  it('handles a point at the DEAD CENTRE without NaN (pushes a fixed direction)', () => {
    const r = deflectPoint(0, 0, 0, 0, 2);
    expect(Number.isNaN(r.x) || Number.isNaN(r.z)).toBe(false);
    expect(dist(r.x, r.z, 0, 0)).toBeCloseTo(2, 9);
  });

  it('solid radius is tied to the visible prop (palm/pole small, block big)', () => {
    const palm: ZenProp = { kind: 0, x: 0, z: 0, rotationY: 0, scale: 1 };
    const block: ZenProp = { kind: 2, x: 0, z: 0, rotationY: 0, scale: 1 };
    expect(propSolidRadius(palm)).toBeCloseTo(SCENERY.layers[0].width / 2 + ZEN.deflectCarRadius, 9);
    expect(propSolidRadius(block)).toBeGreaterThan(propSolidRadius(palm)); // the block is a bigger wall
  });
});

describe('Zen deflect — field.resolve against the real world (bounded 3×3 scan)', () => {
  /** Find a real placed prop near the origin to drive at. */
  function nearbyProp(): ZenProp {
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        const ps = chunkProps(ZEN.worldSeed, cx, cz, KINDS);
        if (ps.length) return ps[0];
      }
    }
    throw new Error('no prop found near origin');
  }
  /** True if (x,z) is inside ANY active prop's solid circle (the penetration invariant). */
  function insideAnyProp(field: ZenChunkField, x: number, z: number): boolean {
    let inside = false;
    field.forEachProp((p) => {
      if (dist(x, z, p.x, p.z) < propSolidRadius(p) - 1e-6) inside = true;
    });
    return inside;
  }

  it('leaves the car untouched in open space', () => {
    const field = new ZenChunkField(ZEN.worldSeed, ZEN.chunkRadius, KINDS);
    field.update(0, 0);
    const r = field.resolve(1e6, 1e6); // far from any prop
    expect(r).toEqual({ x: 1e6, z: 1e6 });
  });

  it('a head-on drive CANNOT penetrate — it parks at the edge, never tunnels through', () => {
    const field = new ZenChunkField(ZEN.worldSeed, ZEN.chunkRadius, KINDS);
    const p = nearbyProp();
    const v = createZenVehicle();
    v.x = p.x;
    v.z = p.z + 12; // 12u out on the +z side
    v.heading = Math.PI; // face +z, straight at the prop centre
    let minZ = Infinity;
    for (let i = 0; i < 240; i++) {
      updateZen(v, 0, 1, TICK);
      const solved = field.resolve(v.x, v.z);
      v.x = solved.x;
      v.z = solved.z;
      expect(Number.isNaN(v.x) || Number.isNaN(v.z)).toBe(false);
      expect(insideAnyProp(field, v.x, v.z)).toBe(false); // never inside a solid
      minZ = Math.min(minZ, v.z);
    }
    expect(minZ).toBeGreaterThan(p.z); // blocked — never tunnelled to/through the centre
  });

  it('an OFFSET drive slides AROUND the prop and continues past it (not stopped dead)', () => {
    const field = new ZenChunkField(ZEN.worldSeed, ZEN.chunkRadius, KINDS);
    const p = nearbyProp();
    const r = propSolidRadius(p);
    const v = createZenVehicle();
    v.x = p.x + r * 0.5; // grazing offset
    v.z = p.z + 14;
    v.heading = 0; // faces -z (forward), drives past the prop
    for (let i = 0; i < 240; i++) {
      updateZen(v, 0, 1, TICK);
      const solved = field.resolve(v.x, v.z);
      v.x = solved.x;
      v.z = solved.z;
      expect(insideAnyProp(field, v.x, v.z)).toBe(false); // slides on the surface, never inside
    }
    expect(v.z).toBeLessThan(p.z - r); // slid past + kept going (not halted at the prop)
  });
});
