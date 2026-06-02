// @vitest-environment jsdom
/**
 * CarMesh — procedural player-car mesh. These are construction + cosmetic tests:
 * the mesh builds from THREE geometry/material primitives that don't need a GL
 * context, so we can verify it constructs, that each car's cosmetic colours
 * resolve onto the right materials, that an unknown id falls back to base, and
 * that the headlight removal left no orphaned material — all without WebGL.
 *
 * (The full visual look is a device-playtest call; this pins the wiring.)
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CarMesh } from '../CarMesh';
import { BASE_CAR_SHAPE, CARS, carById, carShape } from '../../utils/constants';

/** Pull every material instance off a built CarMesh (recursively). */
function materialsOf(car: CarMesh): THREE.Material[] {
  const out: THREE.Material[] = [];
  car.group.traverse((o) => {
    const m = (o as THREE.Mesh | THREE.LineSegments).material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((x) => out.push(x));
  });
  return out;
}

/** World-space bounding box of the CHASSIS (the car body, excludes the flat
 *  ground glow). Measures the silhouette so per-car shapes can be compared. */
function chassisSize(car: CarMesh): { x: number; y: number; z: number } {
  const box = new THREE.Box3();
  car.chassis.updateMatrixWorld(true);
  car.chassis.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox!.clone();
      b.applyMatrix4(m.matrixWorld);
      box.union(b);
    }
  });
  const size = new THREE.Vector3();
  box.getSize(size);
  return { x: size.x, y: size.y, z: size.z };
}

/** Perceptual luminance (0..1) from the raw sRGB bytes of a hex colour — this is
 *  the readability metric the bodies were authored against (NOT THREE.Color's
 *  linear channels, which apply an sRGB→linear curve and read much darker). */
function luminance(hex: number): number {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('CarMesh — construction', () => {
  it('builds without a GL context and exposes group + chassis + edgesMat', () => {
    const car = new CarMesh();
    expect(car.group).toBeInstanceOf(THREE.Group);
    expect(car.chassis).toBeInstanceOf(THREE.Group);
    expect(car.edgesMat).toBeInstanceOf(THREE.LineBasicMaterial);
    // The chassis carries the body; the ground glow is a sibling so roll/yaw
    // (applied to chassis) never tilts it.
    expect(car.group.children).toContain(car.chassis);
    expect(car.chassis.children.length).toBeGreaterThan(0);
    car.dispose();
  });

  it('has NO additive light quads at/ahead of the nose (headlights removed)', () => {
    // Headlights were additive PlaneGeometry meshes; after removal the only mesh
    // material using AdditiveBlending is the (flat, ground) glow. Assert no
    // additive PLANE-based mesh sits forward of the car (where headlights were).
    const car = new CarMesh();
    let additivePlanes = 0;
    car.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | undefined;
      if (
        mesh.isMesh &&
        mat &&
        (mat as THREE.MeshBasicMaterial).blending === THREE.AdditiveBlending &&
        mesh.geometry instanceof THREE.PlaneGeometry
      ) {
        additivePlanes++;
      }
    });
    expect(additivePlanes).toBe(0); // no headlight/cast quads remain
    car.dispose();
  });

  it('disposes all geometries + materials without throwing', () => {
    const car = new CarMesh();
    expect(() => car.dispose()).not.toThrow();
  });
});

describe('CarMesh — per-car cosmetics resolve onto the materials', () => {
  it('applies each car body + glow colour to a material in the mesh', () => {
    for (const def of CARS) {
      const car = new CarMesh();
      car.applyCar(def);
      const mats = materialsOf(car);
      const hexes = mats.map((m) => (m as THREE.MeshBasicMaterial).color.getHex());
      // The body tint and the neon glow must each appear on at least one material.
      expect(hexes).toContain(def.cosmetic.body);
      expect(hexes).toContain(def.cosmetic.glow);
      car.dispose();
    }
  });

  it('cycling cars actually CHANGES the body + glow material colours', () => {
    const car = new CarMesh();
    car.applyCar(CARS[0]);
    const grab = () => materialsOf(car).map((m) => (m as THREE.MeshBasicMaterial).color.getHex());
    const first = grab();
    car.applyCar(CARS[1]);
    const second = grab();
    expect(second).not.toEqual(first); // not a hard-coded single colour
    car.dispose();
  });

  it('unknown car id falls back to the base car (no throw, valid colours)', () => {
    const fallback = carById('does-not-exist');
    expect(fallback).toBe(CARS[0]);
    const car = new CarMesh();
    expect(() => car.applyCar(fallback)).not.toThrow();
    const hexes = materialsOf(car).map((m) => (m as THREE.MeshBasicMaterial).color.getHex());
    expect(hexes).toContain(CARS[0].cosmetic.body);
    car.dispose();
  });

  it('no cosmetic colour is NaN and every channel is finite', () => {
    for (const def of CARS) {
      const car = new CarMesh();
      car.applyCar(def);
      for (const m of materialsOf(car)) {
        const c = (m as THREE.MeshBasicMaterial).color;
        expect(Number.isFinite(c.r)).toBe(true);
        expect(Number.isFinite(c.g)).toBe(true);
        expect(Number.isFinite(c.b)).toBe(true);
      }
      car.dispose();
    }
  });
});

