/**
 * Zen secret area — the GRID FLOOR is forced to the secret-void colour (FIX 2). The diagnosed bug:
 * only the backdrop palette was forced violet; the dominant visual — the neon grid floor (coloured
 * by biomeAt at the NORMAL seed) — stayed normal, so the place never read as "secret." This asserts
 * ZenTerrain.setSecret forces the floor to the secret gridLine (constructible headless — CPU three).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ZenTerrain } from '../ZenTerrain';
import { ZEN, ZEN_SECRET, ZEN_SECRET_BIOME } from '../../utils/constants';

const sr = ((ZEN_SECRET_BIOME.gridLine >> 16) & 255) / 255;
const sg = ((ZEN_SECRET_BIOME.gridLine >> 8) & 255) / 255;
const sb = (ZEN_SECRET_BIOME.gridLine & 255) / 255;

/** Fraction of grid vertices whose colour ≈ the secret-void gridLine. */
function secretFraction(colors: Float32Array): number {
  let match = 0;
  let total = 0;
  for (let i = 0; i < colors.length; i += 3) {
    total++;
    if (Math.abs(colors[i] - sr) < 0.02 && Math.abs(colors[i + 1] - sg) < 0.02 && Math.abs(colors[i + 2] - sb) < 0.02) match++;
  }
  return match / total;
}

describe('Zen secret — the grid floor goes VIOLET in the secret area (not just the backdrop)', () => {
  it('setSecret(true) forces the floor to the secret-void colour; setSecret(false) restores normal', () => {
    const terrain = new ZenTerrain(new THREE.Scene(), ZEN.worldSeed);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const colors = (terrain as any).colors as Float32Array;

    // In the secret area, at the secret coords: the floor is overwhelmingly the violet void colour.
    terrain.setSecret(true);
    terrain.update(ZEN_SECRET.regionX, ZEN_SECRET.regionZ);
    expect(secretFraction(colors)).toBeGreaterThan(0.9); // floor-to-sky violet, the dominant visual

    // Back in the normal world: the floor is the normal biome colour, NOT the void.
    terrain.setSecret(false);
    terrain.update(ZEN_SECRET.regionX + 200000, ZEN_SECRET.regionZ); // a far chunk → rebuild
    expect(secretFraction(colors)).toBeLessThan(0.2);
  });
});
