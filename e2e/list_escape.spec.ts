/**
 * L2 regression guard for the LIST-SCREEN kid-safety fixes (the #180 store + #181 leaderboard "no-exit
 * trap" + "can't tell it scrolls" class). The fixes themselves shipped in #180/#181 and are unit-tested
 * for STRUCTURE (shell_store.test.ts / shell.test.ts: the .shell-back button + the .shell-scroll-cue
 * element exist). What those unit tests CAN'T cover — jsdom reports zero layout sizes, so refreshScrollCue
 * is a no-op there — is the DYNAMIC behaviour that is the whole point of the fix:
 *   (1) the fixed ‹ BACK is actually VISIBLE (rendered, top-left, real tap target) while the list scrolls,
 *   (2) the "more below" fade cue APPEARS at rest when the list overflows, and HIDES at the bottom.
 * This spec drives a real browser to lock those in. (iOS-Safari overlay-scrollbar behaviour still needs a
 * real device — Craig eyeballs that — but the fade cue is a plain element whose visibility we CAN assert.)
 */
import { expect, test, type Page } from '@playwright/test';
import { boot } from './_helpers';

/** Read the escapability + scroll-cue state of a shown list screen (BACK visibility, overflow, cue). */
async function listState(page: Page, screenSel: string, backSel: string) {
  return page.evaluate(
    ([sSel, bSel]) => {
      const s = document.querySelector(sSel)!;
      const scroll = s.querySelector('.shell-scroll') as HTMLElement;
      const back = s.querySelector(bSel) as HTMLElement;
      const cue = s.querySelector('.shell-scroll-cue') as HTMLElement;
      const br = back.getBoundingClientRect();
      return {
        backVisible: br.width > 0 && br.height > 0,
        backTop: Math.round(br.top),
        backLeft: Math.round(br.left),
        backMinHeight: parseInt(getComputedStyle(back).minHeight, 10),
        overflowing: scroll.scrollHeight > scroll.clientHeight + 4,
        showsMore: s.classList.contains('shows-more'),
        cueOpacity: Number(getComputedStyle(cue).opacity),
      };
    },
    [screenSel, backSel] as const,
  );
}

test('leaderboard (SCORES): fixed BACK is always visible + the "more below" cue toggles with overflow', async ({ page }) => {
  // A short viewport so even a modest scores list overflows → the cue must show.
  await page.setViewportSize({ width: 390, height: 300 });
  // Seed 21's straight run crashes → records one score so the list has content (crash.spec.ts pattern).
  await boot(page, 21);
  await page.locator('.shell-play').click();
  await expect(page.locator('.shell-crash')).toBeVisible({ timeout: 20_000 });
  await page.locator('.shell-crash .shell-menu').click();
  await expect(page.locator('.shell-start')).toBeVisible();

  await page.locator('.shell-leaderboard-open').click();
  await expect(page.locator('.shell-leaderboard')).toBeVisible();

  // (1) The fixed ‹ BACK is rendered top-left with a real (≥46px) tap target, and escapes to the menu.
  const top = await listState(page, '.shell-leaderboard', '.shell-back-leaderboard');
  expect(top.backVisible, 'BACK is visible (not scrolled away / not display:none)').toBe(true);
  expect(top.backTop, 'BACK sits at the top').toBeLessThan(40);
  expect(top.backLeft, 'BACK sits at the left').toBeLessThan(40);
  expect(top.backMinHeight, 'BACK is a ≥46px tap target').toBeGreaterThanOrEqual(46);

  // (2) The list overflows at this height → the "more below" fade cue is shown at rest. (Poll the
  // opacity so the cue's 0.18s fade-in transition has settled before we read it.)
  expect(top.overflowing, 'the scores list overflows the short viewport').toBe(true);
  expect(top.showsMore, 'the shows-more cue is active while there is content below the fold').toBe(true);
  await expect
    .poll(async () => (await listState(page, '.shell-leaderboard', '.shell-back-leaderboard')).cueOpacity, {
      message: 'the bottom fade cue is visible at rest',
    })
    .toBe(1);

  // Scroll to the bottom → nothing more below → the cue hides (so it never lies "more" at the end).
  await page.evaluate(() => {
    const sc = document.querySelector('.shell-leaderboard .shell-scroll') as HTMLElement;
    sc.scrollTop = sc.scrollHeight;
  });
  await expect
    .poll(async () => (await listState(page, '.shell-leaderboard', '.shell-back-leaderboard')).cueOpacity)
    .toBe(0);

  // BACK escapes to the start menu (the always-available exit — the #180/#181 trap fix).
  await page.locator('.shell-back-leaderboard').click();
  await expect(page.locator('.shell-start')).toBeVisible();
  await expect(page.locator('.shell-leaderboard')).toBeHidden();
});

test('store: same escapable BACK + "more below" cue (the #180 sibling screen stays consistent)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 420 });
  await boot(page);
  await page.locator('.shell-store-open').click();
  await expect(page.locator('.shell-store')).toBeVisible();
  await page.waitForTimeout(300); // let the cosmetic preview mount + the list settle

  const st = await listState(page, '.shell-store', '.shell-back-store');
  expect(st.backVisible, 'store BACK is visible').toBe(true);
  expect(st.backTop, 'store BACK at top').toBeLessThan(40);
  expect(st.backMinHeight, 'store BACK is a ≥46px tap target').toBeGreaterThanOrEqual(46);
  // The store's cars + cosmetics lists overflow a phone → the same fade cue signals "more below".
  expect(st.overflowing, 'the store list overflows').toBe(true);
  expect(st.showsMore, 'store shows-more cue active').toBe(true);
  await expect
    .poll(async () => (await listState(page, '.shell-store', '.shell-back-store')).cueOpacity, {
      message: 'store fade cue visible at rest',
    })
    .toBe(1);

  await page.locator('.shell-back-store').click();
  await expect(page.locator('.shell-start')).toBeVisible();
});
