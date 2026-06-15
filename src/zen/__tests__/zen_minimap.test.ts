/**
 * Zen MINIMAP model — the PURE radar logic (the canvas drawing is not unit-tested, same as
 * the rest of the three.js/DOM layer). What MUST be right + is testable: the world → radar
 * projection (me-centered, rotates so the car's forward points UP), the live biome colour
 * sampling (matches the world palette), and the ramp-marker scan (ramps in radius, correctly
 * positioned, none outside). These are what make the radar trustworthy to navigate by.
 */
import { describe, expect, it } from 'vitest';
import {
  projectToRadar,
  biomeRadarColor,
  gatherMarkers,
  radarScale,
} from '../ZenMinimapModel';
import { biomeAt, createZenBiomeState } from '../ZenBiome';
import { landmarkForCell, LANDMARK_TUNNEL } from '../ZenLandmarkModel';
import { rampCenterForCell, rampContribution } from '../ZenHeight';
import { ZEN, ZEN_BIOMES, ZEN_MINIMAP, ZEN_LANDMARK } from '../../utils/constants';
import { mixHex } from '../../utils/math';

const SEED = ZEN.worldSeed;
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

describe('Zen minimap — the world → radar projection (me-centered, car points up)', () => {
  it('the car (zero delta) maps to the radar centre, at any heading', () => {
    for (const h of [0, 0.5, Math.PI, -2.1, 5.0]) {
      const o = projectToRadar(0, 0, h);
      expect(close(o.x, 0)).toBe(true);
      expect(close(o.y, 0)).toBe(true);
    }
  });

  it('a point straight AHEAD maps to straight UP (−y), whatever the heading', () => {
    // Forward at heading h is (sin h, −cos h). A point one unit ahead must land on the radar
    // at (0, −1) — directly above the centre — because the car always points up.
    for (const h of [0, 0.7, Math.PI / 2, Math.PI, -1.3]) {
      const fx = Math.sin(h);
      const fz = -Math.cos(h);
      const o = projectToRadar(fx, fz, h);
      expect(close(o.x, 0)).toBe(true);
      expect(close(o.y, -1)).toBe(true); // up (canvas y is down → forward is −y)
    }
  });

  it('a point to the car’s RIGHT maps to the right (+x)', () => {
    // Right axis at heading h is (cos h, sin h).
    for (const h of [0, 0.9, Math.PI / 3, -2.0]) {
      const rx = Math.cos(h);
      const rz = Math.sin(h);
      const o = projectToRadar(rx, rz, h);
      expect(close(o.x, 1)).toBe(true);
      expect(close(o.y, 0)).toBe(true);
    }
  });

  it('preserves distance (a pure rotation — the radar is to scale)', () => {
    const dx = 137;
    const dz = -42;
    for (const h of [0, 1.1, -3.0, 4.4]) {
      const o = projectToRadar(dx, dz, h);
      expect(close(Math.hypot(o.x, o.y), Math.hypot(dx, dz), 1e-6)).toBe(true);
    }
  });

  it('ROTATES with heading: turning right sends a north point to the left', () => {
    // A point due north (−z). Facing north (h=0) → it's up. After turning right 90° (h=π/2,
    // now facing east) → north is to your LEFT (−x).
    const up = projectToRadar(0, -100, 0);
    expect(close(up.x, 0)).toBe(true);
    expect(up.y).toBeLessThan(0); // up
    const afterRight = projectToRadar(0, -100, Math.PI / 2);
    expect(afterRight.x).toBeLessThan(0); // now to the left
    expect(close(afterRight.y, 0, 1e-6)).toBe(true);
  });

  it('radarScale maps the world radius to the pixel radius', () => {
    const px = 60;
    expect(close(radarScale(px) * ZEN_MINIMAP.worldRadius, px, 1e-9)).toBe(true);
  });
});

