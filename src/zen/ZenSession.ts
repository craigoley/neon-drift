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
import { ZEN, ZEN_SECRET, type CarDef } from '../utils/constants';
import { createZenVehicle, updateZen, updateVertical } from './ZenVehicle';
import { heightAt } from './ZenHeight';
import { queryDrivableSurface, surfaceSlopeAlong } from './ZenLandmarkSurface';
import {
  snapshot,
  restore,
  arrivalPose,
  findReturnPortal,
  crossedAnyGateway,
  type VehicleSnapshot,
} from './ZenSecret';
import type { Landmark } from './ZenLandmarkModel';
import { ZenRenderer } from './ZenRenderer';
import { ZenMinimap } from './ZenMinimap';

export interface ZenSessionOptions {
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

  /** Throttle held state (keyboard + touch). throttle = forward − back ∈ {-1,0,1}. */
  private fwd = false;
  private back = false;

  private readonly onKey: (e: KeyboardEvent) => void;

  constructor(opts: ZenSessionOptions) {
    this.opts = opts;
    // Start resting ON the terrain so the car doesn't visibly rise from y=0 at spawn.
    this.v.y = heightAt(ZEN.worldSeed, this.v.x, this.v.z) + ZEN.rideHeight;
    this.renderer = new ZenRenderer(opts.renderer, opts.car);
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
    this.minimap = new ZenMinimap(this.overlay);

    // Secret-area warp: the full-screen fade overlay (appended LAST → on top of all overlay UI),
    // and the fixed secret region's return portal (deterministic — computed once).
    this.fader = document.createElement('div');
    this.fader.className = 'zen-fader';
    this.fader.style.cssText =
      `position:absolute;inset:0;background:${ZEN_SECRET.fadeColor};opacity:0;pointer-events:none;`;
    this.overlay.appendChild(this.fader);
    this.returnPortal = findReturnPortal(ZEN.worldSeed);
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
    if (this.warpPhase !== 'none') {
      // WARPING: the car is frozen; just run the fade machine (the teleport fires at the opaque
      // midpoint). Render with no steer so the camera doesn't bank under the fade.
      this.advanceWarp(dt);
      this.renderer.render(this.v, 0, dt);
      this.minimap.update(this.v.x, this.v.z, this.v.heading, dt);
      return;
    }

    const throttle = (this.fwd ? 1 : 0) - (this.back ? 1 : 0);
    // The DRIVABLE-surface slope (vista mesa / tunnel floor override where one applies, else the
    // terrain). Computed every frame so the LANDING catch-up (updateVertical) can ride up a rising
    // far-side at its own rate; the gentle SPEED nudge stays GROUNDED-only (no terrain grip in air).
    const slope = surfaceSlopeAlong(ZEN.worldSeed, this.v.x, this.v.z, Math.sin(this.v.heading), -Math.cos(this.v.heading));
    updateZen(this.v, steer, throttle, dt, this.v.airborne ? 0 : slope);
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
    const surface = queryDrivableSurface(ZEN.worldSeed, this.v.x, this.v.z);
    updateVertical(this.v, surface.y + ZEN.rideHeight, slope, dt, !surface.onSurface);

    // BOUNCE GUARD: after a warp, re-arm crossings only once we've travelled clear of the portal
    // we arrived at, so holding gas can't instantly re-cross it (the diagnosed instant-bounce).
    if (this.guardActive) {
      const gdx = this.v.x - this.guardX;
      const gdz = this.v.z - this.guardZ;
      if (gdx * gdx + gdz * gdz >= ZEN_SECRET.returnGuardDistance * ZEN_SECRET.returnGuardDistance) {
        this.guardActive = false;
      }
    }
    // PORTAL TRIGGER: crossing a gateway's opening starts the warp (into / out of the secret area).
    if (!this.guardActive && crossedAnyGateway(ZEN.worldSeed, this.prevX, this.prevZ, this.v.x, this.v.z)) {
      this.warpPhase = 'out';
      this.warpT = 0;
      this.v.speed = 0; // freeze the coast during the fade
    }
    this.prevX = this.v.x;
    this.prevZ = this.v.z;

    this.renderer.render(this.v, steer, dt);
    // Live radar: me-centered, rotates with heading (throttled biome/ramp resample inside).
    this.minimap.update(this.v.x, this.v.z, this.v.heading, dt);
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
    if (!this.inSecret) {
      this.saved = snapshot(this.v);
      const pose = arrivalPose(this.returnPortal);
      this.v.x = pose.x;
      this.v.z = pose.z;
      this.v.heading = pose.heading;
      this.v.speed = 0;
      this.v.vy = 0;
      this.v.airborne = false;
      this.v.y = heightAt(ZEN.worldSeed, this.v.x, this.v.z) + ZEN.rideHeight;
      this.inSecret = true;
      this.renderer.setSecret(true);
    } else {
      if (this.saved) restore(this.v, this.saved);
      this.inSecret = false;
      this.renderer.setSecret(false);
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
