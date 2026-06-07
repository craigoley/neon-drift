import { expect, test } from '@playwright/test';
import { trackErrors } from './_helpers';

/**
 * MP-1 PR1 — the ?mp=1 connection-test overlay MOUNTS cleanly (DOM layer only).
 * This guards the lazy import + UI wiring. It does NOT exercise a real connection
 * or the determinism probe-over-the-link — those need two browsers + the deployed
 * signaling function (no backend under `vite dev`), and are the manual device test.
 * Canvas wall applies; nothing in-scene is tested.
 */
test('?mp=1 mounts the connection-test panel with HOST/JOIN and no console errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?mp=1');
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30_000 });

  const panel = page.locator('.mp-test');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'HOST' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'JOIN' })).toBeVisible();
  await expect(panel).toContainText('CONNECTION TEST');
  // STUN-only warning shows when no TURN is configured (the default in dev/CI).
  await expect(panel).toContainText(/TURN/i);

  expect(errors, 'no console errors mounting the MP test panel').toEqual([]);
});