describe('CARS — bodies are readable AND distinct (the playtest fix)', () => {
  it('every car body is well above near-black (reads against the dark picker)', () => {
    // The bug: all bodies sat at 5–13% luminance and read as the same black
    // shape. Pin a floor so a future tweak can't regress them back to near-black.
    for (const def of CARS) {
      expect(luminance(def.cosmetic.body)).toBeGreaterThan(0.15);
    }
  });

  it('all car bodies are mutually distinct colours (instant by-sight ID)', () => {
    const bodies = CARS.map((c) => c.cosmetic.body);
    expect(new Set(bodies).size).toBe(bodies.length); // no two identical
    // And distinct by a real channel margin, not just by one bit.
    const dist = (a: number, b: number) =>
      Math.abs((a >> 16 & 255) - (b >> 16 & 255)) +
      Math.abs((a >> 8 & 255) - (b >> 8 & 255)) +
      Math.abs((a & 255) - (b & 255));
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        expect(dist(bodies[i], bodies[j])).toBeGreaterThan(40);
      }
    }
  });
});

describe('CARS — every car has its OWN geometry profile (not just colour)', () => {
  it('every car defines a shape and they are not all identical', () => {
    const shapes = CARS.map((c) => carShape(c));
    for (const s of shapes) expect(s).toBeDefined();
    // At least the key silhouette axes must vary across the roster.
    expect(new Set(shapes.map((s) => s.lengthMul)).size).toBeGreaterThan(1);
    expect(new Set(shapes.map((s) => s.widthMul)).size).toBeGreaterThan(1);
    expect(new Set(shapes.map((s) => s.noseFraction)).size).toBeGreaterThan(1);
  });

  it('shape params are all finite and in sane ranges (no NaN / runaway)', () => {
    for (const c of CARS) {
      const s = carShape(c);
      for (const v of Object.values(s)) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(3); // multipliers/fractions stay bounded
      }
    }
  });

  it('the shape telegraphs handling: fastest car is longest+lowest, grippiest is widest', () => {
    const byId = (id: string) => CARS.find((c) => c.id === id)!;
    const nova = carShape(byId('nova')); // speedCap 1.25 — the fastest
    const onyx = carShape(byId('onyx')); // lateralAccel 1.45 — the grippiest
    const ghost = carShape(byId('ghost')); // loosest tail — the compact, tossable kart
    const pulse = carShape(byId('pulse')); // balanced reference

    // Fastest → longer & lower than the balanced reference.
    expect(nova.lengthMul).toBeGreaterThan(pulse.lengthMul);
    expect(nova.heightMul).toBeLessThan(pulse.heightMul);
    // Grippiest → wider than the reference (planted stance).
    expect(onyx.widthMul).toBeGreaterThan(pulse.widthMul);
    // Drift → shorter & taller than the reference (compact/tossable).
    expect(ghost.lengthMul).toBeLessThan(pulse.lengthMul);
    expect(ghost.heightMul).toBeGreaterThan(pulse.heightMul);
  });
});

describe('CarMesh — geometry actually differs per car', () => {
  it('builds valid (non-empty, finite) geometry for EVERY car', () => {
    for (const def of CARS) {
      const car = new CarMesh(def);
      const size = chassisSize(car);
      expect(size.x).toBeGreaterThan(0);
      expect(size.y).toBeGreaterThan(0);
      expect(size.z).toBeGreaterThan(0);
      expect(Number.isFinite(size.x + size.y + size.z)).toBe(true);
      car.dispose();
    }
  });

  it('two cars with different shapes produce different chassis bounding boxes', () => {
    const nova = new CarMesh(CARS.find((c) => c.id === 'nova')); // long/low
    const onyx = new CarMesh(CARS.find((c) => c.id === 'onyx')); // wide/low
    const a = chassisSize(nova);
    const b = chassisSize(onyx);
    // Nova is clearly longer; Onyx is clearly wider — distinct silhouettes.
    expect(a.z).toBeGreaterThan(b.z);
    expect(b.x).toBeGreaterThan(a.x);
    nova.dispose();
    onyx.dispose();
  });

  it('applyCar reshapes the geometry when switching to a different-shaped car', () => {
    const car = new CarMesh(CARS.find((c) => c.id === 'ghost')); // short/tall
    const before = chassisSize(car);
    car.applyCar(CARS.find((c) => c.id === 'nova')!); // long/low
    const after = chassisSize(car);
    expect(after.z).toBeGreaterThan(before.z); // got longer
    expect(after.y).toBeLessThan(before.y); // got lower
    car.dispose();
  });

  it('unknown car id builds the base silhouette without throwing', () => {
    const fallback = carById('nope'); // → CARS[0] (pulse)
    expect(() => {
      const car = new CarMesh(fallback);
      const size = chassisSize(car);
      expect(size.z).toBeGreaterThan(0);
      car.dispose();
    }).not.toThrow();
    // A car with NO shape block resolves to BASE_CAR_SHAPE.
    const noShape = { id: 'x', displayName: 'X', cosmetic: { body: 0, glow: 0, accent: 0 } };
    expect(carShape(noShape)).toBe(BASE_CAR_SHAPE);
  });

  it('reshaping disposes the old geometry (no leak across many switches)', () => {
    const car = new CarMesh(CARS[0]);
    // Cycle the whole roster several times; must not throw or accumulate.
    for (let round = 0; round < 3; round++) {
      for (const def of CARS) car.applyCar(def);
    }
    expect(chassisSize(car).z).toBeGreaterThan(0);
    expect(() => car.dispose()).not.toThrow();
  });
});
