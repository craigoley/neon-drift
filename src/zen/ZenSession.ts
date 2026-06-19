/**
 * ZEN FREE-ROAM session (PR1) — the controller that ties the pure movement model
 * (ZenVehicle) to the parallel renderer (ZenRenderer) and owns the Zen-only input
 * (a THROTTLE; steering is reused from the shared Controls) + a minimal overlay
 * (EXIT, and on touch a GAS/BRAKE pair). Lazy-loaded from the composition root so
 * none of the Zen code ships in the racing bundle.
 *
 * The composition root drives `tick(steer, dt)` each frame INSTEAD of the forward sim
 * while a session is alive (see main.ts). Nothing here imports src/game/.
 */

import type { WebGLRenderer } from 'three';
import { ZEN, ZEN_SECRET, ZEN_TUNNEL_SECRET, ZEN_LANDMARK, ZEN_SLIDE, ZEN_ARCH, ZEN_RING, type CarDef } from '../utils/constants';
import { clamp, wrapToPi } from '../utils/math';
import { createZenVehicle, updateZen, updateVertical } from './ZenVehicle';
import { heightAt } from './ZenHeight';
import { queryDrivableSurface, surfaceSlopeAlong, vistaDeckUnder } from './ZenLandmarkSurface';
import { ZenSlidePath } from './ZenSlidePath';
import { boostIntensity, boostedMaxSpeed } from './ZenArchBoost';
import { randomWarpDestination } from './ZenRingWarp';
import {
  snapshot,
  restore,
  arrivalPose,
  findReturnPortal,
  crossedAnyGateway,
  type VehicleSnapshot,
} from './ZenSecret';
import { crossedAnyOfType, LANDMARK_ARCH, LANDMARK_RING, type Landmark } from './ZenLandmarkModel';
import { coveringTunnel, passedDeepPoint, tunnelReturnPortal } from './ZenTunnelPayoff';
import { ZenRenderer } from './ZenRenderer';
import { ZenMinimap } from './ZenMinimap';
import { biomeAt, createZenBiomeState } from './ZenBiome';

/** Read-only Zen state snapshot for the validation sweep (no setters, no behaviour). */
export interface ZenDebugSnapshot {
  /** This Zen session's world seed (random per entry, or the pinned ?seed=) — the world fingerprint. */
  seed: number;
  pos: { x: number; y: number; z: number };
  cam: { x: number; y: number; z: number };
  heading: number;
  speed: number;
  airborne: boolean;
  warpPhase: 'none' | 'out' | 'in';
  inSecret: boolean;
  /** True while inside the tunnel bottom-payoff space (Stage 4) — distinct from inSecret. */
  inTunnelSpace: boolean;
  hasSaved: boolean;
  onSlide: boolean;
  slideU: number;
  /** True while the car is on a VISTA/TUNNEL drivable-surface override (vs plain terrain) — the
   *  tunnel-smoothness canary asserts this doesn't toggle mid-tunnel (diagnosis #148). */
  onSurface: boolean;
  /** The camera's orbit angle (boomHeading) — the slide-spin canary asserts its per-frame Δ is bounded. */
  camHeading: number;
  biome: { from: number; to: number; blend: number };
  counts: { props: number; terrainVerts: number; landmarks: number; sceneChildren: number };
}

export interface ZenSessionOptions {
  /** The world seed for THIS Zen session — the ENTIRE world (biomes, terrain, landmarks, props, portals)
   *  keys off it. The composition root passes a FRESH RANDOM seed per entry (a new world to explore each
   *  time), or the pinned `?seed=` value for deterministic tests / the OG capture. */
  seed: number;
  /** The game's shared WebGLRenderer (Zen draws with it; never disposes it). */
  renderer: WebGLRenderer;
  /** The player's selected car (driven in Zen, cosmetics and all). */
  car: CarDef;
  /** Equipped GLOW cosmetic colour (or null) — purely visual. */
  glow: number | null;
  /** Where to mount the EXIT / touch-throttle overlay. */
  parent: HTMLElement;
  isTouch: boolean;
  /** Persisted LOW-quality (retro FX off) setting — swaps scenery to plain pillars. */
  lowFx: boolean;
  /** Leave Zen → the composition root disposes the session + returns to the menu. */
  onExit: () => void;
}

