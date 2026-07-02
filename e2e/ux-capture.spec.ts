/**
 * UX SCREENSHOT CAPTURE — a vision-critique harness that photographs every
 * player-reachable UI state at phone + desktop viewports and writes them (plus a
 * manifest of how each was reached) to ux-critique/<UTC-timestamp>/.
 *
 * This is a CAPTURE-ONLY script in the capture-og.spec.ts mould: it READS the
 * running game (boots at pinned seeds, walks the real menus, drives Zen with the
 * OG capture's closed-loop steer) and writes PNGs. It does NOT modify any game/
 * engine/HUD code, and — unlike the OG hero shot — the HUD stays VISIBLE in the
 * gameplay frames, because the HUD is part of what's being critiqued.
 *
 * TWO input surfaces are captured (audit #191, H1):
 *   - DESKTOP / NON-TOUCH — the default context (no hasTouch), at 390 + 1440.
 *     Keyboard copy, no on-screen touch controls.
 *   - TOUCH / MOBILE — a hasTouch+isMobile context at 390×844 (`390x844-touch`),
 *     so the ACTUAL mobile input surface is audited: the racing SLOW-MO button,
 *     Zen GAS/BRAKE, the touch hint copy (`drag to steer …`). Without this, every
 *     captured frame showed keyboard UI and the whole touch surface went unseen.
 *
 * WHY the touch context works: the game computes `isTouch` ONCE at page load
 * (src/main.ts) as `matchMedia('(pointer: coarse)').matches || 'ontouchstart' in
 * window`. Playwright's `hasTouch:true` puts `ontouchstart` on `window` and
 * `isMobile:true` reports `pointer:coarse`, so the game enters its touch branch.
 * The walk still DRIVES via keyboard (always attached, main.ts) — synthetic touch
 * isn't needed to make the controls RENDER, which is what we're auditing. The
 * touch test hard-asserts the touch surface actually appeared (the `if (touch)`
 * VALIDITY GATE blocks in captureWalk) so a mis-emulated context fails loudly
 * instead of shipping keyboard UI under a "touch" label.
 *
 * ON DEMAND ONLY: gated on UX_CAPTURE=1 so `npm run e2e` / CI never runs it
 * (it's slow and its output is a local critique artifact, not a test result).
 * Run:  npm run ux:capture
 * Run with --workers=1 (the npm script does): the timestamped output dir is
 * module-level state, so a single worker keeps the whole run in ONE folder.
 *
 * Determinism: gameplay boots use FIXED seeds — ?seed= pins the run course and
 * the Zen world (see main.ts urlSeed). Seed 123 survives a straight no-input
 * run for ~18s (verified headlessly in L1), so the racing burst at ~2s is safely
 * mid-run; seed 21 crashes a straight run at ~3s (same trick as crash.spec.ts),
 * which is how the WIPEOUT screen is reached with no product hook.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boot } from './_helpers';
import { ZEN } from '../src/utils/constants';
import {
  landmarksInRadius,
  LANDMARK_ARCH,
  LANDMARK_VISTA,
  LANDMARK_TUNNEL,
} from '../src/zen/ZenLandmarkModel';

const RUN_SEED = 123; // straight run survives ~18s — burst at ~2s is mid-run
const CRASH_SEED = 21; // straight run crashes at ~3s (see e2e/crash.spec.ts)
const ZEN_SEED = ZEN.worldSeed; // the canonical Zen world (same as the OG capture)

// One output folder per run. Module-level so every viewport/variant test shares
// it under --workers=1 (a single worker process imports this module once).
const STAMP = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
const OUT_ROOT = join('ux-critique', STAMP);

// The game is PORTRAIT on mobile (manifest.webmanifest pins "orientation":
// "portrait"; the CSS is mobile-portrait-first) — so no mobile-landscape
// variants. Desktop plays at whatever the window is; 1440×900 covers landscape.
const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '1440x900', width: 1440, height: 900 },
] as const;

// TOUCH context: a real hasTouch+isMobile emulation at phone width, so the game's
// page-load `isTouch` detection flips on (see the file header). A realistic mobile
// UA is included for completeness — the detection keys off pointer/touch, not UA.
const TOUCH_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const TOUCH_CONTEXT = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  userAgent: TOUCH_UA,
} as const;

interface ManifestEntry {
  state: string;
  viewport: string;
  seed: number | null;
  files: string[];
  how: string;
}

interface ZenDbg {
  pos: { x: number; y: number; z: number };
  heading: number;
  speed: number;
}
interface Dbg {
  mode: string;
  zen?: ZenDbg;
}
const readDebug = (page: Page) =>
  page.evaluate(() => (window as unknown as { __neonDebug?: Dbg }).__neonDebug ?? null);

/** Screenshot the viewport (the game is a fixed full-viewport layout — this IS
 *  the full page; fullPage-scrolling has nothing extra to reveal). */
