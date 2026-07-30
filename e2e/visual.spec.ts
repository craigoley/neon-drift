import { expect, test, type Page } from '@playwright/test';
import { boot, trackErrors } from './_helpers';

/**
 * PHASE 1 — VISUAL REGRESSION BASELINES for every non-canvas screen.
 *
 * THE CANVAS WALL: these snapshots HIDE the <canvas>, so they compare ONLY the DOM
 * overlay (menus/screens/text). That removes WebGL/GPU/per-frame variance entirely
 * — the baseline catches DOM layout/color regressions (floating-DAILY, cyan-on-cyan,
 * clipped text), NOT anything rendered in the scene. Nothing here tests gameplay.
 *
 * WHY HIDE AND NOT MASK: this used to pass `mask: [page.locator('canvas')]`. But the
 * game canvas IS the full viewport (measured: 1280x720 at 0,0), and Playwright paints
 * a mask as an opaque #FF00FF box OVER the captured area — so the mask covered the
 * whole page, including the very DOM overlay this spec exists to check. Every baseline
 * came out as the same solid-magenta rectangle: 9 screens, ONE distinct image (single
 * MD5, 4254 bytes each). The suite asserted nothing for its entire life, and the
 * "restyles stayed under the 0.1 tolerance" history was really two identical blank
 * rectangles comparing equal. `visibility: hidden` instead keeps layout intact (unlike
 * `display: none`) so the overlay renders exactly where it normally does, over a plain
 * background — same WebGL-variance removal, but the DOM is actually visible.
 *
 * PLATFORM BASELINES: snapshots are per-OS. Generate them ON THE LINUX CI RUNNER,
 * not locally — a Mac (-darwin) baseline never matches CI (-linux). Run the
 * `Visual baselines (regenerate)` workflow (workflow_dispatch), download its
 * `visual-baselines-linux` artifact, extract it over `e2e/`, and commit the PNGs.
 * Dev (-darwin) baselines are gitignored and must NOT be the committed source of
 * truth. Locally: `npx playwright test visual.spec.ts --update-snapshots` to author.
 *
 * Do NOT rely on a normal failing run to produce them: until the regen workflow
 * existed there was no way to retrieve the baselines Playwright wrote on CI, so they
 * were never committed and every spec here failed with "A snapshot doesn't exist".
 *
 * The load-bearing checks remain the machine-independent ones (screen visible, zero
 * console errors); the pixel baseline is the secondary catch for gross breakage.
 */

/** Tolerance sized from MEASUREMENT, not habit. The old 0.1 (10% of pixels) could not
 *  fail on any localised change: recolouring .shell-tagline shifts 2616 px = ratio 0.01,
 *  so 0.1 passed it happily. With the canvas hidden the DOM render is deterministic —
 *  two back-to-back local runs matched at EXACT equality (zero differing pixels) — so a
 *  0.001 (921 px) budget still absorbs incidental text anti-aliasing while catching that
 *  same regression with ~2.8x margin. Verified both ways: 0.001 fails on the recolour,
 *  passes clean. */
const SHOT_OPTS = { maxDiffPixelRatio: 0.001 };

/** `visibility: hidden` (not `display: none`) so the canvas keeps its box and the DOM
 *  overlay's layout is identical to a normal run. `!important` beats the `#app canvas`
 *  rule in src/style.css. */
const HIDE_CANVAS_CSS = 'canvas { visibility: hidden !important; }';

async function baseline(page: Page, name: string, screenSel: string): Promise<void> {
  await expect(page.locator(screenSel)).toBeVisible();
  await page.addStyleTag({ content: HIDE_CANVAS_CSS });
  await expect(page).toHaveScreenshot(`${name}.png`, SHOT_OPTS);
}

test('start menu baseline', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await baseline(page, 'start', '.shell-start');
  expect(errors).toEqual([]);
});

test('car picker baselines (two cars)', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await page.locator('.shell-cars').click();
  await baseline(page, 'carpicker-car1', '.shell-carpicker');
  await page.locator('.shell-next').click();
  await page.locator('.shell-next').click(); // a different car silhouette + stat bars
  await baseline(page, 'carpicker-car3', '.shell-carpicker');
  expect(errors).toEqual([]);
});

test('missions / settings / scores / daily baselines', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  for (const [open, container, name] of [
    ['.shell-missions-open', '.shell-missions', 'missions'],
    ['.shell-settings-open', '.shell-settings', 'settings'],
    ['.shell-leaderboard-open', '.shell-leaderboard', 'scores-empty'],
    ['.shell-daily-open', '.shell-daily', 'daily'],
  ] as const) {
    await page.locator(open).click();
    await baseline(page, name, container);
    // close back to start (each screen's close button returns to start)
    await page.locator(`${container} [class*="shell-close"], ${container} .shell-close`).first().click();
    await expect(page.locator('.shell-start')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('pause overlay baseline', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await page.locator('.shell-play').click();
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('playing'))).toBe(true);
  await page.locator('.shell-pause-btn').click();
  await baseline(page, 'pause', '.shell-pause');
  expect(errors).toEqual([]);
});

test('wipeout screen baseline (real seed-21 crash)', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page, 21); // straight no-input run crashes at ~3s (deterministic, see #76)
  await page.locator('.shell-play').click();
  await expect(page.locator('.shell-crash')).toBeVisible({ timeout: 20_000 });
  await baseline(page, 'wipeout', '.shell-crash');
  expect(errors).toEqual([]);
});