const OVERLAY =
  'position:fixed;inset:0;z-index:9990;pointer-events:none;font-family:system-ui,sans-serif;';
const BTN =
  'pointer-events:auto;font:inherit;font-weight:700;border:2px solid #00ffff;background:rgba(26,0,51,0.55);color:#00ffff;border-radius:10px;cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:none;';

export class ZenSession {
  private readonly v = createZenVehicle();
  /** This session's world seed (random per entry, or the pinned ?seed=). The whole Zen world keys off it. */
  private readonly seed: number;
  private readonly renderer: ZenRenderer;
  private readonly overlay: HTMLElement;
  private readonly minimap: ZenMinimap;
  private readonly opts: ZenSessionOptions;

  // --- SECRET-AREA warp (PR1 slice): cross a gateway → fade → teleport to a far secret region →
  //     fade back; cross a gateway in the secret region → fade → restore your exact prior spot. ---
  /** Full-screen fade overlay (the whiteout that hides the teleport + one-frame chunk reload). */
  private readonly fader: HTMLElement;
  /** The fixed secret region's arrival + RETURN portal (the gateway nearest the far coord). */
  private readonly returnPortal: Landmark;
  /** Previous car position, for the gateway plane-crossing trigger. */
  private prevX = 0;
  private prevZ = 0;
  /** Warp state machine: none = driving; out = fading to opaque; in = fading back after teleport. */
  private warpPhase: 'none' | 'out' | 'in' = 'none';
  private warpT = 0;
  /** True while in the secret area (forces the secret palette + flips the return behaviour). */
  private inSecret = false;
  /** The main-world position saved on entry, restored on return. */
  private saved: VehicleSnapshot | null = null;
  /** Bounce guard: after a warp, gateway crossings are ignored until the car has travelled
   *  returnGuardDistance from where it arrived (so you can't instantly re-cross the portal). */
  private guardX = 0;
  private guardZ = 0;
  private guardActive = false;
  /** Which warp this is: 'secret' (gateway → save/restore the secret region), 'random' (a RING random
   *  main-world hop, no save), or 'tunnel' (the deep-point payoff → a distinct tunnel space, return
   *  near the entrance). Set on the trigger; read at the teleport midpoint. */
  private warpKind: 'secret' | 'random' | 'tunnel' = 'secret';
  /** The RING random-warp destination, computed on the trigger, applied at the teleport midpoint. */
  private pendingDest: { x: number; z: number; heading: number } | null = null;
  /** The active bounce-guard radius — the secret return-guard, or the RING guard for a random hop. */
  private guardDist: number = ZEN_SECRET.returnGuardDistance;

  // --- TUNNEL BOTTOM-PAYOFF (Stage 4 slice): descend a tunnel to its DEEP POINT → warp to a distinct
  //     tunnel-themed space → a return portal there brings you back NEAR THE ENTRANCE (re-runnable).
  //     Reuses the warp/fade/save-restore machinery above; the trigger detection is pure (ZenTunnelPayoff). ---
  /** True while inside the tunnel payoff space (forces the amber palette + flips the gateway to "return"). */
  private inTunnelSpace = false;
  /** The tunnel-payoff region's arrival + return portal (the gateway nearest its far coord — computed once). */
  private readonly tunnelPortal: Landmark;
  /** The car's pose snapshot taken when it ENTERED the current tunnel — the return target (near the
   *  entrance, not the deep point). Saved into `saved` at the trigger so RETURN restores it. */
  private tunnelEntry: VehicleSnapshot | null = null;
  /** Last frame's signed along-position inside the covering tunnel (null = not in a tunnel) — for the
   *  deep-point sign-flip detection. */
  private tunnelPrevAlong: number | null = null;
  /** The tunnel id already triggered this descent (debounce: one payoff per run; cleared on leaving
   *  the tunnel footprint or returning). */
  private tunnelTriggeredId: number | null = null;

