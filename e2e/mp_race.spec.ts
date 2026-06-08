import { expect, test } from '@playwright/test';
import { boot, trackErrors } from './_helpers';

/**
 * MP-1 PR2 — the in-game 2P entry mounts from the start menu (DOM layer only).
 * Guards the menu button + overlay wiring. It does NOT exercise a live race or
 * lockstep sync — those need two browsers + the deployed signaling function and are
 * the manual device playtest. Canvas wall applies.
 */
test('2P RACE menu button opens the Host/Join race overlay, no console errors', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);

  const mpBtn = page.locator('.shell-mp-open');
  await expect(mpBtn).toBeVisible();
  await expect(mpBtn).toHaveText('2P RACE');
  await mpBtn.click();

  const ui = page.locator('.mp-race-ui');
  await expect(ui).toBeVisible();
  await expect(ui.getByRole('button', { name: 'HOST' })).toBeVisible();
  await expect(ui.getByRole('button', { name: 'JOIN' })).toBeVisible();
  await expect(ui).toContainText('2-PLAYER RACE');

  // Backing out returns to the start menu cleanly.
  await ui.getByRole('button', { name: 'BACK' }).click();
  await expect(page.locator('.shell-start')).toBeVisible();

  expect(errors, 'no console errors opening/closing the 2P overlay').toEqual([]);
});

test('the join-code field accepts "P" (global pause-on-P must not swallow it)', async ({ page }) => {
  // Regression: the window-global Shell key handler preventDefault'd 'P' (pause),
  // eating it before the focused input — and the match-code alphabet CONTAINS P, so
  // P-containing codes were un-joinable. Type a P-containing code via real keystrokes
  // (pressSequentially fires keydown, exercising the handler) and assert it lands.
  await boot(page);
  await page.locator('.shell-mp-open').click();
  const input = page.locator('.mp-race-ui input');
  await input.focus();
  await input.pressSequentially('PQRSP'); // two Ps + the other control-bound R
  await expect(input).toHaveValue('PQRSP');
});