async function shot(page: Page, entries: ManifestEntry[], e: Omit<ManifestEntry, 'files'>): Promise<void> {
  const file = `${e.state}--${e.viewport}.png`;
  await page.screenshot({ path: join(OUT_ROOT, file) });
  entries.push({ ...e, files: [file] });
}

/** Gameplay burst: 6 frames at ~200ms intervals (motion, HUD visible). */
async function burst(page: Page, entries: ManifestEntry[], e: Omit<ManifestEntry, 'files'>): Promise<void> {
  const files: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const file = `${e.state}--${e.viewport}--f${i}.png`;
    await page.screenshot({ path: join(OUT_ROOT, file) });
    files.push(file);
    if (i < 6) await page.waitForTimeout(200);
  }
  entries.push({ ...e, files });
}

/** Append this test's entries into the shared manifest (serial under --workers=1). */
function writeManifest(entries: ManifestEntry[]): void {
  const path = join(OUT_ROOT, 'manifest.json');
  // Read-then-catch rather than existsSync-then-read: avoids the check-then-use
  // filesystem race CodeQL flags, and ENOENT (no prior manifest — first viewport
  // of the run) just means we start fresh.
  let prior: ManifestEntry[] = [];
  try {
    prior = JSON.parse(readFileSync(path, 'utf8')) as ManifestEntry[];
  } catch {
    /* no prior manifest yet — start a new array */
  }
  writeFileSync(path, JSON.stringify([...prior, ...entries], null, 2));
}

/**
 * Walk every player-reachable UI state and capture it. Shared by the desktop and
 * touch variants — the ONLY difference is the browser context (touch emulation)
 * and, in touch mode, extra hard-assertions that the touch surface really rendered
 * (VALIDITY — don't ship keyboard UI under a "touch" label).
 */
