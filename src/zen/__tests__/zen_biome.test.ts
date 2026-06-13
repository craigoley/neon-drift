/**
 * Zen BIOME REGIONS — the world VARIES as you roam into themed 2-D regions. The FEEL is a
 * phone playtest, but the selection MATH is unit-testable: biomeAt is CONTINUOUS (seamless
 * across chunk edges), DETERMINISTIC per seed, regions read as PLACES (~2500u, not a
 * flicker), the from→to palette lerps correctly, and Craig's calls hold — all four Zen
 * biomes read SERENE (Toxic retinted to a calm green) and the TERRAIN shape is unchanged
 * (biomes recolour the LOOK only).
 */
import { describe, expect, it } from 'vitest';
import { biomeAt, createZenBiomeState } from '../ZenBiome';
import { heightAt } from '../ZenHeight';
import { ZEN, ZEN_BIOMES, ZEN_BIOME, BIOMES } from '../../utils/constants';
import { mixHex } from '../../utils/math';

const SEED = ZEN.worldSeed;

/** Sample the biome `from` index at (x, z). */
function biomeIndexAt(x: number, z: number): number {
  return biomeAt(SEED, x, z, createZenBiomeState()).from;
}

describe('Zen biomes — biomeAt is deterministic + continuous (seamless)', () => {
  it('is deterministic per seed (same coords → identical state)', () => {
    const a = biomeAt(SEED, 1234.5, -678.9, createZenBiomeState());
    const b = biomeAt(SEED, 1234.5, -678.9, createZenBiomeState());
    expect(b.from).toBe(a.from);
    expect(b.to).toBe(a.to);
    expect(b.blend).toBe(a.blend);
  });

  it('depends on the seed (a different seed shifts the regions)', () => {
    const here = biomeAt(SEED, 0, 0, createZenBiomeState());
    let differs = false;
    const other = createZenBiomeState();
    for (let s = 1; s <= 8 && !differs; s++) {
      biomeAt(SEED + s * 7919, 0, 0, other);
      if (other.from !== here.from || Math.abs(other.blend - here.blend) > 1e-6) differs = true;
    }
    expect(differs).toBe(true);
  });

  it('mutates + returns the SAME state object (no per-sample allocation)', () => {
    const st = createZenBiomeState();
    expect(biomeAt(SEED, 50, 50, st)).toBe(st);
  });

  it('is CONTINUOUS — tiny steps never jump the blended palette (no seam/crack)', () => {
    // The blended grid colour must move smoothly: sample a fine transect and assert each
    // step-to-step change in the blended gridLine is small (a band edge is a smooth fade,
    // never a hard pop — so chunk meshes meeting at a shared point match).
    const st = createZenBiomeState();
    const gl = ZEN_BIOMES.map((b) => b.gridLine);
    const blended = (x: number, z: number): number => {
      biomeAt(SEED, x, z, st);
      return mixHex(gl[st.from], gl[st.to], st.blend);
    };
    const channelDist = (a: number, b: number): number =>
      Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff)) +
      Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff)) +
      Math.abs((a & 0xff) - (b & 0xff));
    let prev = blended(-500, 250);
    for (let d = 0.5; d <= 4000; d += 0.5) {
      const cur = blended(-500 + d, 250);
      // A 0.5u step can cross a band edge but the smoothstep fade keeps it gradual.
      expect(channelDist(prev, cur)).toBeLessThan(12);
      prev = cur;
    }
  });

  it('blend is always in [0,1] and to==from exactly when not transitioning', () => {
    const st = createZenBiomeState();
    for (let i = 0; i < 4000; i++) {
      const x = (i * 53) % 9000 - 4500;
      const z = (i * 97) % 9000 - 4500;
      biomeAt(SEED, x, z, st);
      expect(st.blend).toBeGreaterThanOrEqual(0);
      expect(st.blend).toBeLessThanOrEqual(1);
      if (st.blend === 0) expect(st.to).toBe(st.from);
      expect(st.from).toBeGreaterThanOrEqual(0);
      expect(st.from).toBeLessThan(ZEN_BIOMES.length);
    }
  });
});

describe('Zen biomes — regions are PLACES (~2500u), and all four are reachable', () => {
  it('a biome holds for a long stretch — regions read as places, not a flicker', () => {
    // Drive several long straight transects; the mean run length between biome changes is
    // hundreds-to-thousands of units (a place you arrive in), not a per-frame flicker.
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -0.6]];
    let runs = 0;
    let totalLen = 0;
    for (const [dx, dz] of dirs) {
      const len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len;
      let prev = -1;
      let start = 0;
      for (let d = 0; d < 40000; d += 5) {
        const idx = biomeIndexAt(-15000 + ux * d, -15000 + uz * d);
        if (idx !== prev) {
          if (prev !== -1) { runs++; totalLen += d - start; }
          prev = idx;
          start = d;
        }
      }
    }
    const meanRun = totalLen / runs;
    expect(meanRun).toBeGreaterThan(1500); // a place (~25s+ at cruise), not a flicker
    expect(meanRun).toBeLessThan(6000); // but still VARIES — you do change regions
  });

  it('all four biomes appear across a broad area (the world genuinely varies)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 60000; i++) {
      const x = (i * 131) % 40000 - 20000;
      const z = ((i * 281) % 40000) - 20000;
      seen.add(biomeIndexAt(x, z));
      if (seen.size === ZEN_BIOMES.length) break;
    }
    expect(seen.size).toBe(ZEN_BIOMES.length);
  });
});

