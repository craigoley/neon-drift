/**
 * FINISH LINE (MP-1 PR3-pt2). A bright neon banner across the road at the race's
 * finish distance. Three.js layer — RENDER-ONLY. It's positioned off the SHARED finish
 * distance relative to the local car's distance (same z-mapping as traffic/rival), so
 * both peers see it at the same place. It carries no game state and never affects the
 * sim (the actual finish is decided deterministically in MpRace).
 */

import * as THREE from 'three';
import { FINISH_LINE_VIS, PALETTE, ROAD } from '../utils/constants';

export class FinishLine {
  private readonly group = new THREE.Group();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];

  constructor(scene: THREE.Scene) {
    const F = FINISH_LINE_VIS;
    const width = ROAD.halfWidth * 2 + F.roadExtension;
    const barGeo = new THREE.BoxGeometry(width, F.barHeight, F.barDepth);
    const barMat = new THREE.MeshBasicMaterial({ color: PALETTE.magenta, transparent: true, opacity: F.barOpacity, fog: true });
    const bar = new THREE.Mesh(barGeo, barMat);
    bar.position.y = F.barY;
    bar.frustumCulled = false;
    this.group.add(bar);
    this.geos.push(barGeo);
    this.mats.push(barMat);

    for (const side of [-1, 1]) {
      const pyGeo = new THREE.BoxGeometry(F.pylonWidth, F.pylonHeight, F.pylonWidth);
      pyGeo.translate(0, F.pylonHeight / 2, 0);
      const pyMat = new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: F.pylonOpacity, fog: true });
      const py = new THREE.Mesh(pyGeo, pyMat);
      py.position.x = side * (ROAD.halfWidth + 1);
      py.frustumCulled = false;
      this.group.add(py);
      this.geos.push(pyGeo);
      this.mats.push(pyMat);
    }

    this.group.visible = false;
    scene.add(this.group);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /** Place the line at `finishDistance`, given the local car's `playerDistance`.
   *  z is camera-relative (ahead = negative), matching the other renderers. */
  sync(finishDistance: number, playerDistance: number): void {
    this.group.position.z = -(finishDistance - playerDistance);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
