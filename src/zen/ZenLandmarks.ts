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
 * the arrival types (vista, tunnel) glow as you reach them. No score, no UI — a quiet acknowledgment.
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
  openingRadius,
  type Landmark,
  type LandmarkType,
  LANDMARK_RING,
  LANDMARK_ARCH,
  LANDMARK_GATEWAY,
  LANDMARK_VISTA,
  LANDMARK_TUNNEL,
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
  /** Elapsed seconds of the SUSTAINED overlook breath (arrival types), reset when you leave reach. */
  sustainT: number;
  // --- drive-through GATE ripple (ring/arch/gateway only; null for the surface types) ---
  /** Filled additive annulus at the opening (car height, face-on), shown + expanding while you
   *  cross; null for surface types. (A Mesh, not a line — so the bloom pass flares it.) */
  gateMesh: THREE.Mesh | null;
  gateMaterial: THREE.MeshBasicMaterial | null;
  /** Gate-ripple elapsed seconds (>= gateSeconds = idle); -1 = not rippling. */
  gateT: number;
}

const _white = new THREE.Color(0xffffff);

export class ZenLandmarks {
  private readonly scene: THREE.Scene;
  private readonly seed: number;
  /** Shared base geometry per type (built once; every instance references it). */
  private readonly geo: THREE.BufferGeometry[];
  /** Shared unit ANNULUS (outer radius 1, in local XY) for the gate ripple — a filled ring you
   *  drive through; additive + bloom make it flare. */
  private readonly rippleGeo: THREE.RingGeometry;
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
    // Indexed by LandmarkType (ring, arch, gateway, vista, tunnel).
    this.geo = [this.buildRing(), this.buildArch(), this.buildGateway(), this.buildVista(), this.buildTunnel()];
    // Unit annulus (outer 1) in local XY for the gate ripple.
    this.rippleGeo = new THREE.RingGeometry(ZEN_LANDMARK.gateRippleInnerRatio, 1, ZEN_LANDMARK.gateSegments);
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

      // Reach glow: ARRIVAL (vista/tunnel) ramps to a mid-window peak; DRIVE-THROUGH (ring/arch/gateway) is
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
      // SUSTAINED overlook glow (arrival types — vista/tunnel): while the car is ON it (within
      // reach), a gentle BREATHING glow PERSISTS (a calm "you're up here" that doesn't vanish when
      // parked) — fixes the vista reward being a one-shot arrival pulse you'd miss. Bloom (#128)
      // makes it read. The structure's glow is the MAX of the one-shot pulse + this sustain.
      let sustain = 0;
      if (a.near && !isDriveThrough(lm.type)) {
        a.sustainT += dt;
        const breath = 0.5 + 0.5 * Math.sin(a.sustainT * ZEN_LANDMARK.vistaSustainRate);
        sustain = ZEN_LANDMARK.vistaSustainBase + ZEN_LANDMARK.vistaSustainAmp * breath;
      } else {
        a.sustainT = 0;
      }
      const glow = Math.max(env, sustain);
      a.material.color.copy(a.baseColor).lerp(_white, glow * ZEN_LANDMARK.pulseBrighten);
      a.mesh.scale.setScalar(lm.scale * (1 + glow * ZEN_LANDMARK.pulseSwell));

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

