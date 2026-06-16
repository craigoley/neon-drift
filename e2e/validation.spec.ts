/**
 * L3 LIVE-VALIDATION / BUG-HUNT SWEEP — the live/soak layer the L1 Vitest suite and the L2
 * smoke/visual specs structurally can't cover on a Three.js <canvas>. It asserts what RENDERS /
 * HAPPENS / stays BOUNDED+FINITE over a real run — the bug class that passes unit tests but is
 * caught only by playtest (landmark reward "fired-never-rendered", Zen "void", secret-warp
 * "bounce", tunnels "never found", jump "inconsistency"). See docs/validation-sweep-recon.md.
 *
 * Two parts:
 *   A — console-clean over real interactions (menu → 3D-preview screens → a brief race → Zen).
 *   B — a sustained, UNFROZEN Zen soak: drive across biomes, autopilot into a secret-area WARP +
 *       back, and through a TUNNEL — asserting OBJECTIVE canaries (finite pos/cam, bounded
 *       scene-graph + heap, no error storm, no stall, no warp/secret desync, biomes change).
 *
 * ROBUSTNESS (recon principle #1): every transition is awaited via window.__neonDebug — never a
 * fixed-sleep through a state change. The world is position-deterministic (fixed seed), so the
 * autopilot targets (nearest gateway/tunnel) are computed in-test from the SAME pure placement the
 * game uses → reproducible, not flaky. Each phase logs "[VALIDATION] entering state=X" so a hang
 * names its iteration BEFORE any timeout is blamed (principle #4).
 *
 * FIND, DON'T FIX (principle #2): a real failure here is a FINDING for a separate triage PR.
 * BOUNDARY (recon §5): OBJECTIVE failures only — NOT feel (camera whip / jump softness / lurch
 * stay human phone playtest).
 */
import { test, expect, type Page } from '@playwright/test';
import { trackErrors } from './_helpers';
import { ZEN } from '../src/utils/constants';
import { landmarksInRadius, LANDMARK_GATEWAY, LANDMARK_TUNNEL, LANDMARK_VISTA } from '../src/zen/ZenLandmarkModel';
import { findReturnPortal } from '../src/zen/ZenSecret';

// --- expected-warning allowlist (recon §4): benign sources that must NOT read as findings ---
const EXPECTED = [
  /readPixels/i, // CarPreview render-to-texture cosmetic thumbnail (store / car-picker)
  /feedback loop/i, // same RTT path — destination texture transiently bound while sampled
  /WebGLRenderTarget/i, // three.js RTT internals from the cosmetic preview
  /\[MP\]/, // multiplayer connect/DESYNC diagnostics (only if MP is exercised)
  /chunks are larger than 500 ?kB/i, // Vite build advisory (build-time; never at runtime)
];
const unexpected = (errs: string[]): string[] => errs.filter((e) => !EXPECTED.some((re) => re.test(e)));

interface ZenDbg {
  pos: { x: number; y: number; z: number };
  cam: { x: number; y: number; z: number };
  heading: number;
  speed: number;
  airborne: boolean;
  warpPhase: 'none' | 'out' | 'in';
  inSecret: boolean;
  hasSaved: boolean;
  onSlide: boolean;
  slideU: number;
  onSurface: boolean;
  camHeading: number;
  biome: { from: number; to: number; blend: number };
  counts: { props: number; terrainVerts: number; landmarks: number; sceneChildren: number };
}
interface Dbg { mode: string; frame: number; seed: number; zen?: ZenDbg }

const SEED = ZEN.worldSeed;
const log = (s: string) => console.log(`[VALIDATION] entering state=${s}`);

const readDbg = (page: Page) => page.evaluate(() => (window as unknown as { __neonDebug?: Dbg }).__neonDebug ?? null);

/** The nearest landmark of a type to (x,z), scanning the deterministic field outward. */
function nearestOfType(type: number, x: number, z: number, radius = 16000) {
  const all = landmarksInRadius(SEED, x, z, radius).filter((l) => l.type === type);
  all.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  return all[0] ?? null;
}

/** Assert the always-on objective canaries on one Zen sample. Returns the sample (for max-tracking). */
function checkSample(z: ZenDbg, where: string): void {
  for (const v of [z.pos.x, z.pos.y, z.pos.z, z.cam.x, z.cam.y, z.cam.z, z.heading, z.speed]) {
    expect(Number.isFinite(v), `${where}: finite (pos/cam/heading/speed) — snapshot ${JSON.stringify(z)}`).toBe(true);
  }
  expect(z.counts.props, `${where}: props within the streamed cap`).toBeLessThanOrEqual(324);
  expect(['none', 'out', 'in'], `${where}: warpPhase valid`).toContain(z.warpPhase);
  // The impossible state the #130 secret-warp bug would produce: inside the secret with no saved
  // main-world spot to return to.
  expect(z.inSecret && !z.hasSaved, `${where}: never inSecret without a saved return spot`).toBe(false);
}

