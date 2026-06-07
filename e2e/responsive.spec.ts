import { expect, test, type Page } from '@playwright/test';
import { assertButtonsLabelled, boot, invisibleTextIn, trackErrors } from './_helpers';

/**
 * PHASE 4 — RESPONSIVE / A11Y (DOM/viewport layer; canvas wall applies).
 *
 * The game is mobile-first; this sweeps a few viewport sizes and asserts the menu
 * chrome adapts: no horizontal overflow, the primary CTA stays on-screen, the
 * canvas fills the viewport. Plus a light a11y pass: buttons have accessible names,
 * interactive elements are focusable, no invisible-on-same-color text. This is NOT
 * a full WCAG audit — it flags the obvious gaps only. Nothing here tests the scene.
 */

const VIEWPORTS = [
  { name: 'small-phone', width: 360, height: 640 },
  { name: 'large-phone', width: 414, height: 896 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop-wide', width: 1440, height: 900 },
];

/** No horizontal overflow anywhere on the page (the classic mobile breakage). */
async function assertNoHorizontalOverflow(page: Page, width: number): Promise<void> {
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW, 'no horizontal page overflow').toBeLessThanOrEqual(width + 1);
}

/** A locator's box sits fully within the viewport (reachable without scroll). */
async function assertInViewport(page: Page, sel: string, width: number, height: number): Promise<void> {
  const box = await page.locator(sel).boundingBox();
  expect(box, `${sel} has a box`).not.toBeNull();
  if (!box) return;
  expect(box.x, `${sel} left edge`).toBeGreaterThanOrEqual(-1);
  expect(box.y, `${sel} top edge`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${sel} right edge within width`).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height, `${sel} bottom edge within height`).toBeLessThanOrEqual(height + 1);
}

for (const vp of VIEWPORTS) {
  test(`start menu adapts at ${vp.name} (${vp.width}×${vp.height})`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await boot(page);

    // Canvas fills the viewport.
    const canvas = await page.locator('canvas').first().boundingBox();
    expect(canvas?.width ?? 0, 'canvas ~full width').toBeGreaterThanOrEqual(vp.width - 2);
    expect(canvas?.height ?? 0, 'canvas ~full height').toBeGreaterThanOrEqual(vp.height - 2);

    // No horizontal overflow; primary CTA and title are on-screen.
    await assertNoHorizontalOverflow(page, vp.width);
    await assertInViewport(page, '.shell-play', vp.width, vp.height);
    await assertInViewport(page, '.shell-start .shell-title', vp.width, vp.height);

    // a11y basics: labels + no invisible text.
    await assertButtonsLabelled(page, '.shell-start');
    expect(await invisibleTextIn(page, '.shell-start'), 'no invisible text').toEqual([]);
    expect(errors).toEqual([]);
  });

  test(`car picker adapts at ${vp.name}`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await boot(page);
    await page.locator('.shell-cars').click();
    await expect(page.locator('.shell-carpicker')).toBeVisible();
    await assertNoHorizontalOverflow(page, vp.width);
    // The arrows + DONE must be reachable on-screen.
    for (const sel of ['.shell-prev', '.shell-next', '.shell-carpicker .shell-close']) {
      await assertInViewport(page, sel, vp.width, vp.height);
    }
    await assertButtonsLabelled(page, '.shell-carpicker');
    expect(await invisibleTextIn(page, '.shell-carpicker'), 'no invisible text in picker').toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('a11y: interactive elements are keyboard-focusable', async ({ page }) => {
  await boot(page);
  // The PLAY button can take focus (it's a real <button>, focusable by default).
  await page.locator('.shell-play').focus();
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
  expect(focusedTag, 'a button receives focus').toBe('BUTTON');
  // Tab moves focus to another focusable control (not stuck on body).
  await page.keyboard.press('Tab');
  const stillInteractive = await page.evaluate(() => document.activeElement?.tagName);
  expect(['BUTTON', 'A', 'INPUT'], 'Tab lands on an interactive element').toContain(stillInteractive);
});

test('a11y: the icon-only pause button has an accessible name', async ({ page }) => {
  await boot(page);
  await page.locator('.shell-play').click();
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('playing'))).toBe(true);
  const pause = page.locator('.shell-pause-btn');
  await expect(pause).toBeVisible();
  // It renders a glyph ("❚❚"); an icon-only control should still expose a name
  // (text content or aria-label) so it isn't an unlabelled button to AT.
  const label = ((await pause.textContent())?.trim() ?? '') + ((await pause.getAttribute('aria-label'))?.trim() ?? '');
  expect(label.length, 'pause button has a name').toBeGreaterThan(0);
});
