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
import { ZEN, ZEN_LANDMARK, ZEN_SECRET } from '../src/utils/constants';
import { landmarksInRadius, tunnelBendShape, LANDMARK_GATEWAY, LANDMARK_TUNNEL, LANDMARK_VISTA } from '../src/zen/ZenLandmarkModel';
import { findReturnPortal } from '../src/zen/ZenSecret';

/** A placed landmark (tunnel / gateway) as landmarksInRadius returns it — the bits the autopilot needs. */
interface Placed { x: number; z: number; rotationY: number; scale: number }

// --- POST-#164 TUNNEL GEOMETRY (pure, mirrors ZenTunnelPayoff.coveringTunnel) so the autopilot can
// FOLLOW the tunnel's BENT centreline through the deep point (#199). A straight-line drive leaves the
// ~32u corridor on the bend, so `along` never flips sign on consecutive in-corridor frames and the
// payoff warp can't fire (the #198 finding). Following the centreline keeps the car in-corridor →
// `along` crosses 0 cleanly → the warp fires. All read-only maths from readable state; NO game change.
const tunAxis = (t: Placed) => ({ tx: Math.sin(t.rotationY), tz: Math.cos(t.rotationY) });
const tunHalfL = (t: Placed) => ZEN_LANDMARK.tunnelLength * t.scale * 0.5;
/** The bent centreline point at axial position `s` (0 = deep centre, ±halfL = mouths). */
function tunnelCentreline(t: Placed, s: number): { x: number; z: number } {
  const { tx, tz } = tunAxis(t);
  const bendOff = ZEN_LANDMARK.tunnelBendAmplitude * t.scale * tunnelBendShape(s / tunHalfL(t));
  return { x: t.x + s * tx - bendOff * tz, z: t.z + s * tz + bendOff * tx };
}
/** The car's signed axial position along the tunnel (projection onto the through-axis). */
const carAlong = (t: Placed, x: number, z: number) => {
  const { tx, tz } = tunAxis(t);
  return (x - t.x) * tx + (z - t.z) * tz;
};

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
  /** True once the tunnel DEEP-POINT payoff warp has fired → the car is in the hidden amber cave (#164). */
  inTunnelSpace: boolean;
  hasSaved: boolean;
  onSlide: boolean;
  slideU: number;
  onSurface: boolean;
  camHeading: number;
  biome: { from: number; to: number; blend: number };
  counts: { props: number; terrainVerts: number; landmarks: number; sceneChildren: number };
}
interface Dbg { mode: string; frame: number; seed: number; zen?: ZenDbg }