  /** Push the car out of any landmark's SOLID parts (arch/gateway pillars). Rings + surface types are
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

    // Gate ripple mesh — drive-through types only (ring, arch, gateway). A FILLED additive annulus
    // at CAR HEIGHT, face-on to the opening (you drive THROUGH it), hidden until you cross. Additive
    // so the bloom pass flares it. (The old version was a thin line-circle ~26u overhead, edge-on —
    // it rendered but was unseeable. See diag/zen-reward-not-rendering.) Vista/tunnel get none.
    let gateMesh: THREE.Mesh | null = null;
    let gateMaterial: THREE.MeshBasicMaterial | null = null;
    if (isDriveThrough(lm.type)) {
      gateMaterial = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0,
        fog: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide, // seen whether you approach from the front or the back
      });
      gateMesh = new THREE.Mesh(this.rippleGeo, gateMaterial);
      gateMesh.position.set(lm.x, groundY + ZEN_LANDMARK.gateRippleHeight, lm.z); // car/eye level
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
      sustainT: 0,
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

  /** GATEWAY — a COLOSSAL double arch (the bigger drive-through). Two pillars + a bowed beam, plus
   *  an inner frame, at gateway dimensions; you drive THROUGH along local Z (reuses the #126 reward). */
  private buildGateway(): THREE.BufferGeometry {
    const p: number[] = [];
    const line = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
      p.push(ax, ay, az, bx, by, bz);
    const H = ZEN_LANDMARK.gatewayHeight;
    const W = ZEN_LANDMARK.gatewayHalfWidth;
    const pr = ZEN_LANDMARK.gatewayPillarRadius;
    const rise = ZEN_LANDMARK.gatewayRise;
    const N = ZEN_LANDMARK.archBeamSegments;
    // Outer frame + an inner frame → a grand double portal.
    for (const k of [1, ZEN_LANDMARK.gatewayInnerScale]) {
      const w = W * k;
      const h = H * k;
      const r = rise * k;
      for (const sx of [-w, w]) {
        for (const dz of [-pr, pr]) line(sx, 0, dz, sx, h, dz);
        line(sx, h, -pr, sx, h, pr);
      }
      for (const dz of [-pr, pr]) {
        let px: number = -w;
        let py: number = h;
        for (let i = 1; i <= N; i++) {
          const t = i / N;
          const x = -w + 2 * w * t;
          const y = h + r * Math.sin(Math.PI * t);
          line(px, py, dz, x, y, dz);
          px = x;
          py = y;
        }
      }
    }
    return ZenLandmarks.lineGeo(p);
  }

  /** VISTA — a raised flat-topped MESA you drive ONTO for the view: a rim circle at ground, a deck
   *  circle at the top, radial slope lines between, and a crown ring marking the overlook. The car
   *  rides the matching raised drivable surface (ZenLandmarkSurface). */
  private buildVista(): THREE.BufferGeometry {
    const p: number[] = [];
    const R = ZEN_LANDMARK.vistaRadius;
    const topR = ZEN_LANDMARK.vistaTopRadius;
    const H = ZEN_LANDMARK.vistaHeight;
    const n = ZEN_LANDMARK.vistaSegments;
    const circle = (rad: number, y: number) => {
      let px = rad;
      let pz = 0;
      for (let i = 1; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = Math.cos(a) * rad;
        const z = Math.sin(a) * rad;
        p.push(px, y, pz, x, y, z);
        px = x;
        pz = z;
      }
    };
    circle(R, 0); // rim where the mesa meets the terrain
    circle(topR, H); // the flat deck edge
    circle(topR * ZEN_LANDMARK.vistaInnerRingRatio, H); // an inner deck ring
    circle(topR * ZEN_LANDMARK.vistaCrownRingRatio, H + ZEN_LANDMARK.vistaCrownRise); // a low crown marker
    // Radial slope lines (rim → deck) every few segments.
    for (let i = 0; i < n; i += 3) {
      const a = (i / n) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      p.push(R * c, 0, R * s, topR * c, H, topR * s);
    }
    return ZenLandmarks.lineGeo(p);
  }

