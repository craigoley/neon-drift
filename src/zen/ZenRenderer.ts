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
import { ZEN, type CarDef } from '../utils/constants';
import { clamp, smoothFollow } from '../utils/math';
import { CarMesh } from '../rendering/CarMesh';
import { zenFraming } from './ZenCamera';
import { ZenScenery } from './ZenScenery';
import { ZenTerrain } from './ZenTerrain';
import { ZenBackdrop } from './ZenBackdrop';
import { ZenShadow } from './ZenShadow';
import { ZenStarfield } from './ZenStarfield';
import { ZenBiomeView } from './ZenBiomeView';
import { biomeAt, createZenBiomeState } from './ZenBiome';
import { ZenLandmarks } from './ZenLandmarks';
import { drivableSurfaceY, surfaceSlopeAlong } from './ZenLandmarkSurface';
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
  private readonly shadow: ZenShadow;
  private readonly stars: ZenStarfield;
  private readonly biomeView: ZenBiomeView;
  /** Reused biome-state scratch sampled at the car each frame (no per-frame alloc). */
  private readonly biomeState = createZenBiomeState();
  private aspect = 0;
  /** Eased "boom" heading — the camera swings behind the car's facing as it TURNS, so
   *  turns glide rather than snap. Decoupled from forward motion (no speed lag). */
  private boomHeading = 0;
  /** Eased speed factor (0..1) driving the gentle distance/FOV swing; smoothed so brief
   *  throttle changes don't pump the framing. */
  private speedFactor = 0;
  /** Eased look-at target height — tracks the car's Y at the SAME rate as position.y, so the
   *  rig moves as one smooth unit. Easing this (vs aiming at the raw v.y) absorbs any v.y
   *  discontinuity (e.g. a landing settle) instead of whipping the whole view. */
  private lookY = ZEN.camLookAtHeight;

  constructor(renderer: THREE.WebGLRenderer, car?: CarDef) {
    this.renderer = renderer;
    // Fog tinted to the HORIZON colour so the grid floor fades into the sunset horizon
    // (not a flat purple band) — the backdrop's sky gradient ends in the same colour, so
    // floor and sky meet seamlessly. The backdrop sets scene.background (the sky gradient).
    this.scene.fog = new THREE.FogExp2(ZEN.horizonColor, ZEN.fogDensity);

    this.camera = new THREE.PerspectiveCamera(ZEN.camFov, 1, ZEN.camNear, ZEN.camFar);
    this.camera.position.set(0, ZEN.camHeight, ZEN.camDistance);

    // Serene sunset horizon (sky + sun + mountain ring) — kills the void, works 360°.
    this.backdrop = new ZenBackdrop(this.scene, ZEN.worldSeed);

    // The neon synthwave grid is now a HEIGHTMAP surface (rolling hills), streamed +
    // recentred on the car. Seams perfectly because heights come from world coords.
    this.terrain = new ZenTerrain(this.scene, ZEN.worldSeed);

    // Chunk-streamed scenery (the populated world the car drives through), on the terrain.
    this.scenery = new ZenScenery(this.scene);

    // Rare neon LANDMARKS — beacons you spot from afar + journey to (streamed + reach pulses).
    this.landmarks = new ZenLandmarks(this.scene, ZEN.worldSeed);

    // Terrain-anchored air-shadow: a gap opens between car + shadow when airborne.
    this.shadow = new ZenShadow(this.scene);

    // Biome REGIONS: a 360° star dome + the apply that pushes the blended biome palette
    // (fog/sky/sun/mountains/stars/prop-tint) from the biome under the car each frame.
    this.stars = new ZenStarfield(this.scene, ZEN.worldSeed);
    this.biomeView = new ZenBiomeView(this.scene, this.backdrop, this.stars, this.scenery);

    this.car = new CarMesh(car);
    // YXZ so the slope PITCH (rotation.x) is applied about the already-yawed lateral
    // axis — nose tips up/down along the facing, not in world space.
    this.car.group.rotation.order = 'YXZ';
    this.scene.add(this.car.group);

    this.resize();
  }

  /** Quality lever — LOW (retro FX off) swaps scenery to the plain pillars (perf). */
  setQuality(high: boolean): void {
    this.scenery.setNeon(high);
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

  /**
   * Mirror the pure Zen vehicle onto the scene + ease the chase camera, then draw.
   * `steer` drives a gentle visual bank; `dt` paces the camera smoothing.
   */
  render(v: ZenVehicle, steer: number, dt: number): void {
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
      const slope = surfaceSlopeAlong(ZEN.worldSeed, v.x, v.z, Math.sin(v.heading), -Math.cos(v.heading));
      this.car.group.rotation.x = clamp(Math.atan(slope) * ZEN.terrainTiltFactor, -ZEN.terrainTiltMax, ZEN.terrainTiltMax);
    }
    this.car.chassis.rotation.z = -clamp(steer, -1, 1) * ZEN.leanMax;

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
    // star dome centred on the car.
    biomeAt(ZEN.worldSeed, v.x, v.z, this.biomeState);
    this.biomeView.apply(this.biomeState);
    this.stars.update(v.x, v.z);
    // Air-shadow: pin a glow spot to the terrain under the car. Airborne, the car rises but
    // the shadow stays on the ground → a visible gap (the readable "in the air" cue).
    const groundY = drivableSurfaceY(ZEN.worldSeed, v.x, v.z) + ZEN.rideHeight;
    this.shadow.update(v.x, groundY, v.z, v.y - groundY);

    // Chase camera — MOSTLY STEADY with only a whisper of speed reactivity (calm, not
    // adrenaline). Two decoupled parts:
    //   (1) TURN-GLIDE: ease a "boom" heading toward the car's facing, so the camera
    //       swings behind as you turn (gliding, not snapping). Forward motion adds NO
    //       distance lag here — the old fixed-target follow trailed further the faster
    //       you went (an uncontrolled speed swing); easing the heading instead keeps the
    //       resting distance steady at any cruise speed.
    //   (2) SPEED FEEL: a small, eased distance pull-back + subtle FOV widen from speed
    //       (the explicit zenFraming curve), so cruising still reads as motion.
    const f = smoothFollow(ZEN.camPosLerp, dt);
    this.boomHeading += (v.heading - this.boomHeading) * f;

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

    this.resize(); // cheap aspect check (updates only on a real size change)
    this.renderer.render(this.scene, this.camera);
  }

  /** Keep the camera aspect in sync with the (shared) renderer's drawing buffer. */
  private resize(): void {
    const size = this.renderer.getSize(_tmpSize);
    const a = size.x / Math.max(1, size.y);
    if (a !== this.aspect) {
      this.aspect = a;
      this.camera.aspect = a;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Free the Zen-owned geometry/materials (the shared renderer is NOT disposed). */
  dispose(): void {
    this.scene.remove(this.car.group);
    this.car.dispose();
    this.backdrop.dispose();
    this.shadow.dispose();
    this.terrain.dispose();
    this.scenery.dispose();
    this.landmarks.dispose();
    this.stars.dispose();
  }
}

// Reused scratch vector for the aspect check (no per-frame allocation).
const _tmpSize = new THREE.Vector2();
