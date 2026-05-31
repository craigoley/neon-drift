/**
 * Procedural synthwave backdrop: an infinite scrolling ground grid, a banded
 * horizon sun, and low-poly wireframe mountains. No external assets. Reads only
 * the player distance + camera position; never mutates game state.
 *
 * The sun and mountains use `fog: false` so they stay crisp on the horizon while
 * the grid fades into the exponential fog (hiding the road's spawn horizon).
 */

import * as THREE from 'three';
import { CSS_PALETTE, ENV, GRID, PALETTE } from '../utils/constants';
import { hashNoise } from '../utils/rng';

export class Environment {
  readonly group = new THREE.Group();
  private readonly grid: THREE.GridHelper;
  private readonly backdrop = new THREE.Group();
  private readonly cellSize: number;

  constructor(scene: THREE.Scene, seed: number) {
    this.cellSize = GRID.size / GRID.divisions;

    this.grid = new THREE.GridHelper(GRID.size, GRID.divisions, PALETTE.magenta, PALETTE.cyan);
    this.grid.position.y = GRID.y;
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = GRID.opacity;
    this.group.add(this.grid);

    this.backdrop.add(this.makeSun());
    this.backdrop.add(this.makeMountains(seed));
    this.group.add(this.backdrop);

    scene.add(this.group);
  }

  /** Banded gradient sun built from a CanvasTexture (magenta -> accent). */
  private makeSun(): THREE.Mesh {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, CSS_PALETTE.magentaLight);
    grad.addColorStop(0.5, CSS_PALETTE.magenta);
    grad.addColorStop(1, CSS_PALETTE.accent);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();

    // Carve horizontal bands out of the lower half (classic synthwave sun).
    ctx.globalCompositeOperation = 'destination-out';
    const bandStart = size * 0.5;
    const bandStep = (size - bandStart) / ENV.sunBands;
    for (let i = 0; i < ENV.sunBands; i++) {
      const y = bandStart + i * bandStep;
      const h = (bandStep * (i + 1)) / (ENV.sunBands + 1);
      ctx.fillRect(0, y, size, h);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    // Pure background layer: no depth interaction + negative render order so all
    // gameplay geometry (road, car, traffic) always draws on top of it.
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      fog: false,
      depthWrite: false,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(ENV.sunRadius * 2, ENV.sunRadius * 2), mat);
    mesh.position.y = ENV.sunY;
    mesh.renderOrder = ENV.sunRenderOrder;
    return mesh;
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
  update(distance: number, cameraX: number, cameraZ: number): void {
    this.grid.position.x = cameraX;
    // Wrap by one cell so the grid appears to stream infinitely.
    this.grid.position.z = distance % this.cellSize;
    this.backdrop.position.set(cameraX, 0, cameraZ - ENV.distance);
  }
}
