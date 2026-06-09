import { expect, test } from '@playwright/test';
import { boot, trackErrors } from './_helpers';

/**
 * GRAPHICS quality toggle (gfx PR1). HIGH (default) is the full bloom + cinematic
 * pipeline — covered by smoke.spec's non-blank-canvas guard. This verifies the LOW
 * path: "Retro FX" OFF must skip the WHOLE post pipeline (bloom included) and render
 * DIRECT — and still draw a correct, non-blank scene with no console errors. (Whether
 * the glow *looks* right on HIGH is canvas-walled → playtest; this proves LOW renders.)
 */
test('LOW quality (Retro FX off) renders direct (no bloom) — non-blank, no errors', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);

  // Flip Retro FX OFF → LOW quality (skips bloom, renders direct).
  await page.locator('.shell-settings-open').click();
  await expect(page.locator('.shell-settings')).toBeVisible();
  const fx = page.locator('.shell-fx-value');
  if ((await fx.textContent())?.trim() === 'ON') await page.locator('.shell-toggle-fx').click();
  await expect(fx).toHaveText('OFF');
  await page.locator('.shell-settings .shell-close').click();

  // Start a run on LOW → exercises the direct-render path.
  await page.locator('.shell-play').click();
  await expect(page.locator('.shell-pause-btn')).toBeVisible();
  await page.waitForTimeout(400); // let a few LOW-path frames draw

  const shot = await page.locator('canvas').first().screenshot();
  expect(shot.byteLength, 'LOW renders a non-blank scene').toBeGreaterThan(5_000);
  expect(errors, 'no console errors on the LOW (direct) render path').toEqual([]);
});

/**
 * MEDIUM path (gfx perf — independent cinematic toggle): "Cinematic FX" OFF must keep
 * bloom (the composer still runs) but SKIP the fullscreen grade pass — and still draw a
 * correct, non-blank scene. The fps win is canvas-walled (→ playtest, esp. on mobile);
 * this proves the bloom-on / cinematic-off combo renders.
 */
test('MEDIUM (Cinematic FX off, bloom on) renders the glow without the grade pass — no errors', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);

  await page.locator('.shell-settings-open').click();
  await expect(page.locator('.shell-settings')).toBeVisible();
  // Leave Retro FX ON (bloom on); flip Cinematic FX OFF → skip the fullscreen grade.
  await expect(page.locator('.shell-fx-value')).toHaveText('ON');
  const cine = page.locator('.shell-cine-value');
  if ((await cine.textContent())?.trim() === 'ON') await page.locator('.shell-toggle-cine').click();
  await expect(cine).toHaveText('OFF');
  await page.locator('.shell-settings .shell-close').click();

  await page.locator('.shell-play').click();
  await expect(page.locator('.shell-pause-btn')).toBeVisible();
  await page.waitForTimeout(400);

  const shot = await page.locator('canvas').first().screenshot();
  expect(shot.byteLength, 'MEDIUM renders a non-blank scene (bloom still on)').toBeGreaterThan(5_000);
  expect(errors, 'no console errors on the MEDIUM (bloom on, cinematic off) path').toEqual([]);
});
