/**
 * ZEN FREE-ROAM renderer — a PARALLEL three.js scene + chase camera, drawn with the
 * game's SHARED WebGLRenderer (one GL context; the forward SceneManager scene is left
 * untouched and simply not drawn while Zen is active). Reuses the procedural `CarMesh`
 * (so the player drives THE car, cosmetics and all); the rest (grid plane, chase cam)
 * is Zen-specific. No post/bloom in PR1 — the FEEL gate is about movement, not polish.
 *
 * The camera follows the car's position and eases BEHIND its facing (smoothed) for a
 * gliding, calm chase — distinct from the forward game's fixed, forward-locked cam.
 */

import * as THREE from 'three';
import { ZEN, ZEN_SLIDE, ZEN_TUNNEL_SECRET, type CarDef } from '../utils/constants';
import { clamp, smoothFollow, wrapToPi } from '../utils/math';
import { CarMesh } from '../rendering/CarMesh';
import { zenFraming } from './ZenCamera';
import { ZenScenery } from './ZenScenery';
import { ZenTerrain } from './ZenTerrain';
import { ZenBackdrop } from './ZenBackdrop';
import { ZenShadow } from './ZenShadow';
import { ZenStarfield } from './ZenStarfield';
import { ZenSpeedStreaks } from './ZenSpeedStreaks';
import { ZenBiomeView } from './ZenBiomeView';
import { biomeAt, createZenBiomeState } from './ZenBiome';
import { ZenLandmarks } from './ZenLandmarks';
import { ZenCavern } from './ZenCavern';
import { ZenPost } from './ZenPost';
import { drivableSurfaceY, surfaceSlopeAlong } from './ZenLandmarkSurface';
import { buildSlideMesh, disposeSlideMesh } from './ZenSkySlide';
import { ZenSlidePath } from './ZenSlidePath';
import type { ZenVehicle } from './ZenVehicle';

