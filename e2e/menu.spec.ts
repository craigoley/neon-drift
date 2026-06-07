import { expect, test, type Page } from '@playwright/test';

/**
 * L2 DOM / MENU coverage (automated bug hunt, Phase 2+3). Exercises everything
 * OUTSIDE the Three.js canvas — the shell screens, buttons, labels, and the
 * invisible-text (cyan-on-cyan) bug class that has actually bitten this project.
 *
 * THE CANVAS WALL: Playwright sees the <canvas> as one opaque rectangle. These
 * tests assert NOTHING about in-scene gameplay, visuals, or feel — only the DOM
 * overlay (menus/HUD chrome) and console health. In-scene correctness is L1's job.
 */

/** Collect console errors + uncaught page errors for the whole test. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/?seed=123');
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30_000 });
  await expect(page.locator('.shell-start')).toBeVisible();
}

/**
 * Scan a visible screen for the "invisible text" bug class: an element with
 * non-empty text whose computed color equals its OWN opaque background-color
 * (e.g. cyan text on a cyan-filled button). Returns offending {tag,text} list.
 */
async function invisibleTextIn(page: Page, scope: string): Promise<Array<{ text: string; color: string }>> {
  return page.$eval(scope, (root) => {
    const opaque = (c: string) => c !== 'rgba(0, 0, 0, 0)' && !c.startsWith('rgba(0, 0, 0, 0');
    const bad: Array<{ text: string; color: string }> = [];
    const walk = (el: Element) => {
      const cs = getComputedStyle(el);
      // Only direct text (not text from descendants) matters for this element's color.
      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (ownText && opaque(cs.backgroundColor) && cs.color === cs.backgroundColor && cs.opacity !== '0') {
        bad.push({ text: ownText, color: cs.color });
      }
      for (const c of Array.from(el.children)) walk(c);
    };
    walk(root);
    return bad;
  });
}

/** Every VISIBLE button inside a scope must have a non-empty accessible label. */
async function assertButtonsLabelled(page: Page, scope: string): Promise<void> {
  const buttons = page.locator(`${scope} button:visible`);
  const n = await buttons.count();
  expect(n, `${scope} has buttons`).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    const text = (await b.textContent())?.trim() ?? '';
    const aria = (await b.getAttribute('aria-label'))?.trim() ?? '';
    expect(text.length + aria.length, `button ${i} in ${scope} has a label`).toBeGreaterThan(0);
  }
}

test('start menu: every nav button present, visible, labelled, and not invisible-text', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);

  for (const sel of [
    '.shell-play', '.shell-cars', '.shell-daily-open', '.shell-missions-open',
    '.shell-leaderboard-open', '.shell-settings-open', '.shell-share',
  ]) {
    await expect(page.locator(`.shell-start ${sel}`), `${sel} visible`).toBeVisible();
  }
  await expect(page.locator('.shell-start .shell-title')).toHaveText('NEON DRIFT');
  await expect(page.locator('.shell-best')).not.toHaveText('');
  await assertButtonsLabelled(page, '.shell-start');
  expect(await invisibleTextIn(page, '.shell-start'), 'no invisible text on start').toEqual([]);
  expect(errors, 'no console errors on boot').toEqual([]);
});

test('navigate to every screen and back; each is visible, headed, labelled, legible', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);

  const screens: Array<{ open: string; container: string; subtitle: string; close: string }> = [
    { open: '.shell-cars', container: '.shell-carpicker', subtitle: 'SELECT CAR', close: '.shell-carpicker .shell-close' },
    { open: '.shell-daily-open', container: '.shell-daily', subtitle: 'DAILY CHALLENGE', close: '.shell-close-daily' },
    { open: '.shell-missions-open', container: '.shell-missions', subtitle: 'MISSIONS', close: '.shell-close-missions' },
    { open: '.shell-leaderboard-open', container: '.shell-leaderboard', subtitle: 'SCORES', close: '.shell-close-leaderboard' },
    { open: '.shell-settings-open', container: '.shell-settings', subtitle: 'SETTINGS', close: '.shell-settings .shell-close' },
  ];

  for (const s of screens) {
    await page.locator(s.open).click();
    await expect(page.locator(s.container), `${s.container} shown`).toBeVisible();
    await expect(page.locator(`${s.container} .shell-subtitle`)).toHaveText(s.subtitle);
    await assertButtonsLabelled(page, s.container);
    expect(await invisibleTextIn(page, s.container), `no invisible text on ${s.container}`).toEqual([]);
    await page.locator(s.close).click();
    await expect(page.locator('.shell-start'), `returned to start from ${s.container}`).toBeVisible();
  }
  expect(errors, 'no console errors touring screens').toEqual([]);
});

