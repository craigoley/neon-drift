import { defineConfig, devices } from '@playwright/test';

// L3 LIVE-VALIDATION / BUG-HUNT SWEEP — the live/soak layer the L1 Vitest suite and the L2
// smoke/visual specs structurally can't cover on a Three.js <canvas>: console-clean over real
// interactions + a SUSTAINED unfrozen Zen soak (drive across biomes, warp into a secret area +
// back, through a tunnel, catching air) asserting OBJECTIVE failures only — no crash, no console
// error, no freeze/stall, no NaN, no unbounded growth, no transition desync. It does NOT assert
// FEEL (camera whip / jump softness / lurch stay human phone playtest).
//
// FIND, DON'T FIX: a real finding on main is reported for a SEPARATE triage PR, not patched here.
// Reads window.__neonDebug (a read-only state mirror, dev/?debug-gated). Reuses the same Vite dev
// server + e2e/_helpers.ts as the smoke. Run: `npx playwright install chromium`, then
// `npm run e2e:validation`.
export default defineConfig({
  testDir: './e2e',
  testMatch: /validation\.spec\.ts/,
  fullyParallel: false, // the soak owns the dev server for its full run
  forbidOnly: !!process.env.CI,
  retries: 0, // a soak failure is a finding to investigate, not to paper over with a retry
  workers: 1,
  // The Zen soak runs the real RAF loop for a sustained stretch (~60-120s) plus the flow walk —
  // well past the smoke's 90s. This is the soak's budget, kept OUT of the smoke config so it
  // never relaxes the smoke timeout. (Per recon principle #4: diagnose a hang via the per-state
  // "[VALIDATION] entering state=X" logs BEFORE blaming this budget.)
  timeout: 240_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  // Reuse the existing harness: the Vite dev server (where import.meta.env.DEV is true, so the
  // __neonDebug hook is present without needing ?debug). PROD-PARITY OPTION (not the default,
  // matching the existing e2e): `vite build` + `vite preview` of dist/ with `?debug=1` to validate
  // the shipped bundle — flagged here; default to the dev server to match smoke/visual.
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
