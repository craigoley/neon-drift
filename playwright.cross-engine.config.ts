import { defineConfig, devices } from '@playwright/test';

/**
 * CROSS-ENGINE DETERMINISM HARNESS config (MP fix PR-A) — SEPARATE from the main
 * Playwright config on purpose. It is NON-BLOCKING and EXPECTED RED until PR-B
 * de-floats the transcendentals; keeping it in its own testDir/config means it never
 * enters the blocking `npm run e2e` (smoke/visual) gate.
 *
 * The spec itself launches BOTH chromium (V8) and webkit (JavaScriptCore) — so the
 * "project" here is just the test-runner host. Requires the webkit browser:
 *   npx playwright install webkit
 * Run: `npm run e2e:cross-engine`.
 */
export default defineConfig({
  testDir: './e2e-cross-engine',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  // Each test launches two browsers and steps thousands of sim frames in each.
  timeout: 180_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: 'cross-engine-host', use: { ...devices['Desktop Chrome'] } }],
});
