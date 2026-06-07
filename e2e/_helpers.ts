import { expect, type Page } from '@playwright/test';

// Shared L2 helpers (NOT a spec — Playwright only runs *.spec.ts, so this is
// imported, never executed as a test).

/** Collect console errors + uncaught page errors for the whole test. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** Boot the app at a given seed and wait for the first rendered frame. */
export async function boot(page: Page, seed = 123): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30_000 });
  await expect(page.locator('.shell-start')).toBeVisible();
}

/**
 * Scan a visible screen for the "invisible text" bug class: an element with
 * non-empty OWN text whose computed color equals its own opaque background-color
 * (e.g. cyan text on a cyan-filled button). Returns the offending {text,color}.
 */
export async function invisibleTextIn(page: Page, scope: string): Promise<Array<{ text: string; color: string }>> {
  return page.$eval(scope, (root) => {
    const opaque = (c: string) => !c.startsWith('rgba(0, 0, 0, 0');
    const bad: Array<{ text: string; color: string }> = [];
    const walk = (el: Element) => {
      const cs = getComputedStyle(el);
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
export async function assertButtonsLabelled(page: Page, scope: string): Promise<void> {
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
