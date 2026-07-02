/**
 * L2 regression guard for the tier-1 UX fixes (audit #191). Exercises the three
 * structural UX fixes end-to-end so the classes they close stay closed:
 *   F1 — Zen hint wraps clean + clears the minimap at phone widths (320–430px)
 *   F2 — the ?mp=1 connection-test screen now has a BACK escape
 *   F3 — no live pause/slow-mo ghost control sits under the vs-CPU / 2P menus,
 *        and real play mode (+ its pause) still engages once the race starts.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot } from './_helpers';

type Rect = { x: number; y: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

async function rectOf(page: Page, sel: string, nth = 0): Promise<Rect> {
  return page.locator(sel).nth(nth).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

test.describe('F1 — Zen hint is legible on phones', () => {
  for (const width of [320, 375, 390, 430]) {
    test(`hint lines don't overlap each other or the minimap at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await boot(page, 4242);
      await page.locator('.shell-zen-open').click();
      await expect(page.locator('.zen-overlay')).toBeVisible();
      await expect(page.locator('.zen-minimap')).toBeVisible();

      const lines = page.locator('.zen-hint p');
      await expect(lines).toHaveCount(2);
      const line0 = await rectOf(page, '.zen-hint p', 0);
      const line1 = await rectOf(page, '.zen-hint p', 1);
      const minimap = await rectOf(page, '.zen-minimap');

      expect(overlaps(line0, line1), `${width}px: the two hint lines overlap`).toBe(false);
      expect(overlaps(line0, minimap), `${width}px: controls hint runs under the minimap`).toBe(false);
      expect(overlaps(line1, minimap), `${width}px: discovery hint runs under the minimap`).toBe(false);
      // Both lines must sit within the viewport (not clipped off the right edge).
      expect(line0.x + line0.width, `${width}px: line0 off-screen`).toBeLessThanOrEqual(width + 0.5);
      expect(line1.x + line1.width, `${width}px: line1 off-screen`).toBeLessThanOrEqual(width + 0.5);
    });
  }

  test('desktop keeps the hint at the top-centre (unchanged)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page, 4242);
    await page.locator('.shell-zen-open').click();
    await expect(page.locator('.zen-overlay')).toBeVisible();
    const box = await rectOf(page, '.zen-hint');
    expect(box.y, 'desktop hint stays near the top').toBeLessThan(60);
  });
});

test('F2 — the ?mp=1 screen has a BACK that escapes to the menu', async ({ page }) => {
  await page.goto('/?mp=1');
  const back = page.locator('.mp-test .shell-back');
  await expect(back).toBeVisible();
  await expect(back).toHaveText('‹ BACK');
  await back.click();
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30_000 });
  await expect(page.locator('.shell-start')).toBeVisible();
  await expect(page.locator('.mp-test')).toHaveCount(0);
  expect(new URL(page.url()).search).not.toContain('mp=1');
});

test.describe('F3 — no ghost run-control under the vs-CPU / 2P menus', () => {
  const playing = (page: Page) => page.evaluate(() => document.body.classList.contains('playing'));

  test('vs-CPU picker: not playing, no live pause — then the race engages play mode', async ({ page }) => {
    await boot(page, 123);
    await page.locator('.shell-vscpu-open').click();
    await expect(page.locator('.bot-race-ui')).toBeVisible();
    // MENU phase: body.playing OFF → pause + slow-mo are display:none (no ghost control).
    expect(await playing(page), 'body.playing must be OFF during the vs-CPU picker').toBe(false);
    await expect(page.locator('.shell-pause-btn')).toBeHidden();

    // Pick a difficulty → the real race starts and NOW play mode engages.
    await page.locator('.bot-race-ui button', { hasText: 'EASY' }).first().click();
    await expect(page.locator('.bot-race-ui')).toHaveCount(0);
    await page.waitForFunction(() => document.body.classList.contains('playing'), null, { timeout: 10_000 });
    await expect(page.locator('.shell-pause-btn')).toBeVisible();
    // In-race pause still works.
    await page.locator('.shell-pause-btn').click();
    await expect(page.locator('.shell-pause')).toBeVisible();
  });

  test('2P lobby: not playing, no live pause control', async ({ page }) => {
    await boot(page, 123);
    await page.locator('.shell-mp-open').click();
    await expect(page.locator('.mp-race-ui')).toBeVisible();
    expect(await playing(page), 'body.playing must be OFF during the 2P lobby').toBe(false);
    await expect(page.locator('.shell-pause-btn')).toBeHidden();
  });
});