  // --- VISTA SKY-SLIDE: drive onto a vista deck → catapult up an absolute-Y path that twists +
  //     descends → land back near the vista. A GUIDED ride (the path owns position) — crest physics
  //     + normal steering are suspended while onSlide (see tick). ---
  /** True while riding the slide (the tick early-returns into stepSlide). */
  private onSlide = false;
  /** Last frame's drivable-surface flag (on a vista mesa / tunnel floor vs plain terrain) — mirrored
   *  into __neonDebug so the validation sweep can assert it doesn't toggle mid-tunnel. */
  private lastOnSurface = false;
  /** The active slide's pure path (null off the slide). */
  private slide: ZenSlidePath | null = null;
  /** Progress along the path ∈ [0, 1]; advanced by speed each frame. */
  private slideU = 0;
  /** Lateral offset from the path centreline (steering nudges within the tube; eases back to 0). */
  private slideLat = 0;
  /** Re-entrancy guard after a landing (mirrors the warp bounce-guard): no re-launch until driven
   *  guardDistance clear of the landing point, so landing near the vista can't instantly re-fire. */
  private slideGuardX = 0;
  private slideGuardZ = 0;
  private slideGuardActive = false;

  /** ARCH speed-boost: seconds of boost remaining (0 = cruise). Counts down each frame; crossing an
   *  arch refreshes it. The eased speed cap + the streak visual both derive from it (ZenArchBoost). */
  private boostT = 0;

  /** Throttle held state (keyboard + touch). throttle = forward − back ∈ {-1,0,1}. */
  private fwd = false;
  private back = false;

  /** Reused scratch for the debug-snapshot biome sample (no per-call alloc). */
  private readonly _dbgBiome = createZenBiomeState();

  private readonly onKey: (e: KeyboardEvent) => void;