async function captureWalk(page: Page, vpName: string, touch: boolean): Promise<void> {
  const entries: ManifestEntry[] = [];

  // --- shell / menu states (all reachable from the start screen) ----------
  await boot(page, RUN_SEED);

  if (touch) {
    // VALIDITY GATE 1 — record the raw detection signals + prove the game took its
    // touch branch (start hint = touch copy). If this fails, the context did NOT
    // trigger `isTouch`, so every downstream "touch" frame is a lie — fail here.
    const sig = await page.evaluate(() => ({
      coarse: window.matchMedia('(pointer: coarse)').matches,
      ontouchstart: 'ontouchstart' in window,
      maxTouchPoints: navigator.maxTouchPoints,
    }));
    entries.push({
      state: 'touch-signals',
      viewport: vpName,
      seed: null,
      files: [],
      how: `game isTouch inputs — pointer:coarse=${sig.coarse}, 'ontouchstart' in window=${sig.ontouchstart}, navigator.maxTouchPoints=${sig.maxTouchPoints}`,
    });
    await expect(
      page.locator('.shell-start'),
      'TOUCH VALIDITY: start hint must be the touch copy ("drag to steer"), proving the game computed isTouch=true',
    ).toContainText('drag to steer');
  }

  await shot(page, entries, { state: 'start', viewport: vpName, seed: RUN_SEED, how: 'boot /?seed=123 → .shell-start' });

  await page.locator('.shell-settings-open').click();
  await expect(page.locator('.shell-settings')).toBeVisible();
  await shot(page, entries, { state: 'settings', viewport: vpName, seed: RUN_SEED, how: 'start → .shell-settings-open' });
  await page.locator('.shell-settings .shell-close').click();

  await page.locator('.shell-cars').click();
  await expect(page.locator('.shell-carpicker')).toBeVisible();
  await page.waitForTimeout(500); // let the 3D car preview mount + render
  await shot(page, entries, { state: 'carpicker', viewport: vpName, seed: RUN_SEED, how: 'start → .shell-cars (3D preview given 500ms to render)' });
  await page.locator('.shell-carpicker .shell-close').click();

  await page.locator('.shell-missions-open').click();
  await expect(page.locator('.shell-missions')).toBeVisible();
  await shot(page, entries, { state: 'missions', viewport: vpName, seed: RUN_SEED, how: 'start → .shell-missions-open' });
  await page.locator('.shell-close-missions').click();

  await page.locator('.shell-store-open').click();
  await expect(page.locator('.shell-store')).toBeVisible();
  await page.waitForTimeout(500); // let the live cosmetic preview mount + render
  await shot(page, entries, { state: 'store', viewport: vpName, seed: RUN_SEED, how: 'start → .shell-store-open (fresh profile: starter car owned, rest priced)' });
  await page.locator('.shell-back-store').click();

  await page.locator('.shell-daily-open').click();
  await expect(page.locator('.shell-daily')).toBeVisible();
  await shot(page, entries, { state: 'daily', viewport: vpName, seed: RUN_SEED, how: 'start → .shell-daily-open (fresh profile: "not played yet" state)' });
  await page.locator('.shell-close-daily').click();

  // vs COMPUTER difficulty picker (EASY / MEDIUM / HARD). H2: post-#192 there must
  // be NO live touch run-control (SLOW-MO / pause) behind this modal.
  await page.locator('.shell-vscpu-open').click();
  await expect(page.locator('.bot-race-ui')).toBeVisible();
  await shot(page, entries, { state: 'vscpu-difficulty', viewport: vpName, seed: RUN_SEED, how: 'start → .shell-vscpu-open → .bot-race-ui picker' });
  if (touch) {
    // H2 CONFIRMATION: the #192 fix routes the menu through hideForExternal(), so
    // body.playing is OFF here → the touch SLOW-MO + pause controls stay display:none.
    expect(
      await page.evaluate(() => document.body.classList.contains('playing')),
      'H2: body.playing must be OFF during the vs-CPU picker (no ghost run-control)',
    ).toBe(false);
    await expect(page.locator('.touch-slowmo')).toBeHidden();
    await expect(page.locator('.shell-pause-btn')).toBeHidden();
  }
  await page.locator('.bot-race-ui').getByRole('button', { name: 'BACK' }).click();
  await expect(page.locator('.shell-start')).toBeVisible();

  // 2P RACE host/join overlay (the multiplayer code screen — the join-code
  // input is on this same overlay, per e2e/mp_race.spec.ts).
  await page.locator('.shell-mp-open').click();
  await expect(page.locator('.mp-race-ui')).toBeVisible();
  await shot(page, entries, { state: 'mp-race', viewport: vpName, seed: RUN_SEED, how: 'start → .shell-mp-open → .mp-race-ui (HOST/JOIN + code input)' });
  if (touch) {
    // H2 CONFIRMATION (2P lobby): same as the vs-CPU picker.
    expect(
      await page.evaluate(() => document.body.classList.contains('playing')),
      'H2: body.playing must be OFF during the 2P lobby (no ghost run-control)',
    ).toBe(false);
    await expect(page.locator('.touch-slowmo')).toBeHidden();
    await expect(page.locator('.shell-pause-btn')).toBeHidden();
  }
  await page.locator('.mp-race-ui').getByRole('button', { name: 'BACK' }).click();
  await expect(page.locator('.shell-start')).toBeVisible();

  // --- racing gameplay + pause (one run, HUD visible) ----------------------
  await page.locator('.shell-play').click();
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('playing'))).toBe(true);
  await page.waitForTimeout(2000); // speed builds; seed 123 survives ~18s straight
  if (touch) {
    // VALIDITY GATE 2 — H1's core: the racing touch surface (the SLOW-MO button)
    // must be RENDERED in-run. This is the exact frame that used to be blind.
    await expect(
      page.locator('.touch-slowmo'),
      'TOUCH VALIDITY: the racing SLOW-MO button must render in-run (H1 core gap)',
    ).toBeVisible();
  }
  await burst(page, entries, { state: 'racing', viewport: vpName, seed: RUN_SEED, how: 'PLAY on /?seed=123, no input (auto-drives), burst from ~2s — 6 frames @ ~200ms, HUD visible' });
  const modeAfterBurst = (await readDebug(page))?.mode;
  expect(modeAfterBurst, 'racing burst stayed in-run (did not crash mid-burst)').toBe('playing');

  await page.keyboard.press('Escape');
  await expect(page.locator('.shell-pause')).toBeVisible();
  await shot(page, entries, { state: 'pause', viewport: vpName, seed: RUN_SEED, how: 'mid-run Escape → .shell-pause overlay (F10: hint copy is NOT touch-branched)' });
  await page.locator('.shell-quit').click();
  await expect(page.locator('.shell-start')).toBeVisible();

  // --- game over (real crash) + the leaderboard it populates ---------------
  await boot(page, CRASH_SEED);
  await page.locator('.shell-play').click();
  await expect(page.locator('.shell-crash')).toBeVisible({ timeout: 20_000 });
  await shot(page, entries, { state: 'gameover', viewport: vpName, seed: CRASH_SEED, how: 'PLAY on /?seed=21 — straight run hits the seeded obstacle at ~3s (crash.spec.ts pattern)' });

  await page.locator('.shell-crash .shell-menu').click();
  await expect(page.locator('.shell-start')).toBeVisible();
  await page.locator('.shell-leaderboard-open').click();
  await expect(page.locator('.shell-leaderboard')).toBeVisible();
  await shot(page, entries, { state: 'scores', viewport: vpName, seed: CRASH_SEED, how: 'crash → MENU → .shell-leaderboard-open (populated by the seed-21 run)' });
  await page.locator('.shell-close-leaderboard').click();

  // Richest WIPEOUT variant (placement + chase target + unlock + mission
  // lines) via the DEV-only ?screen= fixture hook (screens.spec.ts pattern).
  await page.goto('/?screen=wipeout-unlock');
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30_000 });
  await expect(page.locator('.shell-crash')).toBeVisible();
  await shot(page, entries, { state: 'gameover-unlock', viewport: vpName, seed: null, how: 'DEV-only /?screen=wipeout-unlock fixture (fullest WIPEOUT: rank + target + unlock + missions)' });

  // MP connection-test overlay (URL-only entry; DOM mount per e2e/mp.spec.ts).
  await page.goto('/?mp=1');
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30_000 });
  await expect(page.locator('.mp-test')).toBeVisible();
  await shot(page, entries, { state: 'mp-connection-test', viewport: vpName, seed: null, how: '/?mp=1 → .mp-test overlay (URL-only entry)' });

  // --- Zen free-roam gameplay (HUD/overlay VISIBLE, unlike the OG shot) ----
  await boot(page, ZEN_SEED);
  await page.locator('.shell-zen-open').click();
  await page.waitForFunction(
    () => (window as unknown as { __neonDebug?: { mode: string } }).__neonDebug?.mode === 'zen',
    null,
    { timeout: 15_000 },
  );
  await expect(page.locator('.zen-overlay')).toBeVisible();
  if (touch) {
    // VALIDITY GATE 3 — the Zen touch surface: GAS + BRAKE hold-buttons only exist
    // when the session was built with isTouch=true.
    await expect(
      page.locator('.zen-overlay button', { hasText: 'GAS' }),
      'TOUCH VALIDITY: Zen GAS button must render (isTouch session)',
    ).toBeVisible();
    await expect(page.locator('.zen-overlay button', { hasText: 'BRAKE' })).toBeVisible();
  }

  // Drive a beat toward the nearest big landmark (the OG capture's closed-loop
  // steer) so the frames have a subject, then burst while STILL driving. Keyboard
  // drives even in the touch context (main.ts attaches keyboard unconditionally),
  // so the touch GAS/BRAKE + hint stay on-screen while we steer.
  const spawn = (await readDebug(page))?.zen;
  if (!spawn) throw new Error('no Zen debug snapshot after entering Zen');
  const subject = [LANDMARK_ARCH, LANDMARK_VISTA, LANDMARK_TUNNEL]
    .flatMap((t) => landmarksInRadius(ZEN_SEED, spawn.pos.x, spawn.pos.z, 16000).filter((l) => l.type === t))
    .sort(
      (a, b) =>
        Math.hypot(a.x - spawn.pos.x, a.z - spawn.pos.z) - Math.hypot(b.x - spawn.pos.x, b.z - spawn.pos.z),
    )[0];

  let steering: 'ArrowLeft' | 'ArrowRight' | null = null;
  await page.keyboard.down('ArrowUp');
  try {
    const start = Date.now();
    while (Date.now() - start < 10_000) {
      const z = (await readDebug(page))?.zen;
      if (z && subject) {
        const dist = Math.hypot(subject.x - z.pos.x, subject.z - z.pos.z);
        if (dist < 800) break; // landmark looming on the horizon — good frame
        const desired = Math.atan2(subject.x - z.pos.x, -(subject.z - z.pos.z));
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
      await page.waitForTimeout(100);
    }
    if (steering) {
      await page.keyboard.up(steering);
      steering = null;
    }
    // Burst mid-drive (gas still held) so the frames show real motion + HUD.
    await burst(page, entries, { state: 'zen', viewport: vpName, seed: ZEN_SEED, how: `Zen on /?seed=${ZEN_SEED} (pinned world), OG-capture drive toward nearest landmark, burst while driving — HUD visible` });
  } finally {
    if (steering) await page.keyboard.up(steering);
    await page.keyboard.up('ArrowUp');
  }

  writeManifest(entries);
}

test.skip(!process.env.UX_CAPTURE, 'on-demand UX capture — run via `npm run ux:capture`');

// DESKTOP / NON-TOUCH variants (unchanged surface: keyboard copy, no touch controls).
for (const vp of VIEWPORTS) {
  test(`ux capture @ ${vp.name}`, async ({ page }) => {
    test.setTimeout(300_000); // one test walks every state incl. two gameplay drives
    mkdirSync(OUT_ROOT, { recursive: true });
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await captureWalk(page, vp.name, false);
  });
}

// TOUCH / MOBILE variant (additive — audits the on-screen touch input surface).
test.describe('touch surface', () => {
  test.use(TOUCH_CONTEXT);
  test('ux capture @ 390x844-touch', async ({ page }) => {
    test.setTimeout(300_000);
    mkdirSync(OUT_ROOT, { recursive: true });
    await captureWalk(page, '390x844-touch', true);
  });
});
