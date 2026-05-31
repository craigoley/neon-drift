/**
 * Renders the recycled road-segment pool. One reusable "tile" group is built per
 * pool slot (glowing edge rails + centre lane stripes) using shared geometries;
 * each frame the tiles are repositioned from the pure RoadState. No geometry is
 * allocated per frame. Reads game state; never mutates it.
 */

import * as THREE from 'three';
import type { RoadState } from '../game/Road';
import { poolSize } from '../game/Road';
import { ROAD, ROAD_VIS, PALETTE } from '../utils/constants';

export class RoadRenderer {
  private readonly group = new THREE.Group();
  private readonly tiles: THREE.Group[] = [];

  // Shared geometries + materials (created once, reused by every tile).
  private readonly edgeGeo: THREE.BoxGeometry;
  private readonly stripeGeo: THREE.BoxGeometry;
  private readonly edgeMat: THREE.MeshBasicMaterial;
  private readonly stripeMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.edgeGeo = new THREE.BoxGeometry(ROAD_VIS.edgeHalfWidth * 2, ROAD_VIS.edgeHeight, ROAD.segmentLength);
    this.stripeGeo = new THREE.BoxGeometry(ROAD_VIS.stripeHalfWidth * 2, ROAD_VIS.edgeHeight, ROAD_VIS.stripeLength);
    this.edgeMat = new THREE.MeshBasicMaterial({ color: PALETTE.magenta });
    // Centre stripes share the road's magenta rather than cyan: that reserves
    // cyan for the player car alone, so the three element classes read at a
    // glance — you (cyan) / road (magenta) / threat (accent orange).
    this.stripeMat = new THREE.MeshBasicMaterial({ color: PALETTE.magenta });

    for (let i = 0; i < poolSize(); i++) {
      this.tiles.push(this.makeTile());
    }
    this.tiles.forEach((t) => this.group.add(t));
    scene.add(this.group);
  }

  private makeTile(): THREE.Group {
    const tile = new THREE.Group();

    const left = new THREE.Mesh(this.edgeGeo, this.edgeMat);
    left.position.x = -ROAD.halfWidth;
    const right = new THREE.Mesh(this.edgeGeo, this.edgeMat);
    right.position.x = ROAD.halfWidth;
    tile.add(left, right);

    // Evenly spaced centre stripes along the segment.
    const spacing = ROAD.segmentLength / ROAD_VIS.stripesPerSegment;
    for (let s = 0; s < ROAD_VIS.stripesPerSegment; s++) {
      const stripe = new THREE.Mesh(this.stripeGeo, this.stripeMat);
      stripe.position.z = -ROAD.segmentLength / 2 + spacing * (s + 0.5);
      tile.add(stripe);
    }
    return tile;
  }

  /** Map each pool segment onto its tile. The car is at z = 0; ahead is -z. */
  sync(road: RoadState, distance: number): void {
    const segments = road.segments;
    for (let i = 0; i < this.tiles.length; i++) {
      const seg = segments[i];
      const tile = this.tiles[i];
      // Near edge world-z, then shift back by half a segment to centre the tile.
      const nearZ = -(seg.start - distance);
      tile.position.set(seg.curve, 0, nearZ - ROAD.segmentLength / 2);
    }
  }
}
