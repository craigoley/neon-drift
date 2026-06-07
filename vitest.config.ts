import { defineConfig } from 'vitest/config';

// Vitest is the L1 (pure, headless) test runner. Scope discovery to src/ so it
// never tries to run the Playwright e2e specs under e2e/ — those use a different
// runner/API (@playwright/test) and a real browser. (L1 and L2 are deliberately
// separable: Vitest owns src/**, Playwright owns e2e/**.)
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
