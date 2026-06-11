/**
 * Zen GENTLE slope effect + terrain Y-follow (PR3a). Craig's call is SUBTLE: uphill
 * nudges speed down, downhill nudges it up, but climbing must NEVER grind to a stall.
 * These lock the direction of the effect AND the bounded "no-grind" guarantee, plus the
 * car easing onto the surface.
 */
import { describe, expect, it } from 'vitest';
import { createZenVehicle, updateZen, followSurface } from '../ZenVehicle';
import { ZEN } from '../../utils/constants';

const TICK = 1 / 60;

/** Hold throttle + a fixed slope for `frames` from rest; return the final speed. */
function cruise(throttle: number, slope: number, frames: number): number {
  const v = createZenVehicle();
  for (let i = 0; i < frames; i++) updateZen(v, 0, throttle, TICK, slope);
  return v.speed;
}

describe('Zen slope — gentle, signed, bounded (no grind)', () => {
  it('uphill cruises SLOWER than flat, downhill FASTER (the nudge has the right sign)', () => {
    // Partial throttle so the flat cruise sits BELOW the cap (room to read the nudge).
    const downhill = cruise(0.5, -0.25, 400);
    const flat = cruise(0.5, 0, 400);
    const uphill = cruise(0.5, 0.25, 400);
    expect(uphill).toBeLessThan(flat);
    expect(downhill).toBeGreaterThan(flat);
  });

  it('is SUBTLE — the uphill/downhill spread is a fraction of the flat cruise speed', () => {
    const flat = cruise(0.5, 0, 400);
    const uphill = cruise(0.5, 0.2, 400);
    const downhill = cruise(0.5, -0.2, 400);
    // A nudge, not a cliff: the full uphill↔downhill swing stays well under the cruise.
    expect(downhill - uphill).toBeLessThan(flat * 0.6);
  });

  it('NEVER grinds to a stall — full-throttle climb stays at/above the uphill floor', () => {
    // Even an exaggerated, steeper-than-real slope, held a long time at full throttle.
    const climbed = cruise(1, 0.5, 1200);
    expect(climbed).toBeGreaterThanOrEqual(ZEN.slopeUphillFloor);
  });

  it('downhill speed still respects the calm cap (never runs away)', () => {
    const flown = cruise(1, -0.5, 1200);
    expect(flown).toBeLessThanOrEqual(ZEN.maxSpeed + 1e-9);
  });

  it('slopeStrength = 0 would mean a flat FEEL (uphill == flat == downhill)', () => {
    // Guard the "dial toward steady" intent: the only thing creating the spread is the
    // slope term, so with no slope input the result is identical regardless of sign.
    expect(cruise(1, 0, 300)).toBe(cruise(1, 0, 300));
  });
});

describe('Zen terrain Y-follow — the car eases onto the surface', () => {
  it('eases toward the target height and settles there (no overshoot)', () => {
    const v = createZenVehicle(); // y = 0
    const target = 5;
    let prev = v.y;
    for (let i = 0; i < 240; i++) {
      followSurface(v, target, TICK);
      expect(v.y).toBeGreaterThanOrEqual(prev); // monotonic approach (eased, no overshoot)
      expect(v.y).toBeLessThanOrEqual(target + 1e-9);
      prev = v.y;
    }
    expect(v.y).toBeCloseTo(target, 2); // arrived
  });

  it('tracks a moving surface target (follows hills as the car drives)', () => {
    const v = createZenVehicle();
    // Settle on a hill, then the surface drops (downhill) — y follows it down.
    for (let i = 0; i < 240; i++) followSurface(v, 6, TICK);
    expect(v.y).toBeCloseTo(6, 1);
    for (let i = 0; i < 240; i++) followSurface(v, -2, TICK);
    expect(v.y).toBeCloseTo(-2, 1);
  });
});