// Zen now picks a RANDOM world per entry; the soak PINS it via the `?seed=${SEED}` boot below so the
// world (and the landmark/portal lookups keyed to SEED) stays deterministic — the canary never goes
// flaky from a random world. ZEN.worldSeed is the canonical pinned world.
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
  opts: {
    /** A FIXED point, or a PER-FRAME target (for path-following, e.g. the tunnel's bent centreline). */
    target?: { x: number; z: number } | ((z: ZenDbg) => { x: number; z: number }) | null;
    budgetMs: number;
    done?: (z: ZenDbg) => boolean;
    stepMs?: number;
  },
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
        const tgt = typeof opts.target === 'function' ? opts.target(z) : opts.target;
        if (tgt) {
          const dx = tgt.x - z.pos.x;
          const dz = tgt.z - z.pos.z;
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

    // --- PHASE 3: warp BACK. The car ARRIVES at the return portal's arrival pose (arrivalPose), facing
    // AWAY into the region, with the BOUNCE GUARD armed from that spot (guardDist = returnGuardDistance).
    // A crossing only re-enables once the car has driven guardDist CLEAR of the arrival point — so a
    // straight beeline back at the portal never clears the guard and the crossing stays gated (the
    // Phase-3 flake, #199). Route it: (a) drive CLEAR of the guard, then (b) turn back + cross the portal. ---
    const portal = findReturnPortal(SEED);
    log(`warp-back (return portal @ ${Math.round(portal.x)},${Math.round(portal.z)})`);
    const arrival = { x: inSec.pos.x, z: inSec.pos.z }; // where we landed = the guard centre
    const clearDist = ZEN_SECRET.returnGuardDistance + 60; // clear the guard with margin
    // (a) Drive AWAY from the portal (its arrival heading already faces away) until guardDist is cleared.
    const awayDir = { x: arrival.x - portal.x, z: arrival.z - portal.z };
    const awayMag = Math.hypot(awayDir.x, awayDir.z) || 1;
    const awayPoint = { x: arrival.x + (awayDir.x / awayMag) * (clearDist + 120), z: arrival.z + (awayDir.z / awayMag) * (clearDist + 120) };
    const clear = await drive(page, 'warp-back-clear', {
      target: awayPoint,
      budgetMs: 25_000,
      done: (z) => Math.hypot(z.pos.x - arrival.x, z.pos.z - arrival.z) > clearDist,
    });
    all.push(...clear.samples);
    expect(clear.done, `drove clear of the bounce guard (>${clearDist}u from arrival)`).toBe(true);
    // (b) Turn back and cross the portal opening → leave the secret area.
    const back = await drive(page, 'warp-back', { target: { x: portal.x, z: portal.z }, budgetMs: 40_000, done: (z) => !z.inSecret });
    all.push(...back.samples);
    expect(back.done, 'crossed the return portal → left the secret area (inSecret false)').toBe(true);
    await page.waitForFunction(() => (window as unknown as { __neonDebug?: Dbg }).__neonDebug?.zen?.warpPhase === 'none', null, { timeout: 8_000 });
    const home = (await readDbg(page))!.zen!;
    checkSample(home, 'returned');
    expect(Math.abs(home.pos.x), 'restored to the main world (near origin), not stuck far').toBeLessThan(50_000);
    heaps.push(await heapMB());

    // --- PHASE 4: drive to the NEAREST tunnel and FOLLOW its bent corridor through the deep point → the
    // payoff WARP. POST-#164 the tunnel is a DESCEND → WARP payoff (the drive-through-and-resurface mechanic
    // + the drivable basin were REMOVED): you descend to the deep point and WARP into the segregated amber
    // cave. #198 could only OBSERVE the warp because a straight-line drive leaves the ~32u corridor on the
    // bend, so `along` never flips sign on consecutive in-corridor frames and the warp can't fire. Here the
    // autopilot FOLLOWS the tunnel's BENT centreline (tunnelCentreline, the same pure geometry
    // coveringTunnel uses), holding the corridor across the centre → `along` crosses 0 cleanly → the warp
    // fires (verified: in-corridor for the whole descent, 0 out-of-corridor frames). That promotes the
    // warp to a HARD assert — the real post-#164 descend→warp→cave. The per-frame tube-floor smoothness
    // stays guarded by the unit test zen_tunnel_smooth (21/21), so the soak doesn't duplicate it. ---
    const tun = nearestOfType(LANDMARK_TUNNEL, Math.round(home.pos.x), Math.round(home.pos.z));
    if (tun) {
      const dist = Math.hypot(tun.x - home.pos.x, tun.z - home.pos.z);
      const hL = tunHalfL(tun);
      // Enter via the MOUTH nearer to `home`, then follow the centreline toward the FAR mouth (through 0).
      const mPlus = tunnelCentreline(tun, +hL);
      const mMinus = tunnelCentreline(tun, -hL);
      const entrySign =
        Math.hypot(mPlus.x - home.pos.x, mPlus.z - home.pos.z) < Math.hypot(mMinus.x - home.pos.x, mMinus.z - home.pos.z) ? +1 : -1;
      const budgetMs = Math.max(45_000, Math.round((dist / ZEN.maxSpeed) * 2.5) * 1000);
      log(`tunnel (@ ${Math.round(tun.x)},${Math.round(tun.z)} · ${Math.round(dist)}u · entry ${entrySign > 0 ? '+' : '-'}mouth · budget ${Math.round(budgetMs / 1000)}s)`);
      // (a) Approach a staging point just OUTSIDE the entry mouth (lined up with the axis).
      const stage = tunnelCentreline(tun, entrySign * hL * 1.25);
      const approach = await drive(page, 'tunnel-approach', {
        target: stage,
        budgetMs,
        done: (z) => Math.hypot(z.pos.x - stage.x, z.pos.z - stage.z) < 70 || z.inTunnelSpace,
      });
      all.push(...approach.samples);
      // (b) FOLLOW the bent centreline toward the far mouth — aim a lookahead point DOWN the tube each
      // frame, so the car holds the corridor across the deep point and the warp fires.
      const LOOK = 60;
      const follow = await drive(page, 'tunnel', {
        target: (z) => tunnelCentreline(tun, carAlong(tun, z.pos.x, z.pos.z) - entrySign * LOOK),
        budgetMs: 40_000,
        done: (z) => z.inTunnelSpace,
        stepMs: 90,
      });
      all.push(...follow.samples);
      const traversal = [...approach.samples, ...follow.samples];
      const minY = traversal.length ? Math.min(...traversal.map((z) => z.pos.y)) : NaN;
      const descended = traversal.some((z) => z.pos.y < -15); // #198: genuinely into the sub-surface tube
      const last = follow.samples.length ? follow.samples[follow.samples.length - 1] : null;
      console.log(`[VALIDATION] tunnel: warpedToCave=${follow.done} descended=${descended} minY=${minY.toFixed(1)} lastPos=(${last ? Math.round(last.pos.x) : '?'},${last ? Math.round(last.pos.z) : '?'})`);
      // HARD asserts (#199): following the tunnel DESCENDS it (a real sub-surface tube) AND fires the
      // payoff WARP into the cave — the full post-#164 descend → warp → cave.
      expect(descended, `descended into the sub-surface tunnel tube (minY=${minY.toFixed(1)}, expected < −15)`).toBe(true);
      expect(follow.done, `followed the tunnel → payoff WARP fired into the hidden cave (inTunnelSpace; minY=${minY.toFixed(1)})`).toBe(true);
      expect(last, 'a live sample at cave arrival').not.toBeNull();
      // The warp teleports to the FAR segregated cave region (same pattern as the secret-area warp).
      expect(Math.abs(last!.pos.x) > 100_000 || Math.abs(last!.pos.z) > 100_000, 'warped to the far cave region').toBe(true);
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
