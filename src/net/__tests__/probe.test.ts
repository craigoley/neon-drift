/**
 * Determinism probe (MP-1 PR1) — the PURE, unit-testable part. The over-the-wire
 * cross-engine comparison can't be unit-tested headlessly, but the probe itself
 * (its sim run + the checksum compare) is pure and verifiable here. This also
 * confirms the probe is deterministic V8↔V8 (the cross-engine V8↔JSC check is the
 * manual device test).
 */
import { describe, expect, it } from 'vitest';
import { compareProbe, probeChecksum } from '../probe';
import { NET } from '../../utils/constants';

describe('determinism probe', () => {
  it('is deterministic — the same seed yields an identical checksum', () => {
    const a = probeChecksum(NET.probeSeed, 600);
    const b = probeChecksum(NET.probeSeed, 600);
    expect(a).toEqual(b);
    expect(a.rngState).toBe(b.rngState);
    expect(a.frames).toBe(600);
  });

  it('advanced the RNG (a real run, not a no-op) and stays finite', () => {
    const c = probeChecksum(NET.probeSeed, 600);
    expect(c.rngState).not.toBe(NET.probeSeed >>> 0); // spawns drew from the rng
    expect(Number.isFinite(c.distance)).toBe(true);
    expect(Number.isFinite(c.lateral)).toBe(true);
  });

  it('compareProbe accepts identical checksums', () => {
    const a = probeChecksum(NET.probeSeed, 400);
    const b = probeChecksum(NET.probeSeed, 400);
    const v = compareProbe(a, b);
    expect(v.ok).toBe(true);
  });

  it('compareProbe flags an RNG-state desync exactly', () => {
    const a = probeChecksum(NET.probeSeed, 400);
    const v = compareProbe(a, { ...a, rngState: a.rngState + 1 });
    expect(v.ok).toBe(false);
    expect(v.detail).toContain('RNG desync');
  });

  it('compareProbe flags a float divergence beyond epsilon', () => {
    const a = probeChecksum(NET.probeSeed, 400);
    const v = compareProbe(a, { ...a, distance: a.distance + NET.probeEpsilon * 100 });
    expect(v.ok).toBe(false);
    expect(v.detail).toContain('distance');
  });

  it('compareProbe flags a frame-count mismatch', () => {
    const a = probeChecksum(NET.probeSeed, 400);
    const b = probeChecksum(NET.probeSeed, 300);
    expect(compareProbe(a, b).ok).toBe(false);
  });
});
