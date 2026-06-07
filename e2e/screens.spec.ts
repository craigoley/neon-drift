import { expect, test, type Page } from '@playwright/test';
import { assertButtonsLabelled, invisibleTextIn, trackErrors } from './_helpers';

/**
 * PHASE 2 — post-run screen states via the DEV-only ?screen= hook (main.ts).
 *
 * #76 flagged the WIPEOUT placement / chase-target / daily-result / unlock variants
 * as unreachable deterministically (they only appear after specific run outcomes).
 * The ?screen= hook boots straight into each with known fixture data so we can
 * DOM-assert them. The hook is gated by import.meta.env.DEV — present under the e2e
 * dev server, dead-code-eliminated from the production `vite build` (confirmed by
 * grepping the built bundle for the fixture names — see the report). CANVAS WALL:
 * still DOM-only; no in-scene assertions.
 */

async function bootScreen(page: Page, screen: string): Promise<void> {
  await page.goto(`/?screen=${screen}`);
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30_000 });
  await expect(page.locator('.shell-crash')).toBeVisible();
}

/** Common health checks for any WIPEOUT variant. */
async function assertCrashHealthy(page: Page): Promise<void> {
  await expect(page.locator('.shell-crash .shell-title')).toHaveText('WIPEOUT');
  await expect(page.locator('.shell-crash-score')).not.toHaveText('');
  await expect(page.locator('.shell-crash-best')).not.toHaveText('');
  for (const sel of ['.shell-play-again', '.shell-crash .shell-menu', '.shell-crash .shell-share']) {
    await expect(page.locator(sel)).toBeVisible();
  }
  await assertButtonsLabelled(page, '.shell-crash');
  expect(await invisibleTextIn(page, '.shell-crash'), 'no invisible text on WIPEOUT').toEqual([]);
}

test('wipeout: board placement + chase target render correctly', async ({ page }) => {
  const errors = trackErrors(page);
  await bootScreen(page, 'wipeout-rank');
  await assertCrashHealthy(page);
  await expect(page.locator('.shell-crash-placement')).toHaveText('NEW #3!');
  await expect(page.locator('.shell-crash-target')).toContainText('1,200');
  await expect(page.locator('.shell-crash-target')).toContainText('#2');
  expect(errors).toEqual([]);
});

test('wipeout: NEW BEST! (rank #1) renders', async ({ page }) => {
  const errors = trackErrors(page);
  await bootScreen(page, 'wipeout-best');
  await assertCrashHealthy(page);
  await expect(page.locator('.shell-crash-placement')).toHaveText('NEW BEST!');
  expect(errors).toEqual([]);
});

test('wipeout: per-car best callout (no board rank) renders', async ({ page }) => {
  const errors = trackErrors(page);
  await bootScreen(page, 'wipeout-carbest');
  await assertCrashHealthy(page);
  await expect(page.locator('.shell-crash-placement')).toContainText('BEST IN NOVA');
  expect(errors).toEqual([]);
});

test('wipeout: unlock + mission/rank celebration lines render', async ({ page }) => {
  const errors = trackErrors(page);
  await bootScreen(page, 'wipeout-unlock');
  await assertCrashHealthy(page);
  await expect(page.locator('.shell-crash-unlock')).toContainText('UNLOCKED: Nova');
  const missionLines = page.locator('.shell-crash-missions .shell-crash-mission-line');
  await expect(missionLines).toHaveCount(3);
  await expect(missionLines.first()).toContainText('MISSION COMPLETE');
  expect(errors).toEqual([]);
});

test('wipeout: daily-result card renders (DAILY BEST + today line)', async ({ page }) => {
  const errors = trackErrors(page);
  await bootScreen(page, 'wipeout-daily');
  await assertCrashHealthy(page);
  await expect(page.locator('.shell-crash-placement')).toHaveText('DAILY BEST!');
  await expect(page.locator('.shell-crash-best')).toContainText('today'); // daily best, not all-time
  expect(errors).toEqual([]);
});
