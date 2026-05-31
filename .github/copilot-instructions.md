# Neon Drift — Copilot Review Instructions
Browser 3D game. Vite + TypeScript + Three.js. No React, no SSR.
Flag on review:
- Any 'three' import under src/game/ (must be pure)
- Magic numbers outside utils/constants.ts
- Object allocation inside the rAF loop
- Touch controls missing parity with keyboard
- Implicit any
- CommonJS require() (must be ESM for Vite)
