# Neon Drift
Synthwave endless racing game. TypeScript + Three.js + Vite.
Deployed to Vercel as a static site. Part of OleyArcade.

## Architecture
- src/game/ — pure TypeScript, ZERO three.js imports, Node-testable
- src/rendering/ — three.js layer, reads game state, never mutates it
- src/audio/ — Web Audio API, synthesized only, no audio files
Loop: input -> game.update() -> render -> repeat.

## Hard rules
- NEVER import 'three' anywhere under src/game/
- ALL tuning constants in utils/constants.ts — no magic numbers
- No external art assets — geometry is procedural
- No external audio files — sound is synthesized
- Mobile required: touch controls at parity with keyboard
- Palette: #ff00ff magenta, #00ffff cyan, #1a0033 deep purple,
  #ff6600 accent
- `npm run build` must pass before any PR
- Node pinned to 24.x (engines + .nvmrc)

## Testing
Vitest on the pure src/game/ layer. Tests in src/game/__tests__/.
No WebGL tests needed — game logic is pure.

## Deployment
Vercel auto-deploys on merge to main. Framework preset: Vite.
No server routes, no API endpoints — this is a static client app.

## PR workflow
Branch from latest main, PR, never commit to main directly.
Copilot + Claude Code review on PRs. PR pipeline auto-merges
iterative PRs after review passes.
