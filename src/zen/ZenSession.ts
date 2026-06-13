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
import { ZEN, type CarDef } from '../utils/constants';
import { createZenVehicle, updateZen, updateVertical } from './ZenVehicle';
import { heightAt, slopeAlong } from './ZenHeight';
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
    const throttle = (this.fwd ? 1 : 0) - (this.back ? 1 : 0);
    // Slope drives the gentle speed nudge — GROUNDED only (no terrain grip in the air).
    const slope = this.v.airborne
      ? 0
      : slopeAlong(ZEN.worldSeed, this.v.x, this.v.z, Math.sin(this.v.heading), -Math.cos(this.v.heading));
    updateZen(this.v, steer, throttle, dt, slope);
    // Props are SOLID — but only while GROUNDED: airborne, the car flies OVER them. Push
    // the car back out of any prop circle it entered (slides around — no hard stop).
    if (!this.v.airborne) {
      const solved = this.renderer.resolve(this.v.x, this.v.z);
      this.v.x = solved.x;
      this.v.z = solved.z;
    }
    // Vertical: ride the surface, catch air off sharp crests, land smoothly (air-time).
    const groundY = heightAt(ZEN.worldSeed, this.v.x, this.v.z) + ZEN.rideHeight;
    updateVertical(this.v, groundY, slope, dt);
    this.renderer.render(this.v, steer, dt);
    // Live radar: me-centered, rotates with heading (throttled biome/ramp resample inside).
    this.minimap.update(this.v.x, this.v.z, this.v.heading, dt);
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
