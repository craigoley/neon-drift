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
import { CARS, carById } from '../../utils/constants';

/** Pull every material instance off a built CarMesh (recursively). */
function materialsOf(car: CarMesh): THREE.Material[] {
  const out: THREE.Material[] = [];
  car.group.traverse((o) => {
    const m = (o as THREE.Mesh | THREE.LineSegments).material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((x) => out.push(x));
  });
  return out;
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
