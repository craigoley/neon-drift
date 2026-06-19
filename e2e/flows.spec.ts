import { expect, test, type Page } from '@playwright/test';
import { boot, trackErrors } from './_helpers';

/**
 * PHASE 3 — INTERACTION FLOWS: full WIRING between screens, not just presence.
 * Catches broken inter-screen plumbing (a button that renders but does the wrong
 * thing, state that leaks between runs, a persisted setting that doesn't stick).
 *
 * CANVAS WALL: verification uses DOM/localStorage signals only — the HUD overlay
 * (`.hud-*`, all DOM), `body.playing`, and localStorage. The HUD distinguishes
 * mode via `.hud-lives` (slalom-only) and `.hud-combo` ("x1.0" classic vs
 * "CLEAN x" slalom). No in-scene assertions.
 */

const PROGRESS_KEY = 'neon-drift.progress';
const SETTINGS_KEY = 'neon-drift.settings';
const ALL_CARS = ['pulse', 'vapor', 'ember', 'ghost', 'nova', 'onyx', 'slipstream'];

const lsNumber = (page: Page, sel: string) =>
  page.locator(sel).textContent().then((t) => parseInt((t ?? '').replace(/[^\d]/g, ''), 10) || 0);

test('classic crash → PLAY AGAIN restarts a CLEAN run (score reset, classic mode)', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page, 21); // straight run crashes ~3s
  await page.locator('.shell-play').click();
  await expect(page.locator('.shell-crash')).toBeVisible({ timeout: 20_000 });
  const crashedScore = await lsNumber(page, '.shell-crash-score');
  expect(crashedScore, 'first run actually scored').toBeGreaterThan(0);

  await page.locator('.shell-play-again').click();
  await expect(page.locator('.shell-crash')).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('playing'))).toBe(true);
  // Fresh run: the live HUD score is back near zero (NOT the carried-over crash
  // score), combo reset, and it's classic (lives row hidden).
  expect(await lsNumber(page, '.hud-stat >> nth=2'), 'score reset on restart').toBeLessThan(200);
  await expect(page.locator('.hud-combo')).toHaveText('x1.0');
  await expect(page.locator('.hud-lives')).toBeHidden();
  expect(errors).toEqual([]);
});

test('classic vs daily PLAY launch the correct mode (HUD lives row is the tell)', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  // Classic: no lives row, numeric combo.
  await page.locator('.shell-play').click();
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('playing'))).toBe(true);
  await expect(page.locator('.hud-lives')).toBeHidden();
  await expect(page.locator('.hud-combo')).toHaveText(/^x\d/);

  // Back to menu, then DAILY: lives row visible, CLEAN combo.
  await page.keyboard.press('Escape'); // pause
  await page.locator('.shell-quit').click();
  await expect(page.locator('.shell-start')).toBeVisible();
  await page.locator('.shell-daily-open').click();
  await page.locator('.shell-play-daily').click();
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('playing'))).toBe(true);
  await expect(page.locator('.hud-lives')).toBeVisible();
  await expect(page.locator('.hud-combo')).toHaveText(/CLEAN x/);
  expect(errors).toEqual([]);
});

test('daily crash → PLAY AGAIN replays DAILY mode, not classic [slow]', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await page.locator('.shell-daily-open').click();
  await page.locator('.shell-play-daily').click();
  await expect(page.locator('.hud-lives')).toBeVisible(); // daily/slalom confirmed
  // A straight daily run crashes in ~12s (3 missed gate-walls) — generous wait.
  await expect(page.locator('.shell-crash')).toBeVisible({ timeout: 30_000 });

  await page.locator('.shell-play-again').click();
  await expect(page.locator('.shell-crash')).toBeHidden();
  // The replay must stay DAILY (lives row visible again) — not fall back to classic.
  await expect(page.locator('.hud-lives')).toBeVisible();
  await expect(page.locator('.hud-combo')).toHaveText(/CLEAN x/);
  expect(errors).toEqual([]);
});

test('car selection persists to localStorage (and survives reopening the picker)', async ({ page }) => {
  const errors = trackErrors(page);
  // Unlock every car so a non-starter is selectable (fresh profile = starter only).
  await page.addInitScript(([key, cars]) => {
    localStorage.setItem(key as string, JSON.stringify({ unlocked: cars }));
  }, [PROGRESS_KEY, ALL_CARS]);
  await boot(page);

  await page.locator('.shell-cars').click();
  await page.locator('.shell-next').click(); // pulse → vapor (next in roster)
  const shown = (await page.locator('.shell-car-name').textContent())?.trim().toLowerCase();
  expect(shown).toBe('vapor');
  await page.locator('.shell-carpicker .shell-close').click(); // DONE

  const persisted = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').selectedCarId, SETTINGS_KEY);
  expect(persisted, 'selectedCarId persisted').toBe('vapor');

  // Reopen the picker — it should still be on vapor.
  await page.locator('.shell-cars').click();
  expect((await page.locator('.shell-car-name').textContent())?.trim().toLowerCase()).toBe('vapor');
  expect(errors).toEqual([]);
});

test('settings: sound toggle persists to localStorage and survives a reload', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await page.locator('.shell-settings-open').click();
  const before = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').soundEnabled ?? true, SETTINGS_KEY);
  await page.locator('.shell-toggle-sound').click();
  const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').soundEnabled, SETTINGS_KEY);
  expect(after, 'soundEnabled flipped + persisted').toBe(!before);

  // Survives a reload (the readout reflects the persisted value).
  await page.reload();
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30_000 });
  await page.locator('.shell-settings-open').click();
  const reloaded = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').soundEnabled, SETTINGS_KEY);
  expect(reloaded).toBe(after);
  expect(errors).toEqual([]);
});

test('menu round-trips through every panel without sticking; PLAY still works after', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  for (const [open, close] of [
    ['.shell-leaderboard-open', '.shell-close-leaderboard'],
    ['.shell-daily-open', '.shell-close-daily'],
    ['.shell-missions-open', '.shell-close-missions'],
    ['.shell-cars', '.shell-carpicker .shell-close'],
    ['.shell-settings-open', '.shell-settings .shell-close'],
  ] as const) {
    await page.locator(open).click();
    await page.locator(close).click();
    await expect(page.locator('.shell-start'), `back to start after ${open}`).toBeVisible();
  }
  // Plumbing intact after all that navigation: PLAY still launches a run.
  await page.locator('.shell-play').click();
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('playing'))).toBe(true);
  expect(errors).toEqual([]);
});

test('Esc pause → Esc resume returns to the SAME run (distance keeps climbing)', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await page.locator('.shell-play').click();
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('playing'))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.locator('.shell-pause')).toBeVisible();
  // Read the RAW distance from the debug mirror (not the HUD text): the HUD now formats US miles/feet
  // (#174), so digit-stripping the label is unit-dependent + fragile across the ft↔mi switch. The raw
  // value is the unit-independent source of truth for "distance kept climbing".
  const rawDist = () => page.evaluate(() => (window as unknown as { __neonDebug?: { distance: number } }).__neonDebug?.distance ?? 0);
  const distAtPause = await rawDist(); // frozen while paused
  await page.keyboard.press('Escape'); // resume
  await expect(page.locator('.shell-pause')).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('playing'))).toBe(true);
  // Same run continued: distance advances from where it paused (not reset to 0).
  await expect.poll(rawDist).toBeGreaterThan(distAtPause);
  expect(errors).toEqual([]);
});
