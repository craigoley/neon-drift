/**
 * Zen DISCOVERY — landmark frequency + the per-type radar compass. The encounter rate rose (mean
 * spacing dropped) but stays SPECIAL (bounded, not littered); the nearest-of-each-type query is the
 * EXACT nearest deterministic landmark of each type (the compass bearings rely on it). FEEL is a
 * phone playtest; these are the maths that must be right.
 */
import { describe, expect, it } from 'vitest';
import { landmarksInRadius, LANDMARK_TYPE_COUNT, type LandmarkType } from '../ZenLandmarkModel';
import { nearestOfEachType } from '../ZenMinimapModel';
import { ZEN } from '../../utils/constants';

const seed = ZEN.worldSeed;

describe('Zen landmark frequency — more often, still special', () => {
  it('mean spacing is in the findable-but-special band (denser than the old ~4700u, not littered)', () => {
    const R = 60000;
    const lms = landmarksInRadius(seed, 0, 0, R);
    const area = Math.PI * R * R;
    const meanSpacing = 1 / Math.sqrt(lms.length / area);
    expect(meanSpacing).toBeGreaterThan(2500); // floor: still rare-ish, a beacon not litter
    expect(meanSpacing).toBeLessThan(4300); // denser than the pre-bump ~4700u (find cool stuff more often)
  });

  it('every one of the five types still appears at a reasonable rate (none starved)', () => {
    const lms = landmarksInRadius(seed, 0, 0, 60000);
    const counts = new Array(LANDMARK_TYPE_COUNT).fill(0);
    for (const l of lms) counts[l.type]++;
    for (let t = 0; t < LANDMARK_TYPE_COUNT; t++) {
      expect(counts[t], `type ${t} present`).toBeGreaterThan(0);
    }
    // Vista is the rarest (weight 1) but must not be a freak — at least a handful in this big area.
    expect(counts[3]).toBeGreaterThan(5);
    // The common drive-throughs (ring/arch, weight 3) clearly outnumber the rare vista.
    expect(counts[0]).toBeGreaterThan(counts[3]);
    expect(counts[1]).toBeGreaterThan(counts[3]);
  });
});

describe('Zen per-type compass — nearestOfEachType', () => {
  /** Brute-force nearest-of-each-type over a wide radius (the ground truth). */
  const bruteNearest = (carX: number, carZ: number) => {
    const all = landmarksInRadius(seed, carX, carZ, 90000);
    const best = new Array(LANDMARK_TYPE_COUNT).fill(null) as ({ x: number; z: number; d2: number } | null)[];
    for (const lm of all) {
      const d2 = (lm.x - carX) ** 2 + (lm.z - carZ) ** 2;
      const cur = best[lm.type];
      if (!cur || d2 < cur.d2) best[lm.type] = { x: lm.x, z: lm.z, d2 };
    }
    return best;
  };

  for (const [carX, carZ] of [
    [0, 0],
    [1234, -5678],
    [40000, 40000],
    [-9000, 21000],
  ] as const) {
    it(`returns the EXACT nearest of each type from (${carX}, ${carZ})`, () => {
      const near = nearestOfEachType(seed, carX, carZ);
      const brute = bruteNearest(carX, carZ);

      // Every type that exists in range is returned, matching the brute-force nearest exactly.
      for (let t = 0; t < LANDMARK_TYPE_COUNT; t++) {
        const got = near.find((n) => n.type === (t as LandmarkType));
        const exp = brute[t];
        if (exp) {
          expect(got, `type ${t} returned`).toBeTruthy();
          expect(got!.x).toBeCloseTo(exp.x, 6);
          expect(got!.z).toBeCloseTo(exp.z, 6);
          expect(got!.dist).toBeCloseTo(Math.sqrt(exp.d2), 3);
        }
      }
      // With the denser field, all five types are found within the search cap from anywhere.
      expect(near.length).toBe(LANDMARK_TYPE_COUNT);
      // Each reported distance is the true straight-line distance to its landmark.
      for (const n of near) {
        expect(n.dist).toBeCloseTo(Math.hypot(n.x - carX, n.z - carZ), 6);
        expect(n.dist).toBeGreaterThan(0);
      }
    });
  }
});