export class ZenRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly car: CarMesh;
  private readonly backdrop: ZenBackdrop;
  private readonly terrain: ZenTerrain;
  private readonly scenery: ZenScenery;
  private readonly landmarks: ZenLandmarks;
  /** The beautiful tunnel-payoff CAVERN (centerpiece + monuments + shell + ceiling) — built once,
   *  shown only while inside the tunnel space. Visual decoration on the existing ground. */
  private readonly cavern: ZenCavern;
  private readonly shadow: ZenShadow;
  private readonly stars: ZenStarfield;
  private readonly biomeView: ZenBiomeView;
  /** Bloom post pass — makes the neon (structures, grid, the landmark reward flash) GLOW. */
  private readonly post: ZenPost;
  /** Reused biome-state scratch sampled at the car each frame (no per-frame alloc). */
  private readonly biomeState = createZenBiomeState();
  private aspect = 0;
  private lastW = 0;
  private lastH = 0;
  /** Eased "boom" heading — the camera swings behind the car's facing as it TURNS, so
   *  turns glide rather than snap. Decoupled from forward motion (no speed lag). */
  private boomHeading = 0;
  /** True while the car is inside a secret area → the secret palette is forced. */
  private secretActive = false;
  /** True while the car is inside the TUNNEL-PAYOFF space → the deep-amber palette is forced. */
  private tunnelSecretActive = false;
  /** Eased speed factor (0..1) driving the gentle distance/FOV swing; smoothed so brief
   *  throttle changes don't pump the framing. */
  private speedFactor = 0;
  /** Eased look-at target height — tracks the car's Y at the SAME rate as position.y, so the
   *  rig moves as one smooth unit. Easing this (vs aiming at the raw v.y) absorbs any v.y
   *  discontinuity (e.g. a landing settle) instead of whipping the whole view. */
  private lookY: number = ZEN.camLookAtHeight;
  /** The Sky-Slide tube mesh while a slide is active (null otherwise). */
  private slideMesh: THREE.Group | null = null;
  /** Speed-streak field for the ARCH boost; `boost` ∈ [0,1] eases its opacity (0 = hidden). */
  private readonly streaks: ZenSpeedStreaks;
  private boost = 0;
  /** The world seed the STREAMED world (terrain/scenery/landmarks) + the per-frame surface/biome reads
   *  key off. Normally the session seed; SWITCHED to ZEN_TUNNEL_SECRET.seed while warped in the tunnel
   *  cavern (setWorldSeed) so that region is the SAME designed space every session (#172 bug fix). */
  private seed: number;

  constructor(renderer: THREE.WebGLRenderer, seed: number, car?: CarDef) {
    this.renderer = renderer;
    this.seed = seed; // set FIRST — the sub-objects below build the world from it
    // Fog tinted to the HORIZON colour so the grid floor fades into the sunset horizon
    // (not a flat purple band) — the backdrop's sky gradient ends in the same colour, so
    // floor and sky meet seamlessly. The backdrop sets scene.background (the sky gradient).
    this.scene.fog = new THREE.FogExp2(ZEN.horizonColor, ZEN.fogDensity);

    this.camera = new THREE.PerspectiveCamera(ZEN.camFov, 1, ZEN.camNear, ZEN.camFar);
    this.camera.position.set(0, ZEN.camHeight, ZEN.camDistance);

    // Serene sunset horizon (sky + sun + mountain ring) — kills the void, works 360°.
    this.backdrop = new ZenBackdrop(this.scene, this.seed);

    // The neon synthwave grid is now a HEIGHTMAP surface (rolling hills), streamed +
    // recentred on the car. Seams perfectly because heights come from world coords.
    this.terrain = new ZenTerrain(this.scene, this.seed);

    // Chunk-streamed scenery (the populated world the car drives through), on the terrain.
    this.scenery = new ZenScenery(this.scene, this.seed);

    // Rare neon LANDMARKS — beacons you spot from afar + journey to (streamed + reach pulses).
    this.landmarks = new ZenLandmarks(this.scene, this.seed);

    // The tunnel payoff CAVERN — a vast amber space at the tunnel region (hidden until you warp in).
    // Built from the FIXED tunnel-region seed (NOT the random session seed) so the cave is the SAME
    // designed space every session; the region's terrain is rendered from the same fixed seed while
    // inside (setWorldSeed), so the cavern sits exactly on it (no float). (#172 "different world" fix.)
    this.cavern = new ZenCavern(this.scene, ZEN_TUNNEL_SECRET.seed);

    // Terrain-anchored air-shadow: a gap opens between car + shadow when airborne.
    this.shadow = new ZenShadow(this.scene);

    // Biome REGIONS: a 360° star dome + the apply that pushes the blended biome palette
    // (fog/sky/sun/mountains/stars/prop-tint) from the biome under the car each frame.
    this.stars = new ZenStarfield(this.scene, this.seed);
    this.biomeView = new ZenBiomeView(this.scene, this.backdrop, this.stars, this.scenery);

    // ARCH speed-boost streaks (hidden until a boost is active).
    this.streaks = new ZenSpeedStreaks(this.scene);

    this.car = new CarMesh(car);
    // YXZ so the slope PITCH (rotation.x) is applied about the already-yawed lateral
    // axis — nose tips up/down along the facing, not in world space.
    this.car.group.rotation.order = 'YXZ';
    this.scene.add(this.car.group);

    // Bloom post pass (the neon GLOW). Built last — needs the scene + camera. The session's
    // quality setting (setQuality) toggles it: HIGH = bloom, LOW = direct render (cheap).
    this.post = new ZenPost(this.scene, this.camera, this.renderer);

    this.resize();
  }

  /** Quality lever — LOW (retro FX off) swaps scenery to the plain pillars AND bypasses bloom
   *  (direct render — the guaranteed-cheap path); HIGH enables the bloom glow. */
  setQuality(high: boolean): void {
    this.scenery.setNeon(high);
    this.post.setQuality(high);
  }

  /** READ-ONLY render-side state for the validation sweep (no behaviour): the camera position (a
   *  NaN candidate via the eased lookY after a warp/tunnel) + the streamed scene-graph counts (the
   *  bounded-growth canaries). Mirrors live values; adds nothing to the render path. */
  get debugInfo(): {
    cam: { x: number; y: number; z: number };
    camHeading: number;
    counts: { props: number; terrainVerts: number; landmarks: number; sceneChildren: number };
  } {
    const c = this.camera.position;
    return {
      cam: { x: c.x, y: c.y, z: c.z },
      camHeading: this.boomHeading, // the camera's orbit angle — the slide-spin canary watches its Δ
      counts: {
        props: this.scenery.activePropCount,
        terrainVerts: this.terrain.vertexCount,
        landmarks: this.landmarks.activeCount,
        sceneChildren: this.scene.children.length,
      },
    };
  }

  /** Resolve the car's position out of solid props AND solid landmark parts (DEFLECT/SLIDE).
   *  The sim calls this after moving the car. Both scans are bounded around (x, z). Landmark
   *  rings + surface types are pass-through (no solid parts); arch + gateway pillars deflect. */
  resolve(x: number, z: number): { x: number; z: number } {
    const s = this.scenery.resolve(x, z);
    return this.landmarks.resolve(s.x, s.z);
  }

  /** Apply a car's cosmetic colours (selected car + its paint). */
  applyCar(car: CarDef): void {
    this.car.applyCar(car);
  }

  /** Equip / clear a GLOW cosmetic override on the Zen car (purely visual). */
  setGlow(hex: number | null): void {
    this.car.setGlowOverride(hex);
  }

  /** Set the ARCH boost intensity (0..1) — drives the speed-streak visual's opacity + flow. */
  setBoost(intensity: number): void {
    this.boost = intensity;
  }

  /** Toggle the SECRET-area look — forces the secret palette (vs the coord-derived biome) while
   *  the car is inside a secret area. */
  setSecret(active: boolean): void {
    this.secretActive = active;
    this.terrain.setSecret(active); // force the GRID floor violet too (not just the backdrop)
  }

  /** Toggle the TUNNEL-PAYOFF look — forces the deep-amber palette while the car is inside the
   *  tunnel bottom space (a distinct hidden space from the violet secret area). */
  setTunnelSecret(active: boolean): void {
    this.tunnelSecretActive = active;
    this.terrain.setTunnelSecret(active); // force the GRID floor amber too
    this.cavern.setActive(active); // reveal the cavern (centerpiece + monuments + ceiling)
  }

  /** Re-key the STREAMED world (terrain/scenery/landmarks) + the per-frame surface/biome reads to a new
   *  seed. The tunnel warp calls this with ZEN_TUNNEL_SECRET.seed on ENTER (the cave region is the same
   *  designed space every session) and the session seed on EXIT. The seed-switch forces a re-stream,
   *  hidden by the warp fade (the same one-frame chunk reload the teleport already does). Backdrop/stars
   *  are a palette-overridden dome → not re-keyed. */
  setWorldSeed(seed: number): void {
    this.seed = seed;
    this.terrain.setSeed(seed);
    this.scenery.setSeed(seed);
    this.landmarks.setSeed(seed);
  }

  /** SNAP the chase camera to its resting pose behind the car's CURRENT position — used after a
   *  secret-area WARP so the rig doesn't ease across the teleport distance (it would slew for
   *  seconds). Mirrors the resting framing the per-frame ease converges to. */
  snapCamera(v: ZenVehicle): void {
    this.boomHeading = wrapToPi(v.heading);
    this.speedFactor = 0;
    const { distance } = zenFraming(0);
    this.camera.position.set(
      v.x - Math.sin(v.heading) * distance,
      v.y + ZEN.camHeight,
      v.z + Math.cos(v.heading) * distance,
    );
    this.lookY = v.y + ZEN.camLookAtHeight;
    this.camera.lookAt(v.x, this.lookY, v.z);
  }

  /**
   * Mirror the pure Zen vehicle onto the scene + ease the chase camera, then draw.
   * `steer` drives a gentle visual bank; `dt` paces the camera smoothing.
   */
  render(v: ZenVehicle, steer: number, dt: number): void {
    // COMFORT: while riding the Sky-Slide (the tube is up → slideMesh set), use the slide's own
    // CALMER camera — a softer heading/look-at ease that glides through the bends instead of
    // whipping, and far less bank so the horizon barely tilts. Normal driving keeps the global feel.
    const onSlide = this.slideMesh !== null;
    const camLerp = onSlide ? ZEN_SLIDE.camPosLerp : ZEN.camPosLerp;
    const leanMax = onSlide ? ZEN_SLIDE.leanMax : ZEN.leanMax;
    // Car: ride the terrain surface (or fly its arc), yaw to face the heading, pitch into
    // the slope (grounded) or along the flight arc (airborne), and bank into the turn
    // (chassis only, so the wheels-on-ground read stays). rotation.y = -heading aligns the
    // mesh's forward (-z) with the movement direction (sin h, -cos h).
    this.car.group.position.set(v.x, v.y, v.z);
    this.car.group.rotation.y = -v.heading;
    if (v.airborne) {
      // Tip the nose to follow the parabola: up while rising, down toward landing.
      const arc = Math.atan2(v.vy, Math.max(v.speed, 1));
      this.car.group.rotation.x = clamp(arc * ZEN.terrainTiltFactor, -ZEN.airTiltMax, ZEN.airTiltMax);
    } else {
      const slope = surfaceSlopeAlong(this.seed, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
      this.car.group.rotation.x = clamp(Math.atan(slope) * ZEN.terrainTiltFactor, -ZEN.terrainTiltMax, ZEN.terrainTiltMax);
    }
    this.car.chassis.rotation.z = -clamp(steer, -1, 1) * leanMax;

    // Terrain + scenery: stream the heightmap surface + props around the car (both rebuild
    // only on chunk crossings — cheap the rest of the time).
    this.terrain.update(v.x, v.z);
    this.scenery.update(v.x, v.z);
    // Landmarks: stream the rare beacons + advance their reach pulses (dt-paced).
    this.landmarks.update(v.x, v.z, dt);
    // Backdrop: horizon-lock the sunset sky/sun/mountains to the car so they stay on the
    // far horizon as you drive (cheap — just a group translate).
    this.backdrop.update(v.x, v.z);
    // Biome region: resolve the look at the car's position and apply it (throttled inside
    // — repaints fire a bounded number of times per transition, none at rest); keep the
    // star dome centred on the car. Inside a SECRET area, force the secret palette instead.
    if (this.tunnelSecretActive) {
      this.biomeView.applyTunnelSecret();
    } else if (this.secretActive) {
      this.biomeView.applySecret();
    } else {
      biomeAt(this.seed, v.x, v.z, this.biomeState);
      this.biomeView.apply(this.biomeState);
    }
    this.stars.update(v.x, v.z);
    // Air-shadow: pin a glow spot to the terrain under the car. Airborne, the car rises but
    // the shadow stays on the ground → a visible gap (the readable "in the air" cue).
    const groundY = drivableSurfaceY(this.seed, v.x, v.z) + ZEN.rideHeight;
    this.shadow.update(v.x, groundY, v.z, v.y - groundY);
    // ARCH boost speed-streaks: stream past the car, opacity/flow eased by the boost intensity.
    this.streaks.update(v.x, v.y, v.z, v.heading, this.boost, dt);

    // Chase camera — MOSTLY STEADY with only a whisper of speed reactivity (calm, not
    // adrenaline). Two decoupled parts:
    //   (1) TURN-GLIDE: ease a "boom" heading toward the car's facing, so the camera
    //       swings behind as you turn (gliding, not snapping). Forward motion adds NO
    //       distance lag here — the old fixed-target follow trailed further the faster
    //       you went (an uncontrolled speed swing); easing the heading instead keeps the
    //       resting distance steady at any cruise speed.
    //   (2) SPEED FEEL: a small, eased distance pull-back + subtle FOV widen from speed
    //       (the explicit zenFraming curve), so cruising still reads as motion.
    const f = smoothFollow(camLerp, dt);
    // WRAP-AWARE ease: step the SHORTEST signed way toward the (possibly ±π-wrapped) target heading,
    // and keep boomHeading itself bounded. On the slide v.heading is a wrapped atan2 — a raw lerp
    // unwound a full turn when it crossed ±π (the camera "spin", diagnosis #150). No-op for normal
    // driving (continuous heading → the delta is already small → wrapToPi doesn't change it).
    this.boomHeading = wrapToPi(this.boomHeading + wrapToPi(v.heading - this.boomHeading) * f);

    const targetFactor = clamp(v.speed / ZEN.maxSpeed, 0, 1);
    this.speedFactor += (targetFactor - this.speedFactor) * smoothFollow(ZEN.camSpeedLerp, dt);
    const { distance, fov } = zenFraming(this.speedFactor);

    // Behind = opposite the facing dir (sin h, -cos h) → (-sin h, +cos h), at `distance`.
    this.camera.position.x = v.x - Math.sin(this.boomHeading) * distance;
    this.camera.position.z = v.z + Math.cos(this.boomHeading) * distance;
    // Height eases toward the car's surface height + the chase height, so cresting a hill
    // is a smooth vertical glide (the eased follow), never a jarring snap.
    this.camera.position.y += (v.y + ZEN.camHeight - this.camera.position.y) * f;
    // Ease the look-at height at the SAME rate as position.y (was aimed at the raw v.y —
    // a landing snap whipped the view ~41°/frame). Now a v.y discontinuity is absorbed into
    // a smooth catch-up: position + look move as one unit, no whole-frame lurch.
    this.lookY += (v.y + ZEN.camLookAtHeight - this.lookY) * f;
    this.camera.lookAt(v.x, this.lookY, v.z);

    // Apply the gentle FOV widen (only touch the projection when it actually moves).
    if (Math.abs(fov - this.camera.fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    this.resize(); // cheap size check (updates only on a real size change)
    this.post.render(); // bloom composer (HIGH) or direct render (LOW)
  }

  /** Keep the camera aspect + the bloom composer in sync with the (shared) renderer's drawing
   *  buffer — only on a real size change (cheap compare the rest of the time). */
  private resize(): void {
    const size = this.renderer.getSize(_tmpSize);
    if (size.x === this.lastW && size.y === this.lastH) return;
    this.lastW = size.x;
    this.lastH = size.y;
    this.aspect = size.x / Math.max(1, size.y);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    this.post.setSize(size.x, size.y);
  }

  /** Show the Sky-Slide tube (built once on launch from the pure path); replaces any prior one. */
  showSlide(path: ZenSlidePath): void {
    this.hideSlide();
    this.slideMesh = buildSlideMesh(path);
    this.scene.add(this.slideMesh);
  }

  /** Remove + dispose the Sky-Slide tube (on landing / session teardown). Safe to call when absent. */
  hideSlide(): void {
    if (!this.slideMesh) return;
    this.scene.remove(this.slideMesh);
    disposeSlideMesh(this.slideMesh);
    this.slideMesh = null;
  }

  dispose(): void {
    this.hideSlide();
    this.scene.remove(this.car.group);
    this.car.dispose();
    this.backdrop.dispose();
    this.shadow.dispose();
    this.terrain.dispose();
    this.scenery.dispose();
    this.landmarks.dispose();
    this.cavern.dispose();
    this.stars.dispose();
    this.streaks.dispose();
    this.post.dispose();
  }
}

// Reused scratch vector for the aspect check (no per-frame allocation).
const _tmpSize = new THREE.Vector2();
