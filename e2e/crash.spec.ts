import { expect, test } from '@playwright/test';
import { assertButtonsLabelled, boot, invisibleTextIn, trackErrors } from './_helpers';

/**
 * L2 — the CRASH / WIPEOUT screen and a POPULATED leaderboard. The prior hunt
 * (#75) flagged these as unreachable: they only appear AFTER an in-scene run ends,
 * which needs the car to crash. We close that gap WITHOUT a product hook by using
 * a seed whose straight (no-input) run crashes fast — seed 21 hits the seeded
 * opening obstacle at ~3s (verified headlessly in L1). The car drives itself into
 * it; we never steer (we can't — the canvas is opaque).
 *
 * CANVAS WALL: still no in-scene assertions — only the resulting DOM overlay.
 */

const CRASH_SEED = 21; // straight run crashes at ~177 sim steps (~3s); deterministic

test('a real run crashes → WIPEOUT screen is legible, labelled, and PLAY AGAIN / leaderboard work', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page, CRASH_SEED);

  // Start a run and let it drive straight into the seeded obstacle.
  await page.locator('.shell-play').click();
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('playing'))).toBe(true);

  // Wait for the crash overlay (generous — real-time ~3s, headroom for cold start).
  await expect(page.locator('.shell-crash')).toBeVisible({ timeout: 20_000 });

  // The WIPEOUT screen reads correctly.
  await expect(page.locator('.shell-crash .shell-title')).toHaveText('WIPEOUT');
  await expect(page.locator('.shell-crash-score')).not.toHaveText('');
  await expect(page.locator('.shell-crash-best')).not.toHaveText('');
  for (const sel of ['.shell-play-again', '.shell-crash .shell-menu', '.shell-crash .shell-share']) {
    await expect(page.locator(sel), `${sel} visible`).toBeVisible();
  }
  await assertButtonsLabelled(page, '.shell-crash');
  expect(await invisibleTextIn(page, '.shell-crash'), 'no invisible text on WIPEOUT').toEqual([]);

  // The just-finished run populated the leaderboard — check it via MENU → SCORES.
  await page.locator('.shell-crash .shell-menu').click();
  await expect(page.locator('.shell-start')).toBeVisible();
  await page.locator('.shell-leaderboard-open').click();
  await expect(page.locator('.shell-leaderboard')).toBeVisible();
  await expect(page.locator('.shell-lb-row').first(), 'leaderboard has a row after a run').toBeVisible();
  await expect(page.locator('.shell-lb-row').first().locator('.shell-lb-score')).not.toHaveText('');
  expect(await invisibleTextIn(page, '.shell-leaderboard'), 'no invisible text on a populated leaderboard').toEqual([]);
  await page.locator('.shell-close-leaderboard').click();
  await expect(page.locator('.shell-start')).toBeVisible();

  expect(errors, 'no console errors through crash → menu → scores').toEqual([]);
});

test('PLAY AGAIN from the WIPEOUT screen starts a fresh run', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page, CRASH_SEED);
  await page.locator('.shell-play').click();
  await expect(page.locator('.shell-crash')).toBeVisible({ timeout: 20_000 });

  await page.locator('.shell-play-again').click();
  // Overlay hides and we're playing again.
  await expect(page.locator('.shell-crash')).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('playing'))).toBe(true);
  await expect(page.locator('.shell-pause-btn')).toBeVisible();

  expect(errors, 'no console errors on PLAY AGAIN').toEqual([]);
});