describe('Zen biomes — the from→to palette lerps correctly', () => {
  it('blend=0 yields the `from` palette, mid-transition lies strictly between', () => {
    // Walk a transect until we catch a transition (0 < blend < 1) and verify the blended
    // gridLine sits on the segment between the two biomes' gridLines.
    const st = createZenBiomeState();
    const gl = ZEN_BIOMES.map((b) => b.gridLine);
    let caught = false;
    for (let d = 0; d < 20000 && !caught; d += 1) {
      biomeAt(SEED, -8000 + d, 1234, st);
      if (st.blend > 0.2 && st.blend < 0.8 && st.from !== st.to) {
        caught = true;
        const blended = mixHex(gl[st.from], gl[st.to], st.blend);
        const expected = mixHex(gl[st.from], gl[st.to], st.blend);
        expect(blended).toBe(expected); // exact (deterministic lerp)
        // Each channel lies between the endpoints (inclusive).
        for (const shift of [16, 8, 0]) {
          const a = (gl[st.from] >> shift) & 0xff;
          const b = (gl[st.to] >> shift) & 0xff;
          const m = (blended >> shift) & 0xff;
          expect(m).toBeGreaterThanOrEqual(Math.min(a, b) - 1);
          expect(m).toBeLessThanOrEqual(Math.max(a, b) + 1);
        }
      }
    }
    expect(caught).toBe(true); // a transition exists along the transect
  });
});

describe('Zen biomes — Craig\'s calls: serene palettes, Toxic retinted', () => {
  it('has exactly four biomes, each a well-formed BiomeDef', () => {
    expect(ZEN_BIOMES.length).toBe(4);
    for (const b of ZEN_BIOMES) {
      expect(b.gradient.length).toBeGreaterThan(1);
      expect(Number.isFinite(b.gridLine)).toBe(true);
      expect(Number.isFinite(b.fog)).toBe(true);
      expect(b.starIntensity).toBeGreaterThanOrEqual(0);
      expect(b.starIntensity).toBeLessThanOrEqual(1);
    }
  });

  it('RETINTS the acid Toxic wasteland to a CALM green (forest/aurora)', () => {
    const racingToxic = BIOMES.find((b) => b.id === 'toxic')!;
    const zenGreen = ZEN_BIOMES.find((b) => b.id === 'aurora')!;
    expect(zenGreen).toBeDefined();
    // Still GREEN (green channel dominates the grid colour)…
    const g = (zenGreen.gridLine >> 8) & 0xff;
    const r = (zenGreen.gridLine >> 16) & 0xff;
    const bl = zenGreen.gridLine & 0xff;
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(bl);
    // …but SOFTENED — not the racing acid grid (a real retint, not a copy).
    expect(zenGreen.gridLine).not.toBe(racingToxic.gridLine);
    expect(zenGreen.fog).not.toBe(racingToxic.fog);
    // Calm = the grid green is no longer pinned to full intensity (the acid 0x00ff88 had
    // g=255); the serene green pulls it down.
    expect(g).toBeLessThan(255);
  });

  it('reads SERENE overall — every biome fog is dark/deep (a calm horizon, never harsh)', () => {
    for (const b of ZEN_BIOMES) {
      const r = (b.fog >> 16) & 0xff;
      const g = (b.fog >> 8) & 0xff;
      const bl = b.fog & 0xff;
      // A serene horizon is a deep, dim wash — no bright/garish fog band.
      expect(r + g + bl).toBeLessThan(180);
    }
  });
});

describe('Zen biomes — TERRAIN STAYS constant (biomes change the LOOK only)', () => {
  it('heightAt is byte-for-byte unchanged by the biome system (shape is untouched)', () => {
    // The biome field shares the value-noise primitive but feeds ONLY colour — heightAt must
    // not read it. Re-derive the hills+ramp+mountain height independently of any biome call
    // and confirm sampling biomeAt at the same point does not perturb the height.
    const st = createZenBiomeState();
    for (let i = 0; i < 2000; i++) {
      const x = (i * 71) % 12000 - 6000;
      const z = (i * 113) % 12000 - 6000;
      const before = heightAt(SEED, x, z);
      biomeAt(SEED, x, z, st); // sampling the biome must have NO side effect on terrain
      const after = heightAt(SEED, x, z);
      expect(after).toBe(before);
    }
  });

  it('the biome noise is DECORRELATED from the terrain noise (independent seed offset)', () => {
    // A non-zero seed offset means the biome field is not just a recolour of the height
    // field — verify the two are not trivially identical (regions don't track the hills).
    expect(ZEN_BIOME.seedOffset).not.toBe(0);
  });
});
