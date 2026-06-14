/**
 * ZEN LANDMARKS renderer — the three.js layer that DRAWS the rare neon structures (the pure
 * placement + solid geometry live in ZenLandmarkModel). Reads the model, never mutates it.
 *
 * Beacons-from-afar: a landmark's neon line work uses `fog: false`, so it reads on the horizon
 * through the Zen haze (like the backdrop sun/mountains) — you SPOT it far off and drive to it.
 * It fades IN by opacity over the outer draw band (a gentle emerge, not a pop), since there's no
 * fog to hide the cull boundary. The active set is tiny (landmarks are rare — usually 0–1, a few
 * at most in range), so per-landmark line meshes + material clones are cheap.
 *
 * REACH MOMENT: when the car comes within reach of a landmark, a calm GLOW PULSE plays once — the
 * structure brightens toward white + gently swells, then settles. Debounced per visit (re-fires
 * only after you leave and return). Drive-THROUGH types (arch, ring) fire as you pass the opening;
 * the solid MONOLITH fires as you arrive. No score, no UI — a quiet acknowledgment.
 */

import * as THREE from 'three';
import { ZEN_LANDMARK } from '../utils/constants';
import { smoothstep } from './ZenNoise';
import { heightAt } from './ZenHeight';
import { deflectPoint } from './ZenWorld';
import {
  landmarksInRadius,
  eachSolidCircle,
  reachRadius,
  reachDuration,
  reachEnvelope,
  isDriveThrough,
  crossedOpening,
  openingHeight,
  openingRadius,
  type Landmark,
  type LandmarkType,
  LANDMARK_ARCH,
  LANDMARK_MONOLITH,
  LANDMARK_RING,
} from './ZenLandmarkModel';

interface Active {
  landmark: Landmark;
  mesh: THREE.LineSegments;
  material: THREE.LineBasicMaterial;
  baseColor: THREE.Color;
  /** Reach-glow elapsed seconds (>= the type's duration = idle); -1 = not glowing. */
  pulseT: number;
  /** Debounce: true while the car is within reach (so the glow fires once per visit). */
  near: boolean;
  // --- drive-through GATE ripple (ring/arch only; null for the monolith) ---
  /** Expanding neon circle on the opening plane, shown while crossing; null for sight types. */
  gateMesh: THREE.LineSegments | null;
  gateMaterial: THREE.LineBasicMaterial | null;
  /** Gate-ripple elapsed seconds (>= gateSeconds = idle); -1 = not rippling. */
  gateT: number;
}

const _white = new THREE.Color(0xffffff);

export class ZenLandmarks {
  private readonly scene: THREE.Scene;
  private readonly seed: number;
  /** Shared base geometry per type (built once; every instance references it). */
  private readonly geo: THREE.BufferGeometry[];
  /** Shared unit-circle geometry (radius 1, in local XY) for the gate ripple. */
  private readonly rippleGeo: THREE.BufferGeometry;
  private readonly active = new Map<number, Active>();
  /** Reused resolve scratch (no per-frame allocation). */
  private readonly _resolve = { x: 0, z: 0 };
  /** Previous car position, for the gate plane-crossing test (set after each update). */
  private prevCarX = 0;
  private prevCarZ = 0;
  private hasPrevCar = false;

  constructor(scene: THREE.Scene, seed: number) {
    this.scene = scene;
    this.seed = seed;
    this.geo = [this.buildArch(), this.buildMonolith(), this.buildRing()];
    this.rippleGeo = this.buildRippleCircle();
  }

