/**
 * ZEN ARCH SPEED-BOOST — the PURE decay model (no three, no DOM → Node-testable). Driving through
 * an arch sets a boost timer (`boostSeconds`); while it runs, the car's speed cap is RAISED toward
 * `boostMaxSpeed` and then EASES back to cruise as the timer winds down — so the surge fades gently,
 * never snaps away. A pure reward: no charge, no cost. The session owns the timer + the instant kick
 * + the streak visual; this owns the two curves worth testing.
 */

import { ZEN, ZEN_ARCH } from '../utils/constants';
import { smoothstep } from './ZenNoise';

/** Boost strength 0..1 from the remaining boost time (eased) — drives both the speed cap and the
 *  streak-visual opacity. 0 when not boosting (timer ≤ 0), 1 right after a crossing. */
export function boostIntensity(boostTimeLeft: number): number {
  return smoothstep(0, ZEN_ARCH.boostSeconds, Math.max(0, boostTimeLeft));
}

/** The effective speed cap given the remaining boost time: cruise (ZEN.maxSpeed) → boostMaxSpeed,
 *  eased by the intensity, so the cap glides back down as the boost decays (the surge fades). */
export function boostedMaxSpeed(boostTimeLeft: number): number {
  return ZEN.maxSpeed + (ZEN_ARCH.boostMaxSpeed - ZEN.maxSpeed) * boostIntensity(boostTimeLeft);
}
