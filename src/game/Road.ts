/**
 * Road segment generation. PURE math — produces the list of road segments that
 * should currently exist given how far the player has travelled. The rendering
 * layer maps these descriptors onto geometry; it never feeds back into here.
 */

import { ROAD } from '../utils/constants';

export interface RoadSegment {
  /** Stable index of this segment from the start of the run. */
  index: number;
  /** World-space Z of the segment's near edge (negative = ahead of player). */
  z: number;
}

/**
 * Compute the window of visible segments for a given travelled distance. The
 * player sits at z = 0 looking toward -Z, so segments stream toward the camera
 * as distance grows.
 */
export function visibleSegments(distance: number): RoadSegment[] {
  const firstIndex = Math.floor(distance / ROAD.segmentLength);
  const segments: RoadSegment[] = [];
  for (let i = 0; i < ROAD.visibleSegments; i++) {
    const index = firstIndex + i;
    segments.push({
      index,
      z: -(index * ROAD.segmentLength - distance),
    });
  }
  return segments;
}

/** The world-space X coordinates of each lane centre. */
export function laneCenters(): number[] {
  const laneWidth = ROAD.width / ROAD.laneCount;
  const centers: number[] = [];
  for (let lane = 0; lane < ROAD.laneCount; lane++) {
    centers.push((lane - (ROAD.laneCount - 1) / 2) * laneWidth);
  }
  return centers;
}
