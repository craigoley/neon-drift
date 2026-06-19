/**
 * OG HERO IMAGE CAPTURE — produces public/og-image.png (1200×630), the social-share hero.
 *
 * This is a SCREENSHOT script: it READS the running game (boots, enters Zen free-roam, drives a beat
 * toward a landmark, screenshots the WebGL canvas) and writes ONE asset. It does NOT modify any game/
 * engine/canvas code. Run on demand:  npx playwright test e2e/capture-og.spec.ts
 *
 * Composition: Zen free-roam is the prettiest mode (open synthwave world, bloom, biome colour). We drive
 * toward the nearest big landmark (arch / vista / tunnel beacon) so the frame has a SUBJECT on the lit
 * neon horizon, not a flat empty patch. The DOM HUD (EXIT / hint / GAS-BRAKE / the .zen-minimap radar)
 * is hidden with CAPTURE-ONLY injected CSS (page.addStyleTag — does NOT touch game code) so the hero is
 * a clean render, then the main 3D canvas is screenshotted.
 */
import { test, expect, type Page } from '@playwright/test';
import { existsSync, statSync } from 'node:fs';
import { ZEN } from '../src/utils/constants';
import {
  landmarksInRadius,
  LANDMARK_ARCH,
  LANDMARK_VISTA,
  LANDMARK_TUNNEL,
} from '../src/zen/ZenLandmarkModel';

const OUT = 'public/og-image.png';
const SEED = ZEN.worldSeed; // the Zen world is keyed to ZEN.worldSeed → deterministic, same frame every run

interface ZenDbg { pos: { x: number; y: number; z: number }; heading: number; speed: number }
interface Dbg { mode: string; zen?: ZenDbg }
const readZen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __neonDebug?: Dbg }).__neonDebug?.zen ?? null);

// The OG standard ratio. deviceScaleFactor 1 → the canvas screenshot is exactly 1200×630.
test.use({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });

test('capture the Zen free-roam hero → public/og-image.png', async ({ page }) => {
  await page.goto(`/?seed=${SEED}`);
  await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30_000 });
  await expect(page.locator('.shell-start')).toBeVisible();

  // Enter Zen free-roam (the real flow).
  await page.locator('.shell-zen-open').click();
  await page.waitForFunction(() => (window as unknown as { __neonDebug?: Dbg }).__neonDebug?.mode === 'zen', null, {
    timeout: 15_000,
  });
  await expect(page.locator('.zen-overlay')).toBeVisible();

  // Pick the nearest BIG landmark to the spawn as the subject (shortest drive to a hero shot).
  const spawn = await readZen(page);
  if (!spawn) throw new Error('no Zen debug snapshot after entering Zen');
  const subject = [LANDMARK_ARCH, LANDMARK_VISTA, LANDMARK_TUNNEL]
    .flatMap((t) => landmarksInRadius(SEED, spawn.pos.x, spawn.pos.z, 16000).filter((l) => l.type === t))
    .sort((a, b) => Math.hypot(a.x - spawn.pos.x, a.z - spawn.pos.z) - Math.hypot(b.x - spawn.pos.x, b.z - spawn.pos.z))[0];

  // Drive a beat toward it (hold gas + closed-loop steer), stopping while it's still AHEAD in frame.
  let steering: 'ArrowLeft' | 'ArrowRight' | null = null;
  await page.keyboard.down('ArrowUp');
  const start = Date.now();
  try {
    while (Date.now() - start < 13000) {
      const z = await readZen(page);
      if (z && subject) {
        const dist = Math.hypot(subject.x - z.pos.x, subject.z - z.pos.z);
        if (dist < 620) break; // close enough that the landmark looms on the horizon, not on top of us
        const desired = Math.atan2(subject.x - z.pos.x, -(subject.z - z.pos.z)); // forward = (sin h, -cos h)
        let err = desired - z.heading;
        while (err > Math.PI) err -= 2 * Math.PI;
        while (err < -Math.PI) err += 2 * Math.PI;
        const want = Math.abs(err) < 0.08 ? null : err > 0 ? 'ArrowRight' : 'ArrowLeft';
        if (want !== steering) {
          if (steering) await page.keyboard.up(steering);
          if (want) await page.keyboard.down(want);
          steering = want;
        }
      }
      await page.waitForTimeout(100);
    }
  } finally {
    if (steering) await page.keyboard.up(steering);
    await page.keyboard.up('ArrowUp');
  }

  // Let the world finish streaming + the bloom settle on the coast-down.
  await page.waitForTimeout(900);
  // CAPTURE-ONLY: hide the DOM HUD so the hero is a clean render (injected into the page, not the game).
  await page.addStyleTag({ content: '.zen-overlay,.zen-minimap,.zen-fader{display:none !important}' });
  await page.waitForTimeout(150);
  const canvas = page.locator('#app canvas:not(.zen-minimap)').first();
  await expect(canvas).toBeVisible();
  await canvas.screenshot({ path: OUT });

  // Sanity: a real, non-trivial PNG (not a blank/failed grab).
  expect(existsSync(OUT)).toBe(true);
  expect(statSync(OUT).size).toBeGreaterThan(10_000);
});