describe('Zen minimap — biome colour sampling matches the world palette', () => {
  it('returns the active biome’s blended grid-line colour (map ↔ world agree)', () => {
    const st = createZenBiomeState();
    for (let i = 0; i < 500; i++) {
      const x = (i * 137) % 40000 - 20000;
      const z = (i * 271) % 40000 - 20000;
      biomeAt(SEED, x, z, st);
      const expected = mixHex(ZEN_BIOMES[st.from].gridLine, ZEN_BIOMES[st.to].gridLine, st.blend);
      expect(biomeRadarColor(SEED, x, z, createZenBiomeState())).toBe(expected);
    }
  });

  it('is deterministic per seed (same point → same colour)', () => {
    expect(biomeRadarColor(SEED, 123.4, -56.7)).toBe(biomeRadarColor(SEED, 123.4, -56.7));
  });
});

describe('Zen minimap — ramp markers: live-found in range, correctly placed', () => {
  it('every gathered ramp is a REAL ramp (a dome sits at its centre) and is within radius', () => {
    const carX = 800;
    const carZ = -1200;
    const R = ZEN_MINIMAP.worldRadius;
    // The radar gathers ramps AND landmarks; here we check the ramp markers specifically.
    const markers = gatherMarkers(SEED, carX, carZ, R).filter((m) => m.kind === 'ramp');
    expect(markers.length).toBeGreaterThan(0); // ramps are sparse but present in a radar reach
    for (const m of markers) {
      expect(m.kind).toBe('ramp');
      // Inside the radar circle…
      expect(Math.hypot(m.x - carX, m.z - carZ)).toBeLessThanOrEqual(R + 1e-6);
      // …and a real ramp dome peaks at its centre.
      expect(rampContribution(SEED, m.x, m.z)).toBeGreaterThan(ZEN.rampHeight * 0.99);
    }
  });

  it('finds NO ramp the cell scan would miss — matches a brute-force dome search in range', () => {
    const carX = -340;
    const carZ = 560;
    const R = 1000;
    const found = new Set(gatherMarkers(SEED, carX, carZ, R).map((m) => `${Math.round(m.x)},${Math.round(m.z)}`));
    // Brute force: any cell centre with a ramp inside the radius must be in the gathered set.
    const cs = ZEN.rampCellSize;
    for (let cz = Math.floor((carZ - R) / cs); cz <= Math.floor((carZ + R) / cs); cz++) {
      for (let cx = Math.floor((carX - R) / cs); cx <= Math.floor((carX + R) / cs); cx++) {
        const c = rampCenterForCell(SEED, cx, cz);
        if (!c) continue;
        if (Math.hypot(c.x - carX, c.z - carZ) <= R) {
          expect(found.has(`${Math.round(c.x)},${Math.round(c.z)}`)).toBe(true);
        }
      }
    }
  });

  it('a ramp projects to the correct radar position (in range, ahead → upper half)', () => {
    // Put the car just south of a known ramp, facing north → the ramp is ahead → upper half.
    const ramp = gatherMarkers(SEED, 0, 0, 4000)[0];
    expect(ramp).toBeDefined();
    const carX = ramp.x;
    const carZ = ramp.z + 300; // 300u south of the ramp
    const o = projectToRadar(ramp.x - carX, ramp.z - carZ, 0); // facing north (h=0)
    expect(close(o.x, 0)).toBe(true); // dead ahead → centred horizontally
    expect(o.y).toBeLessThan(0); // ahead → upper half of the radar
    expect(close(Math.abs(o.y), 300)).toBe(true);
  });
});

describe('Zen minimap — rampCenterForCell matches rampContribution placement (no drift)', () => {
  it('a cell with a center has its dome peak there; a null cell has no dome in its area', () => {
    const cs = ZEN.rampCellSize;
    let withRamp = 0;
    let without = 0;
    for (let cx = 0; cx < 24 && (withRamp < 3 || without < 3); cx++) {
      for (let cz = 0; cz < 24 && (withRamp < 3 || without < 3); cz++) {
        const c = rampCenterForCell(SEED, cx, cz);
        if (c) {
          if (withRamp < 3) {
            expect(rampContribution(SEED, c.x, c.z)).toBeGreaterThan(ZEN.rampHeight * 0.99);
            withRamp++;
          }
        } else if (without < 3) {
          // No gated ramp in the cell → the cell centre has no ramp dome.
          expect(rampContribution(SEED, cx * cs + cs / 2, cz * cs + cs / 2)).toBe(0);
          without++;
        }
      }
    }
    expect(withRamp).toBeGreaterThan(0);
    expect(without).toBeGreaterThan(0);
  });
});

