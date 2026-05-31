/**
 * Procedural synthwave backdrop: an infinite scrolling ground grid, a banded
 * horizon sun, and low-poly wireframe mountains. No external assets. Reads only
 * the player distance + camera position; never mutates game state.
 *
 * The sun and mountains use `fog: false` so they stay crisp on the horizon while
 * the grid fades into the exponential fog (hiding the road's spawn horizon).
 */

import * as THREE from 'three';
import { ENV, GRID, PALETTE, SUN } from '../utils/constants';
import { hashNoise } from '../utils/rng';

export class Environment {
  readonly group = new THREE.Group();
  private readonly grid: THREE.GridHelper;
  private readonly backdrop = new THREE.Group();
  private readonly cellSize: number;

  // Sun canvas state, kept for the optional per-frame scanline drift (Phase 3).
  private readonly sunCtx: CanvasRenderingContext2D;
  private readonly sunTexture: THREE.CanvasTexture;
  private readonly sunGradient: CanvasGradient;
  private sunScroll = 0;

  constructor(scene: THREE.Scene, seed: number) {
    this.cellSize = GRID.size / GRID.divisions;

    this.grid = new THREE.GridHelper(GRID.size, GRID.divisions, PALETTE.magenta, PALETTE.cyan);
    this.grid.position.y = GRID.y;
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = GRID.opacity;
    this.group.add(this.grid);

    // Build the sun's canvas + texture up front so the optional scanline drift
    // can repaint it each frame. drawSun() does the actual painting.
    const canvas = document.createElement('canvas');
    canvas.width = SUN.textureSize;
    canvas.height = SUN.textureSize;
    this.sunCtx = canvas.getContext('2d')!;
    this.sunTexture = new THREE.CanvasTexture(canvas);
    this.sunTexture.colorSpace = THREE.SRGBColorSpace;
    const grad = this.sunCtx.createLinearGradient(0, 0, 0, SUN.textureSize);
    for (const stop of SUN.gradient) grad.addColorStop(stop.at, stop.color);
    this.sunGradient = grad;

    this.backdrop.add(this.makeSun());
    this.backdrop.add(this.makeMountains(seed));
    this.group.add(this.backdrop);

    scene.add(this.group);
  }

  /**
   * Retrosun mesh: a vertical gradient disc (warm top → deep-purple base) with
   * graduated horizontal scanline bands, painted into a CanvasTexture. The disc
   * is a pure background layer (no depth interaction + negative render order) so
   * all gameplay geometry always draws on top of it.
   */
  private makeSun(): THREE.Mesh {
    this.drawSun(0);
    const mat = new THREE.MeshBasicMaterial({
      map: this.sunTexture,
      transparent: true,
      fog: false,
      depthWrite: false,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SUN.radius * 2, SUN.radius * 2), mat);
    mesh.position.y = SUN.y;
    mesh.renderOrder = SUN.renderOrder;
    return mesh;
  }

  /**
   * Map a band index u to a canvas y coordinate. With curve > 1 the gaps widen
   * at the top and bunch toward the bottom.
   */
  private bandY(u: number): number {
    const size = SUN.textureSize;
    const yStart = size * SUN.bandStartFraction;
    const span = size - yStart;
    const q = Math.min(Math.max(u / SUN.bandCount, 0), 1);
    return yStart + (1 - Math.pow(1 - q, SUN.bandThinningCurve)) * span;
  }

  /**
   * Paint the gradient disc and carve its scanline bands at the given scroll
   * phase (0..1 of one band-spacing). Bands begin partway down the disc and
   * tighten toward the bottom via a power curve, so the lower edge reads as
   * dense scanlines meeting the horizon — the classic sunset look.
   */
  private drawSun(phase: number): void {
    const size = SUN.textureSize;
    const ctx = this.sunCtx;
    ctx.clearRect(0, 0, size, size);

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = this.sunGradient;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i <= SUN.bandCount; i++) {
      const u = i + phase;
      const y = this.bandY(u);
      const thickness = (this.bandY(u + 1) - y) * SUN.bandThicknessRatio;
      if (thickness <= SUN.bandMinThickness) continue;
      ctx.fillRect(0, y - thickness / 2, size, thickness);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Low-poly wireframe mountain silhouette across the horizon (seeded). */
  private makeMountains(seed: number): THREE.LineSegments {
    const positions: number[] = [];
    const step = ENV.mountainSpread / ENV.mountainCount;
    let prevX = -ENV.mountainSpread / 2;
    let prevY = ENV.mountainBaseY;
    for (let i = 1; i <= ENV.mountainCount; i++) {
      const x = -ENV.mountainSpread / 2 + i * step;
      const peak = (hashNoise(seed, i) * 0.5 + 0.5) * ENV.mountainMaxHeight;
      // Triangle: prev base -> peak, peak -> next base, as line segments.
      const midX = (prevX + x) / 2;
      positions.push(prevX, prevY, 0, midX, peak, 0);
      positions.push(midX, peak, 0, x, ENV.mountainBaseY, 0);
      prevX = x;
      prevY = ENV.mountainBaseY;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    // Background layer: drawn first (most-negative render order) with no depth
    // interaction, so the mountains sit behind the sun AND behind every gameplay
    // element — they can never overlap the car or traffic, only the far horizon.
    const mat = new THREE.LineBasicMaterial({
      color: PALETTE.cyan,
      fog: false,
      depthWrite: false,
      depthTest: false,
      // Faint so the waveform silhouette doesn't fight the sun's bands at the
      // horizon — it reads as a distant ridge, not a competing bright line.
      transparent: true,
      opacity: ENV.mountainOpacity,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.position.set(0, ENV.mountainBaseY, -ENV.distance * ENV.mountainDepthFactor);
    lines.renderOrder = ENV.mountainRenderOrder;
    return lines;
  }

  /** Scroll the grid toward the camera and keep the backdrop on the horizon. */
  update(distance: number, cameraX: number, cameraZ: number, dt: number): void {
    this.grid.position.x = cameraX;
    // Wrap by one cell so the grid appears to stream infinitely.
    this.grid.position.z = distance % this.cellSize;
    this.backdrop.position.set(cameraX, 0, cameraZ - ENV.distance);

    // Phase 3: drift the scanlines slowly downward. Only repaints (and re-uploads
    // the texture) when motion is enabled, so it costs nothing when disabled.
    if ((SUN.scrollSpeed as number) !== 0) {
      this.sunScroll = (this.sunScroll + SUN.scrollSpeed * dt) % 1;
      this.drawSun(this.sunScroll);
      this.sunTexture.needsUpdate = true;
    }
  }
}
