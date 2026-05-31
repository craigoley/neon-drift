import { describe, expect, it } from 'vitest';
import { createVehicleState, updateVehicle } from '../Vehicle';
import { createIntent } from '../Input';
import { ROAD, TIMESTEP } from '../../utils/constants';

describe('Vehicle — drivable corridor follows the road curve', () => {
  it('clamps lateral to [centre - halfWidth, centre + halfWidth], not absolute road bounds', () => {
    const center = ROAD.curveAmplitude; // road bent fully to one side
    const v = createVehicleState();
    const intent = createIntent();
    intent.steer = 1; // hard right, hold it
    // Drive long enough to pin against the right wall of the (shifted) corridor.
    for (let i = 0; i < 600; i++) updateVehicle(v, intent, 0, center, TIMESTEP);
    const maxLat = center + ROAD.halfWidth;
    expect(v.lateral).toBeLessThanOrEqual(maxLat + 1e-6);
    expect(v.lateral).toBeGreaterThan(ROAD.halfWidth); // proves the corridor shifted past the absolute bound
  });

  it('does not let the car leave the shifted corridor on the inside edge', () => {
    const center = -ROAD.curveAmplitude;
    const v = createVehicleState();
    const intent = createIntent();
    intent.steer = -1;
    for (let i = 0; i < 600; i++) updateVehicle(v, intent, 0, center, TIMESTEP);
    expect(v.lateral).toBeGreaterThanOrEqual(center - ROAD.halfWidth - 1e-6);
    expect(v.lateral).toBeLessThan(-ROAD.halfWidth); // pushed past the absolute left bound
  });
});