  /** TUNNEL — a neon TUBE you descend INTO (drive along local Z): arched cross-section RIBS at
   *  intervals (floor dipping to the centre), plus longitudinal floor edges + a ceiling apex line.
   *  The terrain stays the roof; the car follows the lower floor (ZenLandmarkSurface). */
  private buildTunnel(): THREE.BufferGeometry {
    const p: number[] = [];
    const line = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
      p.push(ax, ay, az, bx, by, bz);
    const halfL = ZEN_LANDMARK.tunnelLength * 0.5;
    const hw = ZEN_LANDMARK.tunnelHalfWidth;
    const depth = ZEN_LANDMARK.tunnelDepth;
    const head = ZEN_LANDMARK.tunnelHeadroom;
    const arcN = ZEN_LANDMARK.tunnelArcSegments;
    const step = ZEN_LANDMARK.tunnelRibSpacing;
    // Floor depth profile (local; mirrors ZenLandmarkSurface): full depth inner half → 0 at mouths.
    const floorY = (z: number): number => {
      const s = Math.abs(z);
      const f = 1 - smoothstep(halfL * ZEN_LANDMARK.tunnelDepthEaseStart, halfL, s);
      return -depth * f;
    };
    // Arched cross-section at z: floor-left → ceiling arc → floor-right.
    const ribAt = (z: number, emit: (x: number, y: number) => void) => {
      const fy = floorY(z);
      for (let i = 0; i <= arcN; i++) {
        const a = Math.PI * (i / arcN); // 0..π → left to right over the top
        emit(-Math.cos(a) * hw, fy + Math.sin(a) * head);
      }
    };
    // Ribs.
    for (let z = -halfL; z <= halfL + 1e-6; z += step) {
      let prev: [number, number] | null = null;
      ribAt(z, (x, y) => {
        if (prev) line(prev[0], prev[1], z, x, y, z);
        prev = [x, y];
      });
    }
    // Longitudinal lines: the two floor edges + the ceiling apex, connecting consecutive ribs.
    let pfL: [number, number] | null = null;
    let pfR: [number, number] | null = null;
    let pc: [number, number] | null = null;
    for (let z = -halfL; z <= halfL + 1e-6; z += step) {
      const fy = floorY(z);
      const cL: [number, number] = [-hw, fy];
      const cR: [number, number] = [hw, fy];
      const ca: [number, number] = [0, fy + head];
      if (pfL) line(pfL[0], pfL[1], z - step, cL[0], cL[1], z);
      if (pfR) line(pfR[0], pfR[1], z - step, cR[0], cR[1], z);
      if (pc) line(pc[0], pc[1], z - step, ca[0], ca[1], z);
      pfL = cL;
      pfR = cR;
      pc = ca;
    }
    // ENTRANCE BEACON at each mouth (z = ±halfL, where the floor is at ground level): a tall portal
    // frame + downward chevrons, so the tunnel ANNOUNCES itself from afar (bloom-lit) and reads as
    // "drive DOWN here" — the distinctive bit (the descent) is below ground, this stands above it.
    const bh = ZEN_LANDMARK.tunnelBeaconHeight;
    const span = hw * ZEN_LANDMARK.tunnelBeaconChevronSpan;
    const dip = ZEN_LANDMARK.tunnelBeaconChevronDip;
    const nChev = ZEN_LANDMARK.tunnelBeaconChevrons;
    for (const mz of [-halfL, halfL]) {
      // Portal frame: two posts + a top beam, at the mouth plane (floor is 0 here).
      line(-hw, 0, mz, -hw, bh, mz);
      line(hw, 0, mz, hw, bh, mz);
      line(-hw, bh, mz, hw, bh, mz);
      // Downward chevrons stacked in the frame (V's pointing down → "descend").
      for (let k = 0; k < nChev; k++) {
        const y = bh * (ZEN_LANDMARK.tunnelBeaconChevronStartFrac - k * ZEN_LANDMARK.tunnelBeaconChevronStepFrac);
        line(-span, y, mz, 0, y - dip, mz);
        line(0, y - dip, mz, span, y, mz);
      }
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

  private static lineGeo(positions: number[]): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }
}

/** Per-type neon colour (synthwave: ring orange, arch cyan, gateway purple, vista green, tunnel gold). */
const LANDMARK_COLORS: Record<LandmarkType, number> = {
  [LANDMARK_RING]: ZEN_LANDMARK.ringColor,
  [LANDMARK_ARCH]: ZEN_LANDMARK.archColor,
  [LANDMARK_GATEWAY]: ZEN_LANDMARK.gatewayColor,
  [LANDMARK_VISTA]: ZEN_LANDMARK.vistaColor,
  [LANDMARK_TUNNEL]: ZEN_LANDMARK.tunnelColor,
};