/**
 * Drive the Zen car for up to budgetMs, holding gas and (if target given) steering toward it via a
 * closed loop on the read-only pos/heading. Samples every ~stepMs, runs checkSample, and exits
 * EARLY when done(z) is true. Returns the samples + whether done fired.
 */
async function drive(
  page: Page,
  where: string,
  opts: { target?: { x: number; z: number } | null; budgetMs: number; done?: (z: ZenDbg) => boolean; stepMs?: number },
): Promise<{ samples: ZenDbg[]; done: boolean }> {
  const step = opts.stepMs ?? 120;
  const samples: ZenDbg[] = [];
  let steering: 'ArrowLeft' | 'ArrowRight' | null = null;
  let done = false;
  await page.keyboard.down('ArrowUp'); // hold gas for the whole leg
  const start = Date.now();
  try {
    while (Date.now() - start < opts.budgetMs) {
      const d = await readDbg(page);
      const z = d?.zen;
      if (z) {
        samples.push(z);
        checkSample(z, where);
        if (opts.done?.(z)) { done = true; break; }
        if (opts.target) {
          const dx = opts.target.x - z.pos.x;
          const dz = opts.target.z - z.pos.z;
          const desired = Math.atan2(dx, -dz); // forward = (sin h, -cos h)
          let err = desired - z.heading;
          while (err > Math.PI) err -= 2 * Math.PI;
          while (err < -Math.PI) err += 2 * Math.PI;
          const want = Math.abs(err) < 0.08 ? null : err > 0 ? 'ArrowRight' : 'ArrowLeft';
          if (want !== steering) {
            if (steering) await page.keyboard.up(steering);
            if (want) await page.keyboard.down(want);
            steering = want;
          }
        }
      }
      await page.waitForTimeout(step);
    }
  } finally {
    if (steering) await page.keyboard.up(steering);
    await page.keyboard.up('ArrowUp');
  }
  return { samples, done };
}

async function enterZen(page: Page): Promise<void> {
  log('enter-zen');
  await page.locator('.shell-zen-open').click();
  await page.waitForFunction(() => (window as unknown as { __neonDebug?: Dbg }).__neonDebug?.mode === 'zen', null, {
    timeout: 15_000,
  });
  await expect(page.locator('.zen-overlay')).toBeVisible();
}

test.describe('L3 validation — console-clean over real interactions (recon §1, §4)', () => {
  test('menu, 3D-preview screens, a brief race, and Zen entry log no UNEXPECTED console errors', async ({ page }) => {
    const errors = trackErrors(page);

    log('boot');
    await page.goto(`/?seed=${SEED}`);
    await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30_000 });
    await expect(page.locator('.shell-start')).toBeVisible();
    // The hook must be present on the dev server (import.meta.env.DEV) — it's how the soak reads state.
    expect(await readDbg(page), 'window.__neonDebug present on the dev server').not.toBeNull();

    log('car-picker (RTT preview)');
    await page.locator('.shell-cars').click();
    await expect(page.locator('.shell-carpicker')).toBeVisible();
    await page.locator('.shell-next').click();
    await page.locator('.shell-next').click();
    await page.locator('.shell-prev').click();
    await page.locator('.shell-carpicker .shell-close').click();

    log('store (RTT preview)');
    const storeBtn = page.locator('.shell-store-open');
    if (await storeBtn.count()) {
      await storeBtn.click();
      await expect(page.locator('.shell-store')).toBeVisible();
      await page.locator('.shell-close-store').click();
    }

    log('brief race');
    await page.locator('.shell-play').click();
    await page.waitForFunction(() => document.body.classList.contains('playing'), null, { timeout: 10_000 });
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(1500);
    await page.keyboard.up('ArrowUp');
    await page.keyboard.press('Escape'); // pause
    await expect(page.locator('.shell-pause')).toBeVisible();
    await page.locator('.shell-quit').click();
    await expect(page.locator('.shell-start')).toBeVisible();

    log('enter-zen');
    await enterZen(page);
    await page.waitForTimeout(1000);
    await page.locator('.zen-exit').click();
    await expect(page.locator('.shell-start')).toBeVisible();

    const bad = unexpected(errors);
    expect(bad, `unexpected console errors over the flow walk:\n${bad.join('\n')}`).toEqual([]);
  });
});