test('car picker: cycles all 7 cars, each populating name/taglines/stat bars/dots', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await page.locator('.shell-cars').click();
  await expect(page.locator('.shell-carpicker')).toBeVisible();

  const dots = page.locator('.shell-car-dots .shell-dot');
  const carCount = await dots.count();
  expect(carCount, 'roster size (one dot per car)').toBe(7);

  const seenNames = new Set<string>();
  for (let i = 0; i < carCount; i++) {
    const name = (await page.locator('.shell-car-name').textContent())?.trim() ?? '';
    expect(name.length, `car ${i} has a name`).toBeGreaterThan(0);
    seenNames.add(name);
    // Taglines present (handling / scoring / slow-mo identity lines).
    for (const sel of ['.shell-car-tagline', '.shell-car-playstyle', '.shell-car-slowmo']) {
      expect(((await page.locator(sel).textContent()) ?? '').trim().length, `${sel} for ${name}`).toBeGreaterThan(0);
    }
    // Stat bars have a width (derived from handling).
    for (const stat of ['speed', 'grip', 'agility']) {
      const w = await page.locator(`.shell-stat-fill[data-stat="${stat}"]`).evaluate((el) => (el as HTMLElement).style.width);
      expect(w, `${stat} bar width set for ${name}`).toMatch(/\d/);
    }
    // Exactly one active dot, and it tracks the index.
    await expect(page.locator('.shell-car-dots .shell-dot--on')).toHaveCount(1);
    if (i < carCount - 1) await page.locator('.shell-next').click();
  }
  expect(seenNames.size, 'all 7 cars are distinct').toBe(7);
  expect(errors, 'no console errors cycling cars').toEqual([]);
});

test('settings: sound + Retro FX toggles flip their ON/OFF readout', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await page.locator('.shell-settings-open').click();
  await expect(page.locator('.shell-settings')).toBeVisible();

  for (const [btn, value] of [['.shell-toggle:not(.shell-toggle-fx)', '.shell-toggle-value'], ['.shell-toggle-fx', '.shell-fx-value']] as const) {
    const before = (await page.locator(value).textContent())?.trim();
    expect(before === 'ON' || before === 'OFF', `${value} reads ON/OFF`).toBe(true);
    await page.locator(btn).click();
    const after = (await page.locator(value).textContent())?.trim();
    expect(after, `${value} flips`).not.toBe(before);
    expect(after === 'ON' || after === 'OFF').toBe(true);
  }
  expect(errors, 'no console errors in settings').toEqual([]);
});

test('PLAY starts a run (overlay hides, pause button appears) and pause/resume works', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);

  await page.locator('.shell-play').click();
  // The start overlay hides and the body enters the playing state.
  await expect(page.locator('.shell-start')).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('playing'))).toBe(true);
  await expect(page.locator('.shell-pause-btn')).toBeVisible();

  // Pause → pause screen → resume.
  await page.locator('.shell-pause-btn').click();
  await expect(page.locator('.shell-pause')).toBeVisible();
  await expect(page.locator('.shell-pause .shell-subtitle')).toHaveText('PAUSED');
  await assertButtonsLabelled(page, '.shell-pause');
  expect(await invisibleTextIn(page, '.shell-pause'), 'no invisible text on pause').toEqual([]);
  await page.locator('.shell-resume').click();
  await expect(page.locator('.shell-pause')).toBeHidden();

  // Keyboard to the focused canvas must not throw.
  await page.locator('canvas').first().click({ position: { x: 5, y: 5 } });
  for (const key of ['ArrowLeft', 'ArrowRight', 'Space', 'a', 'd']) await page.keyboard.press(key);

  expect(errors, 'no console errors during play/pause/keyboard').toEqual([]);
});
