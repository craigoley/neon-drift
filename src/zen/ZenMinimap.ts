/**
 * ZEN MINIMAP — the corner RADAR overlay (a 2D canvas, NOT 3D). Small, calm, always-on; it
 * shows the biome regions around the car as a coloured wash + ramp markers, ME-CENTERED and
 * ROTATING with heading (the car points UP, the world spins as you turn). The infinite
 * procedural world has no stored map, so it's LIVE-SAMPLED: the heavy biome grid + ramp scan
 * are THROTTLED (every ZEN_MINIMAP.resampleInterval frames — regions are ~2800u, they barely
 * move), while the cheap ROTATION + marker projection run every frame so turning stays smooth.
 *
 * Pure logic (the projection + sampling) lives in ZenMinimapModel; this is the thin renderer.
 */

import { ZEN, ZEN_MINIMAP, cssHex } from '../utils/constants';
import { smoothFollow } from '../utils/math';
import {
  projectToRadar,
  biomeRadarColor,
  gatherMarkers,
  radarScale,
  type MinimapMarker,
} from './ZenMinimapModel';
import { createZenBiomeState } from './ZenBiome';

export class ZenMinimap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Offscreen biome-region wash (N×N world-aligned samples), redrawn on resample only. */
  private readonly wash: HTMLCanvasElement;
  private readonly washCtx: CanvasRenderingContext2D;
  private readonly dpr: number;
  private readonly size: number;
  private readonly radius: number; // pixel radius of the scope
  private readonly scale: number; // world units → radar pixels

  /** Cached markers (world positions) from the last resample. */
  private markers: MinimapMarker[] = [];
  /** Reused biome-state scratch for the wash sampling (no per-sample allocation). */
  private readonly biomeScratch = createZenBiomeState();
  /** Smoothed heading the radar rotates by (so a quick steer doesn't jitter the map). */
  private smoothedHeading = 0;
  private framesSinceResample = Number.MAX_SAFE_INTEGER; // force a resample on the first frame
  private initialised = false;

  constructor(parent: HTMLElement) {
    this.dpr = Math.min(2, Math.max(1, Math.round(globalThis.devicePixelRatio || 1)));
    this.size = ZEN_MINIMAP.sizePx;
    this.radius = this.size / 2 - ZEN_MINIMAP.ringWidth;
    this.scale = radarScale(this.radius);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'zen-minimap';
    this.canvas.width = this.size * this.dpr;
    this.canvas.height = this.size * this.dpr;
    this.canvas.style.cssText =
      `position:absolute;top:${ZEN_MINIMAP.margin}px;right:${ZEN_MINIMAP.margin}px;` +
      `width:${this.size}px;height:${this.size}px;opacity:${ZEN_MINIMAP.opacity};` +
      `pointer-events:none;`;
    this.ctx = this.canvas.getContext('2d')!;

    const n = ZEN_MINIMAP.gridSamples;
    this.wash = document.createElement('canvas');
    this.wash.width = n;
    this.wash.height = n;
    this.washCtx = this.wash.getContext('2d')!;

    parent.appendChild(this.canvas);
  }

  /** Advance the radar one frame. `dt` paces the heading smoothing; the biome grid + ramp set
   *  are resampled only every resampleInterval frames (cheap rotation runs every frame). */
  update(carX: number, carZ: number, heading: number, dt: number): void {
    // Smooth the rotation toward the car heading (snap on the very first frame so it doesn't
    // sweep in from 0). heading accumulates continuously in ZenVehicle (no wrap), so a plain
    // ease is safe.
    if (!this.initialised) {
      this.smoothedHeading = heading;
      this.initialised = true;
    } else {
      this.smoothedHeading += (heading - this.smoothedHeading) * smoothFollow(ZEN_MINIMAP.headingLerp, dt);
    }

    if (this.framesSinceResample >= ZEN_MINIMAP.resampleInterval) {
      this.resample(carX, carZ);
      this.framesSinceResample = 0;
    } else {
      this.framesSinceResample++;
    }

    this.draw(carX, carZ);
  }

  /** Re-render the biome wash + re-find ramp markers around the car (the throttled, heavier
   *  half). Live-sampled from biomeAt / ramp cells — the infinite world has no stored map. */
  private resample(carX: number, carZ: number): void {
    const n = ZEN_MINIMAP.gridSamples;
    const R = ZEN_MINIMAP.worldRadius;
    const img = this.washCtx.createImageData(n, n);
    const data = img.data;
    for (let j = 0; j < n; j++) {
      // +j → +z (south). World dz spans [-R, R] across the grid.
      const dz = ((j + 0.5) / n * 2 - 1) * R;
      for (let i = 0; i < n; i++) {
        const dx = ((i + 0.5) / n * 2 - 1) * R;
        const color = biomeRadarColor(ZEN.worldSeed, carX + dx, carZ + dz, this.biomeScratch);
        const o = (j * n + i) * 4;
        data[o] = (color >> 16) & 0xff;
        data[o + 1] = (color >> 8) & 0xff;
        data[o + 2] = color & 0xff;
        data[o + 3] = 255;
      }
    }
    this.washCtx.putImageData(img, 0, 0);
    this.markers = gatherMarkers(ZEN.worldSeed, carX, carZ, R);
  }

  /** Redraw the scope: rotated biome wash, markers, north tick, ring, and the centred car. */
  private draw(carX: number, carZ: number): void {
    const ctx = this.ctx;
    const c = this.size / 2;
    const R = this.radius;
    // Work in CSS px (DPR baked into the transform); reset + clear each frame.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);

    ctx.save();
    // Circular scope clip.
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.clip();

    // Backdrop (deep purple behind the wash — fills the corners the wash circle leaves).
    ctx.fillStyle = cssHex(ZEN_MINIMAP.backdropColor);
    ctx.fillRect(0, 0, this.size, this.size);

    // Biome wash, rotated so the car's forward points UP (rotate by -heading is exactly the
    // projectToRadar rotation — see ZenMinimapModel). Smoothing softens the wash regions.
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(-this.smoothedHeading);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.wash, -R, -R, R * 2, R * 2);
    ctx.restore();

    // Markers (ramps first; extensible): project each world position into the radar frame.
    for (const m of this.markers) {
      const off = projectToRadar(m.x - carX, m.z - carZ, this.smoothedHeading);
      this.drawRamp(c + off.x * this.scale, c + off.y * this.scale);
    }
    ctx.restore(); // drop the circular clip

    // North tick on the ring (world -z), so you can read your facing vs the fixed world.
    const north = projectToRadar(0, -1, this.smoothedHeading); // unit dir, already normalised
    ctx.strokeStyle = cssHex(ZEN_MINIMAP.northColor);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c + north.x * (R - ZEN_MINIMAP.northTickPx), c + north.y * (R - ZEN_MINIMAP.northTickPx));
    ctx.lineTo(c + north.x * R, c + north.y * R);
    ctx.stroke();

    // Neon scope ring.
    ctx.strokeStyle = cssHex(ZEN_MINIMAP.ringColor);
    ctx.lineWidth = ZEN_MINIMAP.ringWidth;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.stroke();

    // Car marker — a triangle at the centre, always pointing UP.
    const s = ZEN_MINIMAP.carSizePx;
    ctx.fillStyle = cssHex(ZEN_MINIMAP.carColor);
    ctx.beginPath();
    ctx.moveTo(c, c - s);
    ctx.lineTo(c - s * 0.7, c + s * 0.8);
    ctx.lineTo(c + s * 0.7, c + s * 0.8);
    ctx.closePath();
    ctx.fill();
  }

  /** A ramp marker: a small magenta-pink diamond (matches the in-world ramp-dune tint). */
  private drawRamp(px: number, py: number): void {
    const ctx = this.ctx;
    const r = ZEN_MINIMAP.rampMarkerPx;
    ctx.fillStyle = cssHex(ZEN_MINIMAP.rampColor);
    ctx.strokeStyle = cssHex(ZEN_MINIMAP.backdropColor);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py - r);
    ctx.lineTo(px + r, py);
    ctx.lineTo(px, py + r);
    ctx.lineTo(px - r, py);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  dispose(): void {
    this.canvas.remove();
  }
}
