/**
 * DISPLAY-ONLY US unit formatters (audit #174). The sim's internal speed (world units/s) and distance
 * (world units, historically labelled "m") are UNCHANGED — these only format the numbers a US player
 * READS. NOT sim-math: no SIM_MATH_VERSION impact, no ghost/leaderboard/daily invalidation. Pure +
 * Node-testable (no three, no DOM).
 */

import { UNITS } from './constants';

/** The internal speed (world units/s) as a whole mph number, for the HUD speedometer. */
export function mph(speedUnits: number): number {
  return Math.round(speedUnits * UNITS.mphPerSpeedUnit);
}

/**
 * A distance (in the sim's metre-scale world units) as a US-readable string: FEET below ~0.1 mi (so a
 * short run / a close race gap stays legible), MILES (one decimal) above. Negative inputs are formatted
 * by magnitude (callers prepend their own ahead/behind sign).
 */
export function usDistance(meters: number): string {
  const m = Math.abs(meters);
  if (m < UNITS.feetThresholdMeters) return `${Math.round(m * UNITS.feetPerMeter)} ft`;
  return `${(m / UNITS.metersPerMile).toFixed(1)} mi`;
}
