/**
 * Renders the road: the glowing centre line and lane dividers. Reads road
 * descriptors from the pure game layer and positions geometry accordingly.
 * Never mutates game state.
 */

import * as THREE from 'three';
import { laneCenters } from '../game/Road';
import { PALETTE, ROAD } from '../utils/constants';

export class RoadRenderer {
  readonly group = new THREE.Group();
  private readonly length = ROAD.segmentLength * ROAD.visibleSegments;

  constructor(scene: THREE.Scene) {
    // Glowing magenta centre line running into the distance.
    this.group.add(this.makeLine(0, PALETTE.magenta));

    // Cyan lane dividers either side, dimmer than the centre line.
    for (const x of laneCenters()) {
      if (x === 0) continue;
      this.group.add(this.makeLine(x, PALETTE.cyan));
    }

    scene.add(this.group);
  }

  private makeLine(x: number, color: number): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0, ROAD.segmentLength),
      new THREE.Vector3(x, 0, -this.length),
    ]);
    const material = new THREE.LineBasicMaterial({ color });
    return new THREE.Line(geometry, material);
  }

  /**
   * Scroll the road to match travelled distance. The geometry repeats every
   * segment, so we only need the fractional offset within one segment.
   */
  sync(distance: number): void {
    this.group.position.z = distance % ROAD.segmentLength;
  }
}
