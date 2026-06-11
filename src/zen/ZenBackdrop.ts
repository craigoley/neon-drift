/**
 * ZEN FREE-ROAM backdrop — the serene SUNSET horizon that kills the "void". REUSES the
 * racing environment's recipes (rendering/Environment.ts): the canvas-gradient + carved-
 * scanline RETROSUN and the wireframe mountain silhouette, plus a vertical gradient sky.
 * Reimplemented here (not imported) and ADAPTED for the free-facing zen camera, which can
 * look ANY direction — so everything is 360°-correct:
 *   - SKY: a screen-space vertical gradient (scene.background) — skyTop → horizon. Always
 *     fills the upper screen, whichever way you face. Zero draw calls / overdraw.
 *   - SUN: a billboarded disc fixed in a WORLD compass direction, horizon-locked to the
 *     camera (you drive PAST it, it never follows your facing).
 *   - MOUNTAINS: a full RING around the camera (not a forward-only ridge), so the horizon
 *     has a silhouette in every direction.
 * No bloom (Zen has no post pass): the sun is a bright canvas texture and the grid floor
 * is bright cyan — both read as "glowing" WITHOUT bloom, keeping it phone-cheap.
 */

import * as THREE from 'three';
import { SUN, ZEN } from '../utils/constants';
import { hashNoise } from '../utils/rng';

const TAU = Math.PI * 2;
const hexStr = (n: number): string => '#' + (n >>> 0).toString(16).padStart(6, '0');

export class ZenBackdrop {
  /** Sun + mountains, horizon-locked to the camera POSITION (not its rotation). */
  private readonly group = new THREE.Group();
  private readonly sky: THREE.CanvasTexture;
  private readonly sunTex: THREE.CanvasTexture;
  private readonly sunMat: THREE.MeshBasicMaterial;
  private readonly sunGeo: THREE.PlaneGeometry;
  private readonly mtnGeo: THREE.BufferGeometry;
  private readonly mtnMat: THREE.LineBasicMaterial;

  constructor(scene: THREE.Scene, seed: number) {
    // Serene sunset sky — fills the void in every direction (screen-space gradient).
    this.sky = this.makeSky();
    scene.background = this.sky;

    // Retrosun, fixed in a world compass direction, on the horizon.
    this.sunTex = this.makeSunTexture();
    this.sunMat = new THREE.MeshBasicMaterial({
      map: this.sunTex,
      transparent: true,
      fog: false,
      depthWrite: false,
      depthTest: false, // pure background — never occludes the floor / props
    });
    this.sunGeo = new THREE.PlaneGeometry(ZEN.sunRadius * 2, ZEN.sunRadius * 2);
    const sun = new THREE.Mesh(this.sunGeo, this.sunMat);
    const dirX = Math.sin(ZEN.sunAzimuth);
    const dirZ = -Math.cos(ZEN.sunAzimuth);
    sun.position.set(dirX * ZEN.backdropDistance, ZEN.sunHeight, dirZ * ZEN.backdropDistance);
    sun.lookAt(0, ZEN.sunHeight, 0); // face the camera (which sits at the group origin)
    sun.renderOrder = -1;
    this.group.add(sun);

    // 360° wireframe mountain ring on the horizon.
    this.mtnGeo = this.makeMountainRing(seed);
    this.mtnMat = new THREE.LineBasicMaterial({
      color: ZEN.gridColor,
      transparent: true,
      opacity: ZEN.mountainOpacity,
      fog: false,
      depthWrite: false,
      depthTest: false,
    });
    const mtns = new THREE.LineSegments(this.mtnGeo, this.mtnMat);
    mtns.renderOrder = -2; // behind the sun
    this.group.add(mtns);

    this.group.renderOrder = -2;
    scene.add(this.group);
  }

  /** Horizon-lock the backdrop to the camera position so the sun/mountains stay on the
   *  far horizon as you drive (they barely parallax; they never follow your facing). */
  update(cameraX: number, cameraZ: number): void {
    this.group.position.set(cameraX, 0, cameraZ);
  }

  /** Vertical sky gradient: skyTop (top) → horizon (bottom). The fog fades the floor to
   *  the SAME horizon colour, so floor and sky meet seamlessly at the horizon line. */
  private makeSky(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, hexStr(ZEN.skyTopColor));
    g.addColorStop(1, hexStr(ZEN.horizonColor));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Retrosun texture — the racing recipe: a vertical gradient disc with scanline bands
   *  carved (destination-out) that thin + tighten toward the bottom (a sunset, not a
   *  striped disc). Painted ONCE (no scroll drift — calm + zero per-frame texture work). */
  private makeSunTexture(): THREE.CanvasTexture {
    const size = SUN.textureSize;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createLinearGradient(0, 0, 0, size);
    for (const s of SUN.gradient) grad.addColorStop(s.at, s.color);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, TAU);
    ctx.fill();

    const bandY = (u: number): number => {
      const yStart = size * SUN.bandStartFraction;
      const span = size - yStart;
      const q = Math.min(Math.max(u / SUN.bandCount, 0), 1);
      return yStart + (1 - Math.pow(1 - q, SUN.bandThinningCurve)) * span;
    };
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i <= SUN.bandCount; i++) {
      const y = bandY(i);
      const thickness = (bandY(i + 1) - y) * SUN.bandThicknessRatio;
      if (thickness <= SUN.bandMinThickness) continue;
      ctx.fillRect(0, y - thickness / 2, size, thickness);
    }
    ctx.globalCompositeOperation = 'source-over';

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** A ring of seeded wireframe peaks (base → peak → next base) around the camera. */
  private makeMountainRing(seed: number): THREE.BufferGeometry {
    const pos: number[] = [];
    const R = ZEN.mountainRingRadius;
    const n = ZEN.mountainRingPeaks;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * TAU;
      const a1 = ((k + 1) / n) * TAU;
      const am = (a0 + a1) / 2;
      const x0 = Math.cos(a0) * R, z0 = Math.sin(a0) * R;
      const x1 = Math.cos(a1) * R, z1 = Math.sin(a1) * R;
      const mx = Math.cos(am) * R, mz = Math.sin(am) * R;
      const h = (hashNoise(seed, k) * 0.5 + 0.5) * ZEN.mountainHeight;
      pos.push(x0, 0, z0, mx, h, mz);
      pos.push(mx, h, mz, x1, 0, z1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return geo;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.sky.dispose();
    this.sunTex.dispose();
    this.sunMat.dispose();
    this.sunGeo.dispose();
    this.mtnGeo.dispose();
    this.mtnMat.dispose();
  }
}
