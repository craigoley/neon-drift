// ESLint flat config (eslint.config.js). typescript-eslint "recommended" (syntactic — no type
// info needed, so it's fast and CI-stable). Build (tsc) handles type errors;
// this catches lint-class issues (unused vars, unsafe patterns, etc).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Generated / vendored output is never linted (coverage = a future `vitest --coverage` dir).
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The game ships to the browser; tests run under jsdom — both browser-global.
    languageOptions: {
      globals: { ...globals.browser },
    },
    // HARDENING (additive, BUG-CATCHING — not stylistic; formatting is left to the editor/Prettier).
    // Kept SYNTACTIC (no type-info) to preserve the existing fast/CI-stable design — type-aware rules
    // like @typescript-eslint/no-floating-promises are a deliberate future opt-in, NOT added here (the
    // codebase already uses `void` for fire-and-forget promises). All of these are zero-violation on the
    // current tree, so lint stays green.
    rules: {
      'no-debugger': 'error', // a stray `debugger` must never ship
      'no-alert': 'error', //    alert/confirm/prompt don't belong in the game UI
      'no-var': 'error', //      `var` hoisting footguns — use let/const
      // Catch stray debug `console.log`; the intentional MP/diagnostic console.error/.warn stay allowed.
      // 'warn' (not 'error') so it surfaces in output without failing `eslint .` (no --max-warnings).
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Tooling configs + Playwright e2e specs run under Node, not the browser.
    files: ['*.config.{js,ts}', 'e2e/**/*.ts', 'api/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Tests + e2e specs legitimately use console for diagnostics (they never ship) — the no-console
    // rule targets SHIPPING code only. Other hardening rules still apply here.
    files: ['**/__tests__/**', '**/*.test.ts', 'e2e/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
