import { expect, test } from '@playwright/test';

// L2 SMOKE: load the REAL app in a REAL browser and prove the scene actually
// renders. This is deliberately shallow — it cannot see "inside" the WebGL canvas
// (that is L1's job), but it DOES catch what L1 cannot: a blank/black screen, a
// crash on boot, or console errors during load (e.g. the invisible-screen and
// cyan-on-cyan bugs that passed the pure tests).

test('boots, renders a non-blank canvas, and logs no console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  // ?seed pins a deterministic scene (the render-layer test hook in main.ts).
  await page.goto('/?seed=123');

  // Wait for the first frame to actually be drawn (the __READY__ render hook).
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30_000 });

  // The canvas exists and has real dimensions.
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);

  // NOT blank: a screenshot of a solid-colour (blank/black) canvas compresses to a
  // tiny PNG; a rendered neon scene (gradient sky, road, glow) is much larger. This
  // is machine-independent (no committed baseline) so it survives WebGL rendering
  // differences across CI runners — the core "the screen isn't blank" guarantee.
  const shot = await canvas.screenshot();
  expect(shot.byteLength).toBeGreaterThan(5_000);

  // No errors logged during boot.
  expect(consoleErrors).toEqual([]);
});

test('matches the boot-screen visual baseline (gross-regression guard)', async ({ page }) => {
  // A generous pixel-diff ratio: WebGL output varies by GPU/driver across machines,
  // so this is NOT pixel-perfect — it catches GROSS breakage (cyan-on-cyan, a
  // collapsed layout, a missing scene), not minor drift. The baseline is recorded
  // on first run (`--update-snapshots`); regenerate in CI if the runner's GPU
  // differs enough to exceed the ratio.
  await page.goto('/?seed=123');
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30_000 });
  await expect(page).toHaveScreenshot('boot.png', { maxDiffPixelRatio: 0.3 });
});
