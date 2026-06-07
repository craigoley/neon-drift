import { defineConfig, devices } from '@playwright/test';

// L2 SMOKE layer — deliberately SEPARABLE from the L1 Vitest suite. It catches the
// blank-screen / invisible-UI class of bug that L1 (pure, headless) is
// structurally blind to, because a Three.js <canvas> is one opaque rectangle to
// the DOM. Run locally: `npx playwright install chromium` once, then `npm run e2e`.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Generous per-test timeout: the menu/crash specs drive many interactions
  // against the Vite DEV server, whose first-request lazy compile is slow under
  // parallel workers (a cold start can push a heavy test well past the 30s
  // default). This is a gated/nightly job, so slow-but-stable is the right call.
  timeout: 90_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  // Boot the app's dev server for the smoke. (The production build is already
  // gated by the `build` CI job; the smoke only needs the app served.)
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