  constructor(opts: ZenSessionOptions) {
    this.opts = opts;
    this.seed = opts.seed; // set FIRST — the whole world (and everything below) keys off it
    // Start resting ON the terrain so the car doesn't visibly rise from y=0 at spawn.
    this.v.y = heightAt(this.seed, this.v.x, this.v.z) + ZEN.rideHeight;
    this.renderer = new ZenRenderer(opts.renderer, this.seed, opts.car);
    this.renderer.setGlow(opts.glow);
    this.renderer.setQuality(!opts.lowFx); // honour the persisted quality setting

    // --- overlay: EXIT + (touch) GAS/BRAKE + a one-line hint ---
    this.overlay = document.createElement('div');
    this.overlay.className = 'zen-overlay';
    this.overlay.style.cssText = OVERLAY;

    const exit = document.createElement('button');
    exit.className = 'zen-exit';
    exit.textContent = 'EXIT';
    exit.style.cssText = `${BTN};position:absolute;top:12px;left:12px;padding:8px 16px;`;
    exit.addEventListener('click', () => this.opts.onExit());
    this.overlay.appendChild(exit);

    const hint = document.createElement('p');
    hint.style.cssText =
      'position:absolute;top:14px;left:50%;transform:translateX(-50%);margin:0;color:#e9d5ff;opacity:0.7;font-size:13px;text-align:center;';
    hint.textContent = opts.isTouch
      ? 'drag to steer · hold GAS to cruise'
      : '← → / A D to steer · ↑ ↓ to accelerate · drift around';
    this.overlay.appendChild(hint);

    if (opts.isTouch) {
      this.overlay.appendChild(this.makeHoldButton('GAS', 'right:14px', (h) => (this.fwd = h)));
      this.overlay.appendChild(this.makeHoldButton('BRAKE', 'left:14px', (h) => (this.back = h)));
    }

    // Live navigation radar in the top-right corner (the other corners hold EXIT + GAS/BRAKE).
    this.minimap = new ZenMinimap(this.overlay, this.seed);

    // Secret-area warp: the full-screen fade overlay (appended LAST → on top of all overlay UI),
    // and the fixed secret region's return portal (deterministic — computed once).
    this.fader = document.createElement('div');
    this.fader.className = 'zen-fader';
    this.fader.style.cssText =
      `position:absolute;inset:0;background:${ZEN_SECRET.fadeColor};opacity:0;pointer-events:none;`;
    this.overlay.appendChild(this.fader);
    this.returnPortal = findReturnPortal(this.seed);
    this.tunnelPortal = tunnelReturnPortal(this.seed);
    this.prevX = this.v.x;
    this.prevZ = this.v.z;

    opts.parent.appendChild(this.overlay);

    // Keyboard throttle (steering stays on the shared Controls: arrows / A-D / drag).
    this.onKey = (e: KeyboardEvent) => {
      const down = e.type === 'keydown';
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') this.fwd = down;
      else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') this.back = down;
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
  }

  /** Advance one frame: drive the movement model with the shared `steer` + the Zen
   *  throttle, then render. Called by the composition root in place of the forward sim. */
  tick(steer: number, dt: number): void {
    // ARCH boost decays every frame; drive the streak visual from its eased intensity in EVERY path
    // (it should fade out cleanly even through a warp/slide). The boosted speed cap is applied in the
    // normal-driving branch below (the only branch updateZen runs in).
    this.boostT = Math.max(0, this.boostT - dt);
    this.renderer.setBoost(boostIntensity(this.boostT));

    if (this.warpPhase !== 'none') {
      // WARPING: the car is frozen; just run the fade machine (the teleport fires at the opaque
      // midpoint). Render with no steer so the camera doesn't bank under the fade.
      this.advanceWarp(dt);
      this.renderer.render(this.v, 0, dt);
      this.minimap.update(this.v.x, this.v.z, this.v.heading, dt);
      return;
    }

    if (this.onSlide) {
      // ON THE SKY-SLIDE: the path owns the car's position — crest physics + free steering are
      // suspended (this branch never runs updateZen/updateVertical). stepSlide renders itself.
      this.stepSlide(steer, dt);
      return;
    }

    const throttle = (this.fwd ? 1 : 0) - (this.back ? 1 : 0);
    // The DRIVABLE-surface slope (vista mesa / tunnel floor override where one applies, else the
    // terrain). Computed every frame so the LANDING catch-up (updateVertical) can ride up a rising
    // far-side at its own rate; the gentle SPEED nudge stays GROUNDED-only (no terrain grip in air).
    const slope = surfaceSlopeAlong(this.seed, this.v.x, this.v.z, Math.sin(this.v.heading), -Math.cos(this.v.heading));
    // The speed cap is RAISED while an ARCH boost is active (eased back to cruise as it decays).
    updateZen(this.v, steer, throttle, dt, this.v.airborne ? 0 : slope, boostedMaxSpeed(this.boostT));
    // Props are SOLID — but only while GROUNDED: airborne, the car flies OVER them. Push
    // the car back out of any prop circle it entered (slides around — no hard stop).
    if (!this.v.airborne) {
      const solved = this.renderer.resolve(this.v.x, this.v.z);
      this.v.x = solved.x;
      this.v.z = solved.z;
    }
    // Vertical: ride the DRIVABLE surface (raised vista / lowered tunnel floor, or the terrain),
    // catch air off sharp crests, land smoothly. On a landmark surface, SUPPRESS crest-detach
    // (allowAir=false) so the car flows ONTO the mesa / DOWN the tunnel without crest-jumping; the
    // override blends to terrain at the rim so the entry/exit eases (no snap).
    // Combined query: one coveringSurface scan for both Y + on-surface (not two).
    const surface = queryDrivableSurface(this.seed, this.v.x, this.v.z);
    this.lastOnSurface = surface.onSurface; // for __neonDebug (the tunnel-smoothness canary)
    updateVertical(this.v, surface.y + ZEN.rideHeight, slope, dt, !surface.onSurface);

    // SKY-SLIDE TRIGGER: driving onto a vista DECK auto-catapults the car up the slide (every vista
    // launches). Gated by the slide guard so landing near a vista can't instantly re-fire. Disarm
    // the guard once we've driven clear of the landing point (same pattern as the warp bounce-guard).
    if (this.slideGuardActive) {
      const sdx = this.v.x - this.slideGuardX;
      const sdz = this.v.z - this.slideGuardZ;
      if (sdx * sdx + sdz * sdz >= ZEN_SLIDE.guardDistance * ZEN_SLIDE.guardDistance) {
        this.slideGuardActive = false;
      }
    } else {
      const vista = vistaDeckUnder(this.seed, this.v.x, this.v.z);
      if (vista) this.startSlide(vista);
    }

    // BOUNCE GUARD: after a warp, re-arm crossings only once we've travelled clear of the portal
    // we arrived at, so holding gas can't instantly re-cross it (the diagnosed instant-bounce).
    if (this.guardActive) {
      const gdx = this.v.x - this.guardX;
      const gdz = this.v.z - this.guardZ;
      if (gdx * gdx + gdz * gdz >= this.guardDist * this.guardDist) {
        this.guardActive = false;
      }
    }
    // TUNNEL BOTTOM-PAYOFF TRIGGER (#158): you DESCEND a real downward tunnel, and at the DEEP POINT
    // (along = 0) a WARP fires ONCE into the hidden amber cave — the cave is a SEGREGATED warp space
    // (the C1 drive-down basin/seam was reverted: making the cave physically continuous DISSOLVED it).
    // Record the ENTRANCE on first entering the tube — the return target (warp out lands AT the entrance,
    // facing OUT; see doTeleport). Debounced per descent + behind the bounce guard. (Pure: ZenTunnelPayoff.)
    if (!this.inSecret && !this.inTunnelSpace) {
      const cover = coveringTunnel(this.seed, this.v.x, this.v.z);
      if (cover) {
        if (this.tunnelPrevAlong === null) {
          this.tunnelEntry = snapshot(this.v); // just entered the tube → remember the entrance
          this.tunnelTriggeredId = null;
        }
        if (
          this.warpPhase === 'none' &&
          !this.guardActive &&
          this.tunnelTriggeredId !== cover.tunnel.id &&
          passedDeepPoint(this.tunnelPrevAlong, cover.along)
        ) {
          this.tunnelTriggeredId = cover.tunnel.id;
          this.startTunnelPayoff();
        }
        this.tunnelPrevAlong = cover.along;
      } else {
        this.tunnelPrevAlong = null; // left the tube → re-arm for the next descent
      }
    }
    // PORTAL TRIGGER: crossing a GATEWAY's opening starts a warp. In the tunnel-payoff space it's the
    // RETURN (back near the entrance); elsewhere it's the secret-area enter/leave.
    if (this.warpPhase === 'none' && !this.guardActive && crossedAnyGateway(this.seed, this.prevX, this.prevZ, this.v.x, this.v.z)) {
      this.warpKind = this.inTunnelSpace ? 'tunnel' : 'secret';
      this.warpPhase = 'out';
      this.warpT = 0;
      this.v.speed = 0; // freeze the coast during the fade
    }
    // ARCH = SPEED BOOST: crossing an arch's opening grants a free, refreshable surge (no guard — a
    // boost is harmless to re-trigger; crossedOpening already fires once per pass). An instant kick +
    // a timer that raises the cap then eases it back to cruise (ZenArchBoost).
    if (crossedAnyOfType(this.seed, LANDMARK_ARCH, this.prevX, this.prevZ, this.v.x, this.v.z)) {
      this.boostT = ZEN_ARCH.boostSeconds;
      this.v.speed = Math.max(this.v.speed, ZEN_ARCH.boostMaxSpeed * ZEN_ARCH.boostKickFrac);
    }
    // RING = RANDOM WARP: crossing a ring blinks you somewhere new. Main-world only (not inSecret),
    // guarded against an instant re-warp, and skipped if a gateway warp already fired this frame.
    if (
      this.warpPhase === 'none' &&
      !this.guardActive &&
      !this.inSecret &&
      !this.inTunnelSpace &&
      crossedAnyOfType(this.seed, LANDMARK_RING, this.prevX, this.prevZ, this.v.x, this.v.z)
    ) {
      this.startRandomWarp();
    }
    this.prevX = this.v.x;
    this.prevZ = this.v.z;

    this.renderer.render(this.v, steer, dt);
    // Live radar: me-centered, rotates with heading (throttled biome/ramp resample inside).
    this.minimap.update(this.v.x, this.v.z, this.v.heading, dt);
  }

  /** READ-ONLY live snapshot for the validation sweep (window.__neonDebug.zen). No setters, no
   *  behaviour — mirrors the vehicle + warp/secret machine + the biome under the car + the render
   *  counts, so the soak can assert finiteness, bounded growth, and transition (de)sync. */
  debugSnapshot(): ZenDebugSnapshot {
    const info = this.renderer.debugInfo;
    biomeAt(this.seed, this.v.x, this.v.z, this._dbgBiome);
    return {
      seed: this.seed,
      pos: { x: this.v.x, y: this.v.y, z: this.v.z },
      cam: info.cam,
      camHeading: info.camHeading,
      heading: this.v.heading,
      speed: this.v.speed,
      airborne: this.v.airborne,
      warpPhase: this.warpPhase,
      inSecret: this.inSecret,
      inTunnelSpace: this.inTunnelSpace,
      hasSaved: this.saved !== null,
      onSlide: this.onSlide,
      slideU: this.slideU,
      onSurface: this.lastOnSurface,
      biome: { from: this._dbgBiome.from, to: this._dbgBiome.to, blend: this._dbgBiome.blend },
      counts: info.counts,
    };
  }

  /** CATAPULT: build the absolute-Y slide path anchored at the vista deck, launching in the
   *  direction the car drove on, and enter the on-slide state (the tube mesh appears). */
  private startSlide(vista: Landmark): void {
    const deckY = heightAt(this.seed, vista.x, vista.z) + ZEN_LANDMARK.vistaHeight * vista.scale + ZEN.rideHeight;
    this.slide = new ZenSlidePath({ x: vista.x, y: deckY, z: vista.z }, this.v.heading);
    this.slideU = 0;
    this.slideLat = 0;
    this.v.speed = Math.max(this.v.speed, ZEN_SLIDE.launchSpeed); // the catapult imparts launch speed
    this.onSlide = true;
    this.renderer.showSlide(this.slide);
  }

  /** THE RIDE: advance along the path by speed (gas/brake modulate within a band), set the car's
   *  pose from the path + a clamped lateral steer nudge, and render. At u≥1, deposit the car near
   *  the ground and hand back to normal driving (the #118 soft landing eases the residual gap). */
  private stepSlide(steer: number, dt: number): void {
    const path = this.slide!;
    const throttle = (this.fwd ? 1 : 0) - (this.back ? 1 : 0);
    this.v.speed = clamp(this.v.speed + throttle * ZEN_SLIDE.rideAccel * dt, ZEN_SLIDE.rideMinSpeed, ZEN_SLIDE.rideMaxSpeed);
    const prevY = this.v.y;
    this.slideU += (this.v.speed / path.length) * dt;

    // Lateral steer nudge within the tube (eases back to centre when you let go) — you can't fall off.
    const maxLat = ZEN_SLIDE.tubeHalfWidth - ZEN_SLIDE.tubeMargin;
    this.slideLat += clamp(steer, -1, 1) * ZEN_SLIDE.steerNudge * dt;
    if (Math.abs(steer) < ZEN_SLIDE.steerDeadZone) this.slideLat -= this.slideLat * Math.min(1, ZEN_SLIDE.steerReturn * dt);
    this.slideLat = clamp(this.slideLat, -maxLat, maxLat);

    const done = this.slideU >= 1;
    if (done) this.slideU = 1;
    const p = path.pointAt(this.slideU);
    const t = path.tangentAt(this.slideU);
    // Right axis = the horizontal perpendicular of the tangent — where the lateral nudge applies.
    let sx = t.z;
    let sz = -t.x;
    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl;
    sz /= sl;
    this.v.x = p.x + sx * this.slideLat;
    this.v.z = p.z + sz * this.slideLat;
    this.v.y = p.y;
    this.v.heading = Math.atan2(t.x, -t.z); // path tangent → facing (forward = sin h, −cos h)
    // Drive the renderer's airborne nose-pitch from the path's vertical velocity (visual only — the
    // ride isn't physically integrated). Leaving airborne=true at the end lets updateVertical land it.
    this.v.vy = (this.v.y - prevY) / Math.max(dt, 1e-4);
    this.v.airborne = true;
    this.prevX = this.v.x;
    this.prevZ = this.v.z;

    if (done) this.endSlide();

    this.renderer.render(this.v, steer, dt);
    this.minimap.update(this.v.x, this.v.z, this.v.heading, dt);
  }

  /** End the ride: drop the tube, leave the on-slide state, and arm the re-launch guard from the
   *  landing point. The car keeps airborne=true + its descent vy, so the next normal tick's
   *  updateVertical eases it onto the real terrain (the #118 soft landing — no snap). */
  private endSlide(): void {
    this.renderer.hideSlide();
    this.slide = null;
    this.onSlide = false;
    this.v.vy = Math.min(this.v.vy, 0); // ensure a downward (or zero) settle, never an upward kick
    this.slideGuardX = this.v.x;
    this.slideGuardZ = this.v.z;
    this.slideGuardActive = true;
  }

  /** RING random warp: pick a random destination + start the fade (reusing the secret machinery,
   *  minus save/restore). The teleport fires at the opaque midpoint (doTeleport's 'random' branch). */
  private startRandomWarp(): void {
    this.pendingDest = randomWarpDestination(this.v.x, this.v.z);
    this.warpKind = 'random';
    this.warpPhase = 'out';
    this.warpT = 0;
    this.v.speed = 0; // freeze the coast during the fade
  }

  /** TUNNEL PAYOFF: start the fade to warp into the tunnel bottom space (the deep-point trigger fired).
   *  The teleport (save the entrance + jump to the tunnel region) happens at the opaque midpoint. */
  private startTunnelPayoff(): void {
    this.warpKind = 'tunnel';
    this.warpPhase = 'out';
    this.warpT = 0;
    this.v.speed = 0; // freeze the coast during the fade
  }

  /** Advance the warp fade; at the opaque midpoint, do the teleport (hidden by the fade). */
  private advanceWarp(dt: number): void {
    this.warpT += dt;
    if (this.warpPhase === 'out') {
      this.fader.style.opacity = String(Math.min(1, this.warpT / ZEN_SECRET.fadeOutSeconds));
      if (this.warpT >= ZEN_SECRET.fadeOutSeconds) {
        this.doTeleport();
        this.warpPhase = 'in';
        this.warpT = 0;
      }
    } else {
      this.fader.style.opacity = String(Math.max(0, 1 - this.warpT / ZEN_SECRET.fadeInSeconds));
      if (this.warpT >= ZEN_SECRET.fadeInSeconds) {
        this.fader.style.opacity = '0';
        this.warpPhase = 'none';
      }
    }
  }

  /** The teleport itself (at the opaque fade midpoint): ENTER saves state + warps to the secret
   *  region in front of its return portal; RETURN restores the exact saved spot. Snaps the camera
   *  and resets the crossing tracker so the teleport jump doesn't false-trigger another warp. */
  private doTeleport(): void {
    if (this.warpKind === 'random' && this.pendingDest) {
      // RING random hop: NOT inSecret, NO save/restore — just blink to the random spot on valid
      // terrain, facing the travel direction (#130 safe-arrival), and use the ring's bounce guard.
      const d = this.pendingDest;
      this.v.x = d.x;
      this.v.z = d.z;
      this.v.heading = d.heading;
      this.v.speed = 0;
      this.v.vy = 0;
      this.v.airborne = false;
      this.v.y = heightAt(this.seed, d.x, d.z) + ZEN.rideHeight;
      this.pendingDest = null;
      this.guardDist = ZEN_RING.guardDistance;
    } else if (this.warpKind === 'tunnel') {
      // TUNNEL PAYOFF: ENTER saves the ENTRANCE (the return target — NOT the deep point) + warps to
      // the distinct tunnel space in front of its portal; RETURN restores that entrance, safe-arrival.
      if (!this.inTunnelSpace) {
        this.saved = this.tunnelEntry ?? snapshot(this.v);
        const pose = arrivalPose(this.tunnelPortal);
        this.v.x = pose.x;
        this.v.z = pose.z;
        this.v.heading = pose.heading;
        this.v.speed = 0;
        this.v.vy = 0;
        this.v.airborne = false;
        this.v.y = heightAt(this.seed, this.v.x, this.v.z) + ZEN.rideHeight;
        this.inTunnelSpace = true;
        this.renderer.setTunnelSecret(true);
        this.guardDist = ZEN_TUNNEL_SECRET.returnGuardDistance;
      } else {
        // EXIT: warp back to the tunnel ENTRANCE position, FACING OUT — heading REVERSED from the
        // descent (you drove in; now you face the way you came = out of the mouth), so the loop reads as
        // "I came back up and out", ready to drive away (re-runnable). #130 safe-arrival (vy = 0, not
        // airborne, sane land) + the bounce guard (no instant re-descent of the mouth you just exited).
        if (this.saved) {
          this.v.x = this.saved.x;
          this.v.z = this.saved.z;
          this.v.heading = wrapToPi(this.saved.heading + Math.PI); // face OUT, away from the tunnel
        }
        this.v.speed = 0;
        this.v.vy = 0;
        this.v.airborne = false;
        this.v.y = heightAt(this.seed, this.v.x, this.v.z) + ZEN.rideHeight;
        this.inTunnelSpace = false;
        this.renderer.setTunnelSecret(false);
        this.guardDist = ZEN_TUNNEL_SECRET.returnGuardDistance;
        // Re-arm the descent detector so a fresh run can re-trigger (after the bounce guard clears).
        this.tunnelPrevAlong = null;
        this.tunnelTriggeredId = null;
      }
    } else if (!this.inSecret) {
      this.saved = snapshot(this.v);
      const pose = arrivalPose(this.returnPortal);
      this.v.x = pose.x;
      this.v.z = pose.z;
      this.v.heading = pose.heading;
      this.v.speed = 0;
      this.v.vy = 0;
      this.v.airborne = false;
      this.v.y = heightAt(this.seed, this.v.x, this.v.z) + ZEN.rideHeight;
      this.inSecret = true;
      this.renderer.setSecret(true);
      this.guardDist = ZEN_SECRET.returnGuardDistance;
    } else {
      if (this.saved) restore(this.v, this.saved);
      this.inSecret = false;
      this.renderer.setSecret(false);
      this.guardDist = ZEN_SECRET.returnGuardDistance;
    }
    this.renderer.snapCamera(this.v);
    this.prevX = this.v.x;
    this.prevZ = this.v.z;
    // Arm the bounce guard from the arrival point — crossings re-enable only after driving clear.
    this.guardX = this.v.x;
    this.guardZ = this.v.z;
    this.guardActive = true;
  }

  /** Tear down: listeners, overlay, and the Zen-owned scene objects. */
  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.minimap.dispose();
    this.overlay.remove();
    this.renderer.dispose();
  }

  /** A hold-to-act touch button (GAS / BRAKE): held while pressed, released on lift. */
  private makeHoldButton(label: string, side: string, set: (held: boolean) => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `${BTN};position:absolute;bottom:24px;${side};padding:16px 22px;font-size:15px;`;
    const press = (held: boolean) => (e: Event) => {
      e.preventDefault();
      set(held);
    };
    b.addEventListener('touchstart', press(true), { passive: false });
    b.addEventListener('touchend', press(false));
    b.addEventListener('touchcancel', press(false));
    return b;
  }
}
