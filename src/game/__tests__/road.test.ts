import { describe, expect, it } from 'vitest';
import { activeSegmentCount, createRoadState, poolSize, roadCenterAt, updateRoad } from '../Road';
import { ROAD } from '../../utils/constants';

describe('Road — seeded reproducibility', () => {
  it('reproduces the same road for the same seed', () => {
    const a = createRoadState(12345);
    const b = createRoadState(12345);
    // Drive both the same distance and compare the resulting segment curves.
    const distance = ROAD.segmentLength * 50;
    updateRoad(a, distance);
    updateRoad(b, distance);
    const curvesA = [...a.segments].sort((s, t) => s.index - t.index).map((s) => s.curve);
    const curvesB = [...b.segments].sort((s, t) => s.index - t.index).map((s) => s.curve);
    expect(curvesA).toEqual(curvesB);
  });

  it('produces a different road for a different seed', () => {
    const a = createRoadState(1);
    const b = createRoadState(2);
    const curvesA = a.segments.map((s) => s.curve);
    const curvesB = b.segments.map((s) => s.curve);
    expect(curvesA).not.toEqual(curvesB);
  });

  it('is order-independent: same seed, same curve per index regardless of path', () => {
    const a = createRoadState(777);
    const b = createRoadState(777);
    updateRoad(a, ROAD.segmentLength * 10);
    updateRoad(a, ROAD.segmentLength * 200); // a took a big jump
    for (let d = 0; d <= 200; d += 5) updateRoad(b, ROAD.segmentLength * d); // b stepped
    const byIndex = (s: { index: number; curve: number }[]) =>
      new Map(s.map((seg) => [seg.index, seg.curve]));
    const mapA = byIndex(a.segments);
    const mapB = byIndex(b.segments);
    expect(mapA).toEqual(mapB);
  });
});

describe('Road — curve centre (gameplay corridor)', () => {
  it('is deterministic per seed and stays within the curve amplitude', () => {
    for (let d = 0; d <= 20000; d += 137) {
      const a = roadCenterAt(4242, d);
      expect(roadCenterAt(4242, d)).toBe(a); // pure / repeatable
      expect(Math.abs(a)).toBeLessThanOrEqual(ROAD.curveAmplitude + 1e-9);
    }
  });

  it('matches the per-segment curve at integer segment boundaries', () => {
    const seed = 31337;
    const road = createRoadState(seed);
    // The continuous centre at a segment's start equals that segment's curve.
    for (const seg of road.segments) {
      expect(roadCenterAt(seed, seg.index * ROAD.segmentLength)).toBeCloseTo(seg.curve, 6);
    }
  });

  it('actually bends (not a flat zero line)', () => {
    let maxAbs = 0;
    for (let d = 0; d <= 20000; d += 50) maxAbs = Math.max(maxAbs, Math.abs(roadCenterAt(99, d)));
    expect(maxAbs).toBeGreaterThan(ROAD.curveAmplitude * 0.5);
  });
});

describe('Road — pool stays bounded', () => {
  it('never grows beyond poolSize() no matter how far the player drives', () => {
    const road = createRoadState(42);
    expect(activeSegmentCount(road)).toBe(poolSize());
    for (let d = 0; d <= 100000; d += ROAD.segmentLength) {
      updateRoad(road, d);
      expect(road.segments.length).toBe(poolSize());
    }
    expect(activeSegmentCount(road)).toBe(poolSize());
    // Many recycles happened, but the pool array length is unchanged.
    expect(road.recycled).toBeGreaterThan(1000);
  });

  it('keeps segment indices contiguous and unique (window invariant)', () => {
    const road = createRoadState(9);
    updateRoad(road, ROAD.segmentLength * 500);
    const indices = road.segments.map((s) => s.index).sort((x, y) => x - y);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBe(indices[i - 1] + 1);
    }
    expect(new Set(indices).size).toBe(indices.length);
  });
});
