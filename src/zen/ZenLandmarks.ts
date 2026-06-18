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
import { ZEN_LANDMARK, ZEN_TUNNEL_VISUAL } from '../utils/constants';
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
  tunnelBendShape,
  tunnelDepthFactor,
  type Landmark,
  type LandmarkType,
  LANDMARK_RING,
  LANDMARK_ARCH,
  LANDMARK_GATEWAY,
  LANDMARK_VISTA,
  LANDMARK_TUNNEL,
} from './ZenLandmarkModel';
import {
  descentParam,
  tunnelTubeRGB,
  tunnelFloorRGB,
  tunnelDecorPlan,
  tunnelDecorWallOffset,
} from './ZenTunnelVisual';

interface Active {
  landmark: Landmark;
  mesh: THREE.LineSegments;
  material: THREE.LineBasicMaterial;
  baseColor: THREE.Color;
  /** True for vertex-coloured meshes (the tunnel tube): the reach-glow brightens by SCALING
   *  material.color above white (×>1) rather than lerping a flat base toward white — so the per-vertex
   *  gradient is preserved at rest and amplified (bloom-flared) during the glow. */
  vertexLit: boolean;
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
  // --- tunnel ROAD (tunnel only; null otherwise): the cyan floor mesh the car drives on, fading
  //     in with distance alongside the gold tube. ---
  floorMesh: THREE.LineSegments | null;
  floorMaterial: THREE.LineBasicMaterial | null;
  // --- per-tunnel DECORATION (tunnel only; null otherwise): the wall crystals, seeded by the tunnel
  //     id so each tunnel looks distinct. Per-instance geometry (NOT shared) → disposed on cull. ---
  decorMesh: THREE.LineSegments | null;
  decorMaterial: THREE.LineBasicMaterial | null;
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
  /** Shared TUNNEL FLOOR geometry (the cyan road) — built once, referenced by every tunnel instance. */
  private readonly tunnelFloorGeo: THREE.BufferGeometry;
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
    // The cyan tunnel road (shared across tunnel instances).
    this.tunnelFloorGeo = this.buildTunnelFloor();
  }

  /** Count of in-range landmark instances currently streamed in (read-only; the validation sweep's
   *  bounded-growth canary — landmarks are rare, so this stays small as the car roams). */
  get activeCount(): number {
    return this.active.size;
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
        if (a.floorMesh) a.floorMesh.removeFromParent();
        if (a.floorMaterial) a.floorMaterial.dispose();
        if (a.decorMesh) { a.decorMesh.removeFromParent(); a.decorMesh.geometry.dispose(); }
        if (a.decorMaterial) a.decorMaterial.dispose();
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
      if (a.vertexLit) {
        // White baseline (= the gradient shows true) → scale ABOVE white to brighten the whole
        // per-vertex gradient on the glow (bloom flares the lifted colours). At rest: scalar 1 = white.
        a.material.color.setScalar(1 + glow * ZEN_LANDMARK.pulseBrighten);
      } else {
        a.material.color.copy(a.baseColor).lerp(_white, glow * ZEN_LANDMARK.pulseBrighten);
      }
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
      // The tunnel road + the wall crystals fade with the tube (same distance emerge).
      if (a.floorMaterial) a.floorMaterial.opacity = a.material.opacity;
      if (a.decorMaterial) a.decorMaterial.opacity = a.material.opacity;
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
    // The TUNNEL tube carries a per-vertex depth GRADIENT (cyan→violet→gold) + magenta decor crystals,
    // so its material is WHITE with vertexColors on (the gradient rides the vertex attribute). The
    // reach-pulse then BRIGHTENS the gradient by scaling material.color above white (see update()).
    const vertexLit = lm.type === LANDMARK_TUNNEL;
    const material = new THREE.LineBasicMaterial({
      color: vertexLit ? 0xffffff : colorHex,
      vertexColors: vertexLit,
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

    // Tunnel ROAD — the cyan floor mesh (tunnel only). Same transform as the gold tube, its own
    // colour + material so it reads as a distinct road; fades in with distance alongside the tube.
    let floorMesh: THREE.LineSegments | null = null;
    let floorMaterial: THREE.LineBasicMaterial | null = null;
    if (lm.type === LANDMARK_TUNNEL) {
      floorMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff, // white base — the cyan-held depth gradient rides the vertex colours
        vertexColors: true,
        transparent: true,
        opacity: 1,
        fog: false,
        depthWrite: false,
      });
      floorMesh = new THREE.LineSegments(this.tunnelFloorGeo, floorMaterial);
      floorMesh.position.set(lm.x, groundY, lm.z);
      floorMesh.rotation.y = lm.rotationY;
      floorMesh.scale.setScalar(lm.scale);
      floorMesh.frustumCulled = false;
      this.scene.add(floorMesh);
    }

    // Per-tunnel DECORATION (tunnel only) — wall crystals seeded by the tunnel id, so each tunnel is
    // visibly distinct. Its own (per-instance) geometry + white vertex-colour material; same transform
    // as the tube; fades in with distance like the floor. Disposed on cull (it's not shared geometry).
    let decorMesh: THREE.LineSegments | null = null;
    let decorMaterial: THREE.LineBasicMaterial | null = null;
    if (lm.type === LANDMARK_TUNNEL) {
      const decorGeo = this.buildTunnelDecorGeo(lm);
      if (decorGeo) {
        decorMaterial = new THREE.LineBasicMaterial({
          color: 0xffffff, // white base — the per-tunnel accent rides the vertex colours
          vertexColors: true,
          transparent: true,
          opacity: 1,
          fog: false,
          depthWrite: false,
        });
        decorMesh = new THREE.LineSegments(decorGeo, decorMaterial);
        decorMesh.position.set(lm.x, groundY, lm.z);
        decorMesh.rotation.y = lm.rotationY;
        decorMesh.scale.setScalar(lm.scale);
        decorMesh.frustumCulled = false;
        this.scene.add(decorMesh);
      }
    }

    this.active.set(lm.id, {
      landmark: lm,
      mesh,
      material,
      baseColor: new THREE.Color(vertexLit ? 0xffffff : colorHex),
      vertexLit,
      pulseT: -1,
      near: false,
      sustainT: 0,
      gateMesh,
      gateMaterial,
      gateT: -1,
      floorMesh,
      floorMaterial,
      decorMesh,
      decorMaterial,
    });
  }

  dispose(): void {
    for (const a of this.active.values()) {
      a.mesh.removeFromParent();
      a.material.dispose();
      if (a.gateMesh) a.gateMesh.removeFromParent();
      if (a.gateMaterial) a.gateMaterial.dispose();
      if (a.floorMesh) a.floorMesh.removeFromParent();
      if (a.floorMaterial) a.floorMaterial.dispose();
      if (a.decorMesh) { a.decorMesh.removeFromParent(); a.decorMesh.geometry.dispose(); }
      if (a.decorMaterial) a.decorMaterial.dispose();
    }
    this.active.clear();
    for (const g of this.geo) g.dispose();
    this.rippleGeo.dispose();
    this.tunnelFloorGeo.dispose();
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

  /** Local floor Y at axial position z: the SHARED tunnelDepthFactor (ONE definition with the followed
   *  drivable surface — ZenLandmarkSurface — so the car sits exactly on this road). Full depth through
   *  the inner half, easing to 0 at the mouths. Shared by the tube ribs + the floor road. */
  private static tunnelFloorY(z: number, halfL: number): number {
    return -ZEN_LANDMARK.tunnelDepth * tunnelDepthFactor(z / halfL);
  }

  /** TUNNEL — a neon TUBE you descend INTO (drive along local Z): arched cross-section RIBS at
   *  intervals + a ceiling apex line. The ceiling height TAPERS to ~0 at the mouths (tracking the
   *  floor's depth ease) so the tube doesn't protrude an awkward arch above flat ground — the mouth
   *  reads as a clean descending slot under the beacon. The ROAD (floor) is a separate cyan mesh
   *  (buildTunnelFloor). The terrain stays the roof; the car follows the lower floor (ZenLandmarkSurface). */
  private buildTunnel(): THREE.BufferGeometry {
    const p: number[] = [];
    const c: number[] = [];
    const halfL = ZEN_LANDMARK.tunnelLength * 0.5;
    // GRADIENT line: positions + per-vertex colour by each endpoint's DESCENT PROGRESS (cyan→violet→
    // gold deepening toward the centre). The colour rides the vertex attribute; material stays white.
    const tubeRGB = (z: number): [number, number, number] => tunnelTubeRGB(descentParam(z / halfL));
    const line = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      p.push(ax, ay, az, bx, by, bz);
      const a = tubeRGB(az), b = tubeRGB(bz);
      c.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    };
    // FIXED-colour line (the above-ground BEACON keeps its gold "spot me" identity, not the gradient).
    const lineFixed = (
      ax: number, ay: number, az: number, bx: number, by: number, bz: number,
      r: number, g: number, bl: number,
    ) => {
      p.push(ax, ay, az, bx, by, bz);
      c.push(r, g, bl, r, g, bl);
    };
    const hw = ZEN_LANDMARK.tunnelHalfWidth;
    const head = ZEN_LANDMARK.tunnelHeadroom;
    const arcN = ZEN_LANDMARK.tunnelArcSegments;
    const step = ZEN_LANDMARK.tunnelRibSpacing;
    const floorY = (z: number) => ZenLandmarks.tunnelFloorY(z, halfL);
    // Lateral CURVE: the centreline sweeps sideways by bend(z) (zero + tangent at the mouths). The
    // whole cross-section (floor + arch) is centred on it, so the tube bends as a unit.
    const bend = (z: number) => ZEN_LANDMARK.tunnelBendAmplitude * tunnelBendShape(z / halfL);
    // Ceiling height at z: tapers from ~0 at the mouths to full headroom deep inside (tracks the
    // depth ease), so the arch grows AS you sink — no protruding pipe-end at the surface.
    const archH = (z: number): number => {
      const grow = 1 - smoothstep(halfL * ZEN_LANDMARK.tunnelDepthEaseStart, halfL, Math.abs(z));
      return head * (ZEN_LANDMARK.tunnelMouthArchFloor + (1 - ZEN_LANDMARK.tunnelMouthArchFloor) * grow);
    };
    // Arched cross-section at z: floor-left → ceiling arc → floor-right (height tapered near mouths,
    // centred on the curving centreline bend(z)).
    const ribAt = (z: number, emit: (x: number, y: number) => void) => {
      const fy = floorY(z);
      const h = archH(z);
      const cx = bend(z);
      for (let i = 0; i <= arcN; i++) {
        const a = Math.PI * (i / arcN); // 0..π → left to right over the top
        emit(cx - Math.cos(a) * hw, fy + Math.sin(a) * h);
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
    // Longitudinal ceiling apex line, connecting consecutive ribs (the floor lines live in the road mesh).
    let pc: [number, number] | null = null;
    for (let z = -halfL; z <= halfL + 1e-6; z += step) {
      const ca: [number, number] = [bend(z), floorY(z) + archH(z)];
      if (pc) line(pc[0], pc[1], z - step, ca[0], ca[1], z);
      pc = ca;
    }
    // ENTRANCE BEACON at each mouth (z = ±halfL, where the floor is at ground level): a tall portal
    // frame + downward chevrons, so the tunnel ANNOUNCES itself from afar (bloom-lit) and reads as
    // "drive DOWN here" — the distinctive bit (the descent) is below ground, this stands above it.
    const bh = ZEN_LANDMARK.tunnelBeaconHeight;
    const span = hw * ZEN_LANDMARK.tunnelBeaconChevronSpan;
    const dip = ZEN_LANDMARK.tunnelBeaconChevronDip;
    const nChev = ZEN_LANDMARK.tunnelBeaconChevrons;
    // The beacon keeps the established GOLD tunnel colour (its spot-from-afar identity), not the gradient.
    const gold = ZEN_LANDMARK.tunnelColor;
    const gr = ((gold >> 16) & 0xff) / 255, gg = ((gold >> 8) & 0xff) / 255, gb = (gold & 0xff) / 255;
    const beacon = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
      lineFixed(ax, ay, az, bx, by, bz, gr, gg, gb);
    for (const mz of [-halfL, halfL]) {
      // Portal frame: two posts + a top beam, at the mouth plane (floor is 0 here).
      beacon(-hw, 0, mz, -hw, bh, mz);
      beacon(hw, 0, mz, hw, bh, mz);
      beacon(-hw, bh, mz, hw, bh, mz);
      // Downward chevrons stacked in the frame (V's pointing down → "descend").
      for (let k = 0; k < nChev; k++) {
        const y = bh * (ZEN_LANDMARK.tunnelBeaconChevronStartFrac - k * ZEN_LANDMARK.tunnelBeaconChevronStepFrac);
        beacon(-span, y, mz, 0, y - dip, mz);
        beacon(0, y - dip, mz, span, y, mz);
      }
    }
    // (Stage 2b) The decorative crystals are NO LONGER baked here — the shared per-type geometry would
    // make every tunnel identical. They're now a SEPARATE per-tunnel mesh (buildTunnelDecorGeo), seeded
    // by the tunnel id, so each tunnel's decoration is distinct-but-deterministic. The tube gradient +
    // beacon stay shared (identical is correct for them).
    return ZenLandmarks.lineGeo(p, c);
  }

  /** PER-TUNNEL decoration geometry (Stage 2b): the wall crystals for ONE tunnel, seeded by its id so
   *  each tunnel looks distinct (different accent / density / motif / sizing) yet deterministic. Built
   *  on spawn, disposed on cull (per-instance — NOT shared). Purely decorative: set into the walls,
   *  above the road, NEVER seen by the drivable surface. Returns null if the plan is empty. */
  private buildTunnelDecorGeo(lm: Landmark): THREE.BufferGeometry | null {
    const halfL = ZEN_LANDMARK.tunnelLength * 0.5;
    const items = tunnelDecorPlan(this.seed, lm.id, halfL);
    if (items.length === 0) return null;
    const p: number[] = [];
    const c: number[] = [];
    const bend = (z: number) => ZEN_LANDMARK.tunnelBendAmplitude * tunnelBendShape(z / halfL);
    const wallOff = tunnelDecorWallOffset();
    for (const it of items) {
      const wx = bend(it.z) + it.sign * wallOff; // out by the curving wall, not on the central road
      const z = it.z, cy = it.centreY, s = it.size;
      const [r, g, b] = it.rgb;
      // A wall crystal in the (y, z) plane at x = wx (mounted flush to the wall, above the floor). The
      // seg() helper pushes one line + its two endpoint colours (the per-tunnel accent).
      const seg = (ay: number, az: number, by: number, bz: number) => {
        p.push(wx, ay, az, wx, by, bz);
        c.push(r, g, b, r, g, b);
      };
      if (it.motif === 0) {
        // Faceted DIAMOND: 4 outline edges (top/fore/bottom/aft) + a vertical + horizontal facet.
        seg(cy + s, z, cy, z + s); seg(cy, z + s, cy - s, z); seg(cy - s, z, cy, z - s); seg(cy, z - s, cy + s, z);
        seg(cy + s, z, cy - s, z); seg(cy, z + s, cy, z - s);
      } else {
        // Tall HEX SHARD: a 6-point elongated crystal (narrower in z, taller in y) + a vertical spine.
        const hz = s * ZEN_TUNNEL_VISUAL.decorHexZFrac, sy = s * ZEN_TUNNEL_VISUAL.decorHexYFrac;
        seg(cy + s, z, cy + sy, z + hz); seg(cy + sy, z + hz, cy - sy, z + hz); seg(cy - sy, z + hz, cy - s, z);
        seg(cy - s, z, cy - sy, z - hz); seg(cy - sy, z - hz, cy + sy, z - hz); seg(cy + sy, z - hz, cy + s, z);
        seg(cy + s, z, cy - s, z);
      }
    }
    return ZenLandmarks.lineGeo(p, c);
  }

  /** TUNNEL FLOOR — the cyan neon ROAD the car drives on (a separate mesh/colour from the gold tube).
   *  A centre line + two side rails along the full length at the drivable-surface Y, plus dense lateral
   *  RUNGS — so the descent reads as a real road underfoot, not a void. Descends + flattens + ascends
   *  with the floor profile (matches ZenLandmarkSurface at the centreline). */
  private buildTunnelFloor(): THREE.BufferGeometry {
    const p: number[] = [];
    const c: number[] = [];
    const halfL = ZEN_LANDMARK.tunnelLength * 0.5;
    // The ROAD's colour evolves with depth too, but held toward cyan (the readable "drive here" ribbon).
    const floorRGB = (z: number): [number, number, number] => tunnelFloorRGB(descentParam(z / halfL));
    const line = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      p.push(ax, ay, az, bx, by, bz);
      const a = floorRGB(az), b = floorRGB(bz);
      c.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    };
    const hw = ZEN_LANDMARK.tunnelHalfWidth;
    const rung = ZEN_LANDMARK.tunnelFloorRungSpacing;
    const floorY = (z: number) => ZenLandmarks.tunnelFloorY(z, halfL);
    const bend = (z: number) => ZEN_LANDMARK.tunnelBendAmplitude * tunnelBendShape(z / halfL);
    // Three longitudinal rails (left edge, centre, right edge) tracking the CURVING centreline bend(z)
    // at the descending floor Y, plus a lateral rung at each step (the road "ladder").
    let prev: { l: number; m: number; r: number; y: number } | null = null;
    for (let z = -halfL; z <= halfL + 1e-6; z += rung) {
      const fy = floorY(z);
      const cx = bend(z);
      const l = cx - hw, m = cx, r = cx + hw;
      if (prev) {
        const pz = z - rung;
        line(prev.l, prev.y, pz, l, fy, z); // left rail
        line(prev.m, prev.y, pz, m, fy, z); // centre line
        line(prev.r, prev.y, pz, r, fy, z); // right rail
      }
      line(l, fy, z, r, fy, z); // lateral rung across the channel
      prev = { l, m, r, y: fy };
    }
    return ZenLandmarks.lineGeo(p, c);
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

  private static lineGeo(positions: number[], colors?: number[]): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    // Optional per-vertex COLOUR (tunnel only — the depth gradient + decor). Other types pass no
    // colours and their materials leave vertexColors off, so this attribute is simply absent for them.
    if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
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
