/**
 * ZEN RANDOM-SEED — a fresh world each time you ENTER Zen, pinnable via ?seed= for determinism.
 *
 * The Zen world used to key off a FIXED ZEN.worldSeed constant → every session generated the IDENTICAL
 * biomes/landmarks/layout (nothing new to discover on replay). Now the composition root passes a fresh
 * random seed per entry — UNLESS ?seed= pins it (so the validation sweep + the OG capture stay
 * deterministic). These tests lock in BOTH halves.
 */
import { test, expect, type Page } from '@playwright/test';

interface ZenDbg { seed: number }
interface Dbg { mode: string; zen?: ZenDbg }

/** Enter Zen via the real flow and return the session's world seed (read from the debug mirror). */
async function enterZenAndReadSeed(page: Page): Promise<number> {
  await page.locator('.shell-zen-open').click();
  await page.waitForFunction(() => (window as unknown as { __neonDebug?: Dbg }).__neonDebug?.mode === 'zen', null, {
    timeout: 15_000,
  });
  await expect(page.locator('.zen-overlay')).toBeVisible();
  // Wait for a Zen frame so the debug mirror carries the session seed.
  return page.waitForFunction(() => {
    const z = (window as unknown as { __neonDebug?: Dbg }).__neonDebug?.zen;
    return z && Number.isFinite(z.seed) ? z.seed : false;
  }, null, { timeout: 15_000 }).then((h) => h.jsonValue() as Promise<number>);
}

/** Leave Zen back to the start screen (so we can re-enter for a fresh world). */
async function exitZen(page: Page): Promise<void> {
  await page.locator('.zen-exit').click();
  await expect(page.locator('.shell-start')).toBeVisible();
}

test.describe('Zen world seed', () => {
  test('DEFAULT: entering Zen twice gives DIFFERENT worlds (a fresh random seed each entry)', async ({ page }) => {
    await page.goto('/'); // NO ?seed → random per entry
    await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30_000 });
    await expect(page.locator('.shell-start')).toBeVisible();

    const seedA = await enterZenAndReadSeed(page);
    await exitZen(page);
    const seedB = await enterZenAndReadSeed(page);

    expect(Number.isInteger(seedA) && seedA >= 0).toBe(true);
    expect(Number.isInteger(seedB) && seedB >= 0).toBe(true);
    expect(seedB, 'a fresh random world on re-entry').not.toBe(seedA);
  });

  test('PINNED: ?seed= forces the SAME world every entry (tests + OG capture stay deterministic)', async ({ page }) => {
    await page.goto('/?seed=4242');
    await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30_000 });
    await expect(page.locator('.shell-start')).toBeVisible();

    const first = await enterZenAndReadSeed(page);
    await exitZen(page);
    const second = await enterZenAndReadSeed(page);

    expect(first, 'the Zen world uses the pinned ?seed').toBe(4242);
    expect(second, 'and the SAME pinned seed on every re-entry').toBe(4242);
  });
});