test.describe('L3 validation — the Zen SOAK (recon §3): finite, bounded, unfrozen, no desync', () => {
  test('drive across biomes, warp into the secret area + back, through a tunnel — objective canaries hold', async ({ page }) => {
    const errors = trackErrors(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const heapMB = async (): Promise<number> => {
      const { metrics } = await cdp.send('Performance.getMetrics');
      return (metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0) / 1e6;
    };

    log('boot');
    await page.goto(`/?seed=${SEED}`);
    await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30_000 });
    await enterZen(page);

    const all: ZenDbg[] = [];
    const heaps: number[] = [await heapMB()];
    const frame0 = (await readDbg(page))!.frame;

    // --- PHASE 1: cruise across biomes (the sustained unfrozen baseline) ---
    log('cruise-biomes');
    const far = { x: 6000, z: -6000 }; // a far heading → crosses ≥1 biome region (~2800u) over the leg
    const cruise = await drive(page, 'cruise', { target: far, budgetMs: 30_000 });
    all.push(...cruise.samples);
    heaps.push(await heapMB());
    const biomesSeen = new Set(cruise.samples.map((z) => z.biome.from));
    expect(biomesSeen.size, 'crossed at least one biome boundary while cruising').toBeGreaterThan(1);

    // --- PHASE 2: warp INTO the secret area (autopilot to the nearest gateway) ---
    const gw = nearestOfType(LANDMARK_GATEWAY, 0, 0);
    expect(gw, 'a gateway exists within range of spawn').not.toBeNull();
    log(`warp-out (gateway @ ${Math.round(gw!.x)},${Math.round(gw!.z)})`);
    const out = await drive(page, 'warp-out', { target: gw!, budgetMs: 70_000, done: (z) => z.inSecret });
    all.push(...out.samples);
    expect(out.done, 'crossed the gateway → entered the secret area (inSecret)').toBe(true);
    // Settle the fade machine, then assert we really teleported far + the warp state is clean.
    await page.waitForFunction(() => (window as unknown as { __neonDebug?: Dbg }).__neonDebug?.zen?.warpPhase === 'none', null, { timeout: 8_000 });
    const inSec = (await readDbg(page))!.zen!;
    checkSample(inSec, 'in-secret');
    expect(Math.abs(inSec.pos.x), 'teleported to the far secret band').toBeGreaterThan(100_000);
    expect(inSec.hasSaved, 'a main-world return spot is saved while in the secret area').toBe(true);
    heaps.push(await heapMB());

    // --- PHASE 3: warp BACK (autopilot to the deterministic return portal in the far region) ---
    const portal = findReturnPortal(SEED);
    log(`warp-back (return portal @ ${Math.round(portal.x)},${Math.round(portal.z)})`);
    const back = await drive(page, 'warp-back', { target: { x: portal.x, z: portal.z }, budgetMs: 80_000, done: (z) => !z.inSecret });
    all.push(...back.samples);
    expect(back.done, 'crossed the return portal → left the secret area (inSecret false)').toBe(true);
    await page.waitForFunction(() => (window as unknown as { __neonDebug?: Dbg }).__neonDebug?.zen?.warpPhase === 'none', null, { timeout: 8_000 });
    const home = (await readDbg(page))!.zen!;
    checkSample(home, 'returned');
    expect(Math.abs(home.pos.x), 'restored to the main world (near origin), not stuck far').toBeLessThan(50_000);
    heaps.push(await heapMB());

    // --- PHASE 4: drive THROUGH the NEAREST tunnel (the surface-override / far-from-path NaN
    // candidate). The "nearest" tunnel to the live post-warp spot can still be several km out, so
    // the leg budget is DISTANCE-SCALED — a fixed 60s under-budgeted a 4924u drive at 96 u/s
    // (≈82 u/s avg required, no margin) on the first live run. Nearest-pick + scaled budget = belt
    // and suspenders, and it still exercises descend + resurface. ---
    const tun = nearestOfType(LANDMARK_TUNNEL, Math.round(home.pos.x), Math.round(home.pos.z));
    if (tun) {
      const dist = Math.hypot(tun.x - home.pos.x, tun.z - home.pos.z);
      // dist / maxSpeed is the straight-line floor; ×2.5 covers the initial turn-to-heading, the
      // closed-loop steering corrections, and the curved ~810u descent. Floored so a near tunnel
      // still gets a real budget.
      const budgetMs = Math.max(45_000, Math.round((dist / ZEN.maxSpeed) * 2.5) * 1000);
      log(`tunnel (@ ${Math.round(tun.x)},${Math.round(tun.z)} · ${Math.round(dist)}u · budget ${Math.round(budgetMs / 1000)}s)`);
      // Done = descended INTO the tunnel near its centre. Latch loosened to <60u && y<−1 (still a
      // genuine sub-surface descent — tunnelDepth is 16u — just less knife-edge than <40u && y<−2).
      const through = await drive(page, 'tunnel', {
        target: tun,
        budgetMs,
        done: (z) => Math.hypot(z.pos.x - tun.x, z.pos.z - tun.z) < 60 && z.pos.y < -1,
      });
      all.push(...through.samples);
      // Self-diagnosing (principle #4): a miss reports distance-remaining + depth reached, never a
      // bare fail — so we never bump a budget to hide a hang, the log says how close it got.
      const closest = through.samples.length ? Math.min(...through.samples.map((z) => Math.hypot(z.pos.x - tun.x, z.pos.z - tun.z))) : Infinity;
      const minY = through.samples.length ? Math.min(...through.samples.map((z) => z.pos.y)) : NaN;
      console.log(`[VALIDATION] tunnel: closestApproach=${Math.round(closest)}u minY=${minY.toFixed(1)} reached=${through.done}`);
      expect(through.done, `descended into the tunnel (closest=${Math.round(closest)}u, minY=${minY.toFixed(1)})`).toBe(true);

      // SMOOTHNESS CANARY (diagnosis #148: the car bumped between the tunnel floor and normal ground
      // — FINITE but not SMOOTH, so the old sweep passed). Drive THROUGH + out the far side and assert
      // the car STAYS on the tunnel floor: `onSurface` doesn't toggle back to terrain mid-tunnel, and
      // no gross per-sample ΔY pop. (The per-frame guarantee is the unit test zen_tunnel_smooth; this
      // is the live belt-and-suspenders.) Reuse the pure unit test as the precise guard.
      log('tunnel-through (smoothness)');
      const past = { x: 2 * tun.x - home.pos.x, z: 2 * tun.z - home.pos.z }; // keep going past the tunnel
      const out = await drive(page, 'tunnel-through', {
        target: past,
        budgetMs: 14_000,
        done: (z) => Math.hypot(z.pos.x - tun.x, z.pos.z - tun.z) > 140 && z.pos.y > -1,
      });
      all.push(...out.samples);
      const traversal = [...through.samples, ...out.samples];
      const deep = traversal.filter((z) => z.pos.y < -3); // firmly inside the tunnel
      const maxJump = traversal.length > 1 ? Math.max(...traversal.slice(1).map((z, i) => Math.abs(z.pos.y - traversal[i].pos.y))) : 0;
      const poppedToGround = deep.some((z) => !z.onSurface); // deep but on plain terrain = the #148 pop
      console.log(`[VALIDATION] tunnel-smooth: deepSamples=${deep.length} poppedToGround=${poppedToGround} maxΔY=${maxJump.toFixed(1)}u`);
      if (deep.length >= 2) {
        expect(poppedToGround, 'stayed on the tunnel floor (no pop to normal ground mid-tunnel)').toBe(false);
      }
      expect(maxJump, 'no gross vertical pop while traversing the tunnel').toBeLessThan(25);
    } else {
      log('tunnel-skip (none in range — not a failure)');
    }
    heaps.push(await heapMB());

    // --- PHASE 5: VISTA SKY-SLIDE — drive onto a vista deck → CATAPULT up the twisting sky-slide →
    // land. Objective canaries: finite pos/cam through the big vertical soar + twist (the absolute-Y
    // path is the new NaN candidate), onSlide round-trips true→false (it launches AND lands), and the
    // soar gains real altitude. FEEL (exhilaration / camera whip) is Craig's phone — this is the
    // OBJECTIVE gate only (recon §5 boundary). ---
    const cur = (await readDbg(page))!.zen!;
    const vis = nearestOfType(LANDMARK_VISTA, Math.round(cur.pos.x), Math.round(cur.pos.z));
    if (vis) {
      const dist = Math.hypot(vis.x - cur.pos.x, vis.z - cur.pos.z);
      const budgetMs = Math.max(45_000, Math.round((dist / ZEN.maxSpeed) * 2.5) * 1000);
      log(`vista-approach (@ ${Math.round(vis.x)},${Math.round(vis.z)} · ${Math.round(dist)}u · budget ${Math.round(budgetMs / 1000)}s)`);
      const approach = await drive(page, 'vista-approach', { target: vis, budgetMs, done: (z) => z.onSlide });
      all.push(...approach.samples);
      const reached = approach.samples.length ? Math.min(...approach.samples.map((z) => Math.hypot(z.pos.x - vis.x, z.pos.z - vis.z))) : Infinity;
      console.log(`[VALIDATION] vista: closestApproach=${Math.round(reached)}u launched=${approach.done}`);
      expect(approach.done, `catapulted off the vista deck (closest=${Math.round(reached)}u)`).toBe(true);

      // Ride the slide to completion — it's on-rails (the path owns position), so just hold gas and
      // sample; checkSample asserts finiteness every frame through the soar + twist + descent.
      log('sky-slide (riding)');
      const baseY = cur.pos.y;
      const ride = await drive(page, 'sky-slide', { target: null, budgetMs: 30_000, done: (z) => !z.onSlide });
      all.push(...ride.samples);
      const peakY = ride.samples.length ? Math.max(...ride.samples.map((z) => z.pos.y)) : baseY;
      console.log(`[VALIDATION] sky-slide: peakY=${Math.round(peakY)} baseY=${Math.round(baseY)} climbed=${Math.round(peakY - baseY)} landed=${ride.done}`);
      expect(ride.done, 'the sky-slide completed and deposited the car back on the ground (onSlide → false)').toBe(true);
      expect(peakY - baseY, 'the catapult + slide gained real altitude (verticality)').toBeGreaterThan(60);

      // CAMERA-SPIN CANARY (diagnosis #150: the chase camera "spun around" at a ±π heading crossing on
      // the slide — FINITE but violent, so the old sweep passed). Through the WHOLE ride the camera's
      // orbit angle must move smoothly: per-sample shortest-angle Δ stays well under a half-turn (the
      // bug spun ~360° in ~0.5s ≈ a quarter-turn per 120ms sample). Per-frame guarantee: the unit test
      // zen_slide_camera.test.ts; this is the live belt-and-suspenders.
      const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
      let maxCamStep = 0;
      for (let i = 1; i < ride.samples.length; i++) {
        maxCamStep = Math.max(maxCamStep, Math.abs(wrapPi(ride.samples[i].camHeading - ride.samples[i - 1].camHeading)));
      }
      console.log(`[VALIDATION] sky-slide: maxCamHeadingΔ=${Math.round((maxCamStep * 180) / Math.PI)}deg/sample`);
      expect(maxCamStep, 'the slide camera does not spin (no ±π-wrap orbit)').toBeLessThan(1.2);
    } else {
      log('vista-skip (none in range — not a failure)');
    }
    heaps.push(await heapMB());

    // --- SOAK-WIDE ASSERTIONS ---
    log('assert');
    expect(all.length, 'collected a substantial number of live samples').toBeGreaterThan(80);

    // Liveness / no stall: the rendered-frame counter advanced monotonically across the whole soak.
    const frameEnd = (await readDbg(page))!.frame;
    expect(frameEnd, 'the render loop kept advancing (no stall)').toBeGreaterThan(frame0 + 500);

    // Bounded growth: nothing climbs without bound over the soak (a cull/dispose regression would).
    const maxOf = (k: keyof ZenDbg['counts']) => Math.max(...all.map((z) => z.counts[k]));
    const firstOf = (k: keyof ZenDbg['counts']) => all[0].counts[k];
    expect(maxOf('props'), 'props bounded by the streamed cap').toBeLessThanOrEqual(324);
    for (const k of ['terrainVerts', 'landmarks', 'sceneChildren'] as const) {
      expect(maxOf(k), `${k} bounded (not climbing) — first=${firstOf(k)} max=${maxOf(k)}`).toBeLessThanOrEqual(firstOf(k) * 2 + 64);
    }

    // Bounded heap: loose by design (GC is noisy) — catches a real monotonic leak, tolerates churn.
    const heapMax = Math.max(...heaps);
    expect(heapMax, `heap bounded over the soak (samples MB: ${heaps.map((h) => h.toFixed(0)).join(',')})`).toBeLessThan(heaps[0] * 2.5 + 120);

    // No error storm (minus the §4 allowlist).
    const bad = unexpected(errors);
    expect(bad, `unexpected console errors during the soak:\n${bad.join('\n')}`).toEqual([]);
  });
});