  /**
   * Stream landmark meshes around the car + run the reach pulses. Cheap: landmarks are rare, so
   * the active set is tiny; the heavy work is a bounded `landmarksInRadius` scan.
   */
  update(carX: number, carZ: number, dt: number): void {
    const inRange = landmarksInRadius(this.seed, carX, carZ, ZEN_LANDMARK.drawRadius);

    // Add newly-in-range landmarks.
    for (const lm of inRange) {
      if (this.active.has(lm.id)) continue;
      this.spawn(lm);
    }
    // Cull out-of-range landmarks (linear scan — inRange has 0–3 items; avoids Set allocation).
    for (const [id, a] of this.active) {
      let found = false;
      for (let i = 0; i < inRange.length; i++) {
        if (inRange[i].id === id) { found = true; break; }
      }
      if (!found) {
        a.mesh.removeFromParent();
        a.material.dispose();
        if (a.gateMesh) a.gateMesh.removeFromParent();
        if (a.gateMaterial) a.gateMaterial.dispose();
        this.active.delete(id);
      }
    }

    // Per-active: reach detect (debounced) + advance the glow + gate ripple + distance fade.
    for (const a of this.active.values()) {
      const lm = a.landmark;
      const dx = lm.x - carX;
      const dz = lm.z - carZ;
      const dist2 = dx * dx + dz * dz;
      const rr = reachRadius(lm);
      const within = dist2 <= rr * rr;
      if (within && !a.near) {
        a.pulseT = 0; // entered reach → start the glow (fires once per visit)
      }
      a.near = within;

      // Reach glow: SIGHT (monolith) ramps to a mid-window peak; DRIVE-THROUGH (ring, arch) is
      // FRONT-LOADED so it flashes bright while the structure is still ahead + in view.
      let env = 0;
      if (a.pulseT >= 0) {
        a.pulseT += dt;
        if (a.pulseT >= reachDuration(lm.type)) {
          a.pulseT = -1;
        } else {
          env = reachEnvelope(lm.type, a.pulseT);
        }
      }
      a.material.color.copy(a.baseColor).lerp(_white, env * ZEN_LANDMARK.pulseBrighten);
      a.mesh.scale.setScalar(lm.scale * (1 + env * ZEN_LANDMARK.pulseSwell));

      // Gate ripple (beat 2, drive-through only): fire when the car crosses the opening plane
      // within the opening, then expand + fade the ring you drove INTO.
      if (a.gateMesh && a.gateMaterial) {
        if (this.hasPrevCar && crossedOpening(lm, this.prevCarX, this.prevCarZ, carX, carZ)) {
          a.gateT = 0; // crossed → start the ripple (debounced by the single sign-flip)
        }
        this.animateGate(a, dt);
      }

      // Fade IN over the outer draw band (gentle emerge from the horizon, no pop).
      const dist = Math.sqrt(dist2);
      a.material.opacity = 1 - smoothstep(
        ZEN_LANDMARK.drawRadius - ZEN_LANDMARK.fadeBand,
        ZEN_LANDMARK.drawRadius,
        dist,
      );
    }

    // Remember the car position for next frame's gate plane-crossing test.
    this.prevCarX = carX;
    this.prevCarZ = carZ;
    this.hasPrevCar = true;
  }

  /** Advance an active landmark's gate ripple by `dt`: expand the circle + fade it, then idle. */
  private animateGate(a: Active, dt: number): void {
    const mesh = a.gateMesh!;
    const mat = a.gateMaterial!;
    if (a.gateT < 0) {
      mesh.visible = false;
      return;
    }
    a.gateT += dt;
    const u = a.gateT / ZEN_LANDMARK.gateSeconds;
    if (u >= 1) {
      a.gateT = -1;
      mesh.visible = false;
      return;
    }
    const baseR = openingRadius(a.landmark.type) * a.landmark.scale;
    const s = baseR * (ZEN_LANDMARK.gateStartScale + (ZEN_LANDMARK.gateEndScale - ZEN_LANDMARK.gateStartScale) * u);
    mesh.scale.set(s, s, s);
    mat.opacity = ZEN_LANDMARK.gateOpacity * (1 - u);
    mesh.visible = true;
  }

  /** Push the car out of any landmark's SOLID parts (arch pillars / monolith trunk). Rings are
   *  pass-through (no solid parts). Bounded: scans only landmarks near (x, z). */
  resolve(x: number, z: number): { x: number; z: number } {
    let rx = x;
    let rz = z;
    const near = landmarksInRadius(this.seed, x, z, ZEN_LANDMARK.solidQueryRadius);
    for (const lm of near) {
      eachSolidCircle(lm, (cx, cz, r) => {
        const out = deflectPoint(rx, rz, cx, cz, r);
        rx = out.x;
        rz = out.z;
      });
    }
    this._resolve.x = rx;
    this._resolve.z = rz;
    return this._resolve;
  }

