import { expect, test, type Page } from '@playwright/test';
import { boot, trackErrors } from './_helpers';

/**
 * PHASE 1 — VISUAL REGRESSION BASELINES for every non-canvas screen.
 *
 * THE CANVAS WALL: these snapshots MASK the <canvas>, so they compare ONLY the DOM
 * overlay (menus/screens/text). That removes WebGL/GPU/per-frame variance entirely
 * — the baseline catches DOM layout/color regressions (floating-DAILY, cyan-on-cyan,
 * clipped text), NOT anything rendered in the scene. Nothing here tests gameplay.
 *
 * PLATFORM BASELINES: snapshots are per-OS. Generate them ON THE LINUX CI RUNNER,
 * not locally — a Mac (-darwin) baseline never matches CI (-linux). The FIRST CI run
 * writes the -linux baselines and FAILS (expected); commit those, green thereafter.
 * Dev (-darwin) baselines are gitignored and must NOT be the committed source of
 * truth. Locally: `npx playwright test visual.spec.ts --update-snapshots` to author.
 *
 * The load-bearing checks remain the machine-independent ones (screen visible, zero
 * console errors); the pixel baseline is the secondary catch for gross breakage.
 */

const MASK_CANVAS = (page: Page) => ({ mask: [page.locator('canvas')], maxDiffPixelRatio: 0.1 });

async function baseline(page: Page, name: string, screenSel: string): Promise<void> {
  await expect(page.locator(screenSel)).toBeVisible();
  await expect(page).toHaveScreenshot(`${name}.png`, MASK_CANVAS(page));
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