describe('Zen minimap — landmark markers carry TYPE so tunnels draw distinctly (findable)', () => {
  it('gatherMarkers tags each landmark with its landmarkType (was dropped → all identical dots)', () => {
    // Find a region with a tunnel landmark, gather markers there, and confirm the type is carried.
    let tunnel: ReturnType<typeof landmarkForCell> = null;
    outer: for (let cz = 0; cz < 400; cz++) for (let cx = 0; cx < 400; cx++) {
      const lm = landmarkForCell(SEED, cx, cz);
      if (lm && lm.type === LANDMARK_TUNNEL) { tunnel = lm; break outer; }
    }
    if (!tunnel) throw new Error('no tunnel found'); // narrows non-null + asserts existence
    const markers = gatherMarkers(SEED, tunnel.x, tunnel.z, ZEN_LANDMARK.drawRadius);
    const lmMarkers = markers.filter((m) => m.kind === 'landmark');
    expect(lmMarkers.length).toBeGreaterThan(0);
    // Every landmark marker carries a type (not undefined), and OUR tunnel is tagged TUNNEL.
    for (const m of lmMarkers) expect(m.landmarkType).toBeTypeOf('number');
    const here = lmMarkers.find((m) => Math.hypot(m.x - tunnel.x, m.z - tunnel.z) < 1e-6);
    expect(here?.landmarkType).toBe(LANDMARK_TUNNEL); // navigable: the radar knows this dot is a tunnel
  });

  it('tunnels were BUMPED to ~25% of landmarks (typeWeights [3,3,2,1,3]) — deliberately less rare', () => {
    const counts = [0, 0, 0, 0, 0];
    let total = 0;
    for (let cz = 0; cz < 200; cz++) for (let cx = 0; cx < 200; cx++) {
      const lm = landmarkForCell(SEED, cx, cz);
      if (lm) { counts[lm.type]++; total++; }
    }
    const tunnelFrac = counts[LANDMARK_TUNNEL] / total;
    // weight 3 of total 12 = 25% (the terrain gate is type-independent, so share ≈ weight share).
    expect(tunnelFrac).toBeGreaterThan(0.20);
    expect(tunnelFrac).toBeLessThan(0.30);
  });
});

describe('Zen minimap — tunnel ENCOUNTER SPACING (the spatial property #131 tests missed)', () => {
  // The prior PR asserted "a tunnel shape exists" but never the SPATIAL frequency — so "exists but
  // unfindable" shipped. These assert the thing that actually makes tunnels findable: they're close
  // enough together to come across.
  function countTunnels(cellsPerSide: number): number {
    let tunnels = 0;
    for (let cz = 0; cz < cellsPerSide; cz++) for (let cx = 0; cx < cellsPerSide; cx++) {
      const lm = landmarkForCell(SEED, cx, cz);
      if (lm && lm.type === LANDMARK_TUNNEL) tunnels++;
    }
    return tunnels;
  }

  it('mean tunnel spacing is well under the pre-bump ~14.6km (the bump made them denser)', () => {
    const N = 220;
    const tunnels = countTunnels(N);
    const cs = ZEN_LANDMARK.cellSize;
    const spacing = Math.sqrt((N * cs) ** 2 / tunnels); // ≈ sqrt(area per tunnel)
    expect(spacing).toBeGreaterThan(0);
    expect(spacing).toBeLessThan(12000); // was ~14.6km at weight 1; weight 3 → ~9.3km
  });

  it('a tunnel is expected within the radar at the bumped density (no longer a needle in a haystack)', () => {
    const N = 220;
    const cs = ZEN_LANDMARK.cellSize;
    const density = countTunnels(N) / (N * cs) ** 2;
    const expectedInRadar = density * Math.PI * ZEN_MINIMAP.worldRadius ** 2;
    expect(expectedInRadar).toBeGreaterThan(0.08); // ~3× the old ~0.03 (denser tunnels + wider radar)
  });
});