  private spawn(lm: Landmark): void {
    const colorHex = LANDMARK_COLORS[lm.type];
    const material = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 1,
      fog: false, // a beacon — reads on the horizon through the haze
      depthWrite: false,
    });
    const groundY = heightAt(this.seed, lm.x, lm.z);
    const mesh = new THREE.LineSegments(this.geo[lm.type], material);
    mesh.position.set(lm.x, groundY, lm.z);
    mesh.rotation.y = lm.rotationY;
    mesh.scale.setScalar(lm.scale);
    mesh.frustumCulled = false; // bounded set; avoids the from-afar cull edge case
    this.scene.add(mesh);

    // Gate ripple mesh — drive-through types only (ring, arch). A unit circle on the opening
    // plane (same colour), hidden until you cross. The MONOLITH (sight) gets none.
    let gateMesh: THREE.LineSegments | null = null;
    let gateMaterial: THREE.LineBasicMaterial | null = null;
    if (isDriveThrough(lm.type)) {
      gateMaterial = new THREE.LineBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0,
        fog: false,
        depthWrite: false,
      });
      gateMesh = new THREE.LineSegments(this.rippleGeo, gateMaterial);
      gateMesh.position.set(lm.x, groundY + openingHeight(lm.type) * lm.scale, lm.z);
      gateMesh.rotation.y = lm.rotationY; // local XY → faces the through-axis (the opening plane)
      gateMesh.frustumCulled = false;
      gateMesh.visible = false;
      this.scene.add(gateMesh);
    }

    this.active.set(lm.id, {
      landmark: lm,
      mesh,
      material,
      baseColor: new THREE.Color(colorHex),
      pulseT: -1,
      near: false,
      gateMesh,
      gateMaterial,
      gateT: -1,
    });
  }

  dispose(): void {
    for (const a of this.active.values()) {
      a.mesh.removeFromParent();
      a.material.dispose();
      if (a.gateMesh) a.gateMesh.removeFromParent();
      if (a.gateMaterial) a.gateMaterial.dispose();
    }
    this.active.clear();
    for (const g of this.geo) g.dispose();
    this.rippleGeo.dispose();
  }

  // --- geometry builders (local space, before the per-landmark scale; base sits at y=0) ---

  /** ARCH — two pillars (along local X) + a bowed top beam; you drive THROUGH along local Z. */
  private buildArch(): THREE.BufferGeometry {
    const p: number[] = [];
    const line = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
      p.push(ax, ay, az, bx, by, bz);
    const H = ZEN_LANDMARK.archHeight;
    const W = ZEN_LANDMARK.archHalfWidth;
    const pr = ZEN_LANDMARK.archPillarRadius;
    const rise = ZEN_LANDMARK.archRise;
    for (const sx of [-W, W]) {
      for (const dz of [-pr, pr]) line(sx, 0, dz, sx, H, dz); // pillar verticals (front/back)
      line(sx, H, -pr, sx, H, pr); // pillar top cap
    }
    // Bowed top beam (two arcs at z = ±pr), a polyline rising `rise` at the centre.
    const N = ZEN_LANDMARK.archBeamSegments;
    for (const dz of [-pr, pr]) {
      let px: number = -W;
      let py: number = H;
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        const x = -W + 2 * W * t;
        const y = H + rise * Math.sin(Math.PI * t);
        line(px, py, dz, x, y, dz);
        px = x;
        py = y;
      }
    }
    return ZenLandmarks.lineGeo(p);
  }

  /** MONOLITH — a tapered obelisk: base square → small top square → pyramidion apex. */
  private buildMonolith(): THREE.BufferGeometry {
    const p: number[] = [];
    const line = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
      p.push(ax, ay, az, bx, by, bz);
    const H = ZEN_LANDMARK.monolithHeight;
    const b = ZEN_LANDMARK.monolithBase / 2;
    const tb = b * ZEN_LANDMARK.monolithTaperRatio;
    const tH = H * ZEN_LANDMARK.monolithShaftRatio;
    const baseC: [number, number][] = [[-b, -b], [b, -b], [b, b], [-b, b]];
    const topC: [number, number][] = [[-tb, -tb], [tb, -tb], [tb, tb], [-tb, tb]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      line(baseC[i][0], 0, baseC[i][1], baseC[j][0], 0, baseC[j][1]); // base square
      line(topC[i][0], tH, topC[i][1], topC[j][0], tH, topC[j][1]); // top square
      line(baseC[i][0], 0, baseC[i][1], topC[i][0], tH, topC[i][1]); // tapered shaft edge
      line(topC[i][0], tH, topC[i][1], 0, H, 0); // pyramidion to the apex
    }
    return ZenLandmarks.lineGeo(p);
  }

  /** RING / PORTAL — a vertical neon ring (hole faces ±Z) you drive through; bottom dips below
   *  ground (hidden), the ground-level opening is wide. A double ring reads as a portal frame. */
  private buildRing(): THREE.BufferGeometry {
    const p: number[] = [];
    const R = ZEN_LANDMARK.ringRadius;
    const cy = R * ZEN_LANDMARK.ringCentreFactor;
    const n = ZEN_LANDMARK.ringSegments;
    for (const rad of [R, R * ZEN_LANDMARK.ringInnerRatio]) {
      let px: number = rad;
      let py: number = cy;
      for (let i = 1; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = Math.cos(a) * rad;
        const y = cy + Math.sin(a) * rad;
        p.push(px, py, 0, x, y, 0);
        px = x;
        py = y;
      }
    }
    return ZenLandmarks.lineGeo(p);
  }

  /** Unit circle (radius 1) in the local XY plane — the gate ripple, scaled + faded on a pass. */
  private buildRippleCircle(): THREE.BufferGeometry {
    const p: number[] = [];
    const n = ZEN_LANDMARK.gateSegments;
    let px = 1;
    let py = 0;
    for (let i = 1; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a);
      const y = Math.sin(a);
      p.push(px, py, 0, x, y, 0);
      px = x;
      py = y;
    }
    return ZenLandmarks.lineGeo(p);
  }

  private static lineGeo(positions: number[]): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }
}

/** Per-type neon colour (synthwave: arch cyan, monolith magenta, ring orange). */
const LANDMARK_COLORS: Record<LandmarkType, number> = {
  [LANDMARK_ARCH]: ZEN_LANDMARK.archColor,
  [LANDMARK_MONOLITH]: ZEN_LANDMARK.monolithColor,
  [LANDMARK_RING]: ZEN_LANDMARK.ringColor,
};
