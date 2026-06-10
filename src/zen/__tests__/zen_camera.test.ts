/**
 * Zen chase-camera FRAMING curve — the GENTLE speed→(distance, FOV) mapping. The FEEL is
 * a phone playtest, but the shape is unit-testable: a comfortable resting floor, a SMALL
 * monotonic pull-back capped at max speed, a SUBTLE FOV widen (never tighten), and a
 * total swing that stays well under the resting distance (mostly steady, not adrenaline).
 */
import { describe, expect, it } from 'vitest';
import { zenFraming } from '../ZenCamera';
import { ZEN } from '../../utils/constants';

describe('Zen camera framing — gentle, mostly-steady speed reactivity', () => {
  it('rests at the comfortable FLOOR at speed 0 (car does not loom)', () => {
    expect(zenFraming(0).distance).toBe(ZEN.camDistance);
    expect(zenFraming(0).fov).toBe(ZEN.camFov);
  });

  it('caps the CEILING at full speed to exactly the resting value + the swing knobs', () => {
    expect(zenFraming(1).distance).toBe(ZEN.camDistance + ZEN.camDistanceSpeedGain);
    expect(zenFraming(1).fov).toBe(ZEN.camFov + ZEN.camFovSpeedGain);
  });

  it('is MONOTONIC in speed (more speed → more distance, never less)', () => {
    const d0 = zenFraming(0).distance;
    const d5 = zenFraming(0.5).distance;
    const d1 = zenFraming(1).distance;
    expect(d5).toBeGreaterThan(d0);
    expect(d1).toBeGreaterThan(d5);
  });

  it('keeps the total rest→max swing SMALL (gentle, well under the resting distance)', () => {
    const swing = zenFraming(1).distance - zenFraming(0).distance;
    expect(swing).toBe(ZEN.camDistanceSpeedGain);
    expect(swing).toBeLessThan(ZEN.camDistance * 0.5); // a whisper, not the old ~2x swing
  });

  it('WIDENS the FOV with speed, never tightens it (tight FOV = disorientation)', () => {
    expect(zenFraming(1).fov).toBeGreaterThanOrEqual(zenFraming(0).fov);
  });

  it('clamps out-of-range factors (no overshoot past the capped band)', () => {
    expect(zenFraming(2)).toEqual(zenFraming(1));
    expect(zenFraming(-1)).toEqual(zenFraming(0));
  });
});
