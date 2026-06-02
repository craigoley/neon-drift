// @vitest-environment jsdom
/**
 * Integration probe for the combo funnel's DETECTION->INCREMENT->DISPLAY path —
 * the part the pure tests never exercised. Drives the real resolveTraffic +
 * HUD.sync and reads the actual DOM text the player would see.
 */
import { describe, expect, it } from 'vitest';
import { HUD } from '../../rendering/HUD';
import { createGameState, startRun, update } from '../GameState';
import { resolveTraffic } from '../Scoring';
import type { InputIntent } from '../Input';
import { SCORING, TIMESTEP } from '../../utils/constants';

function comboText(parent: HTMLElement): string | null {
  return parent.querySelector('.hud-combo')?.textContent ?? null;
}

describe('HUD combo funnel (detection -> increment -> display)', () => {
  it('step 6: the HUD combo element reflects a high INTERNAL combo', () => {
    const parent = document.createElement('div');
    const hud = new HUD(parent);
    const game = startRun(createGameState(1));
    game.score.combo = 5;
    hud.sync(game, { distance: 0, score: 0 });
    expect(comboText(parent)).toBe('x5.0');
  });

  it('FULL FUNNEL: a planted near-miss raises the combo via resolveTraffic AND the HUD shows it', () => {
    const parent = document.createElement('div');
    const hud = new HUD(parent);
    const game = startRun(createGameState(1));

    hud.sync(game, { distance: 0, score: 0 });
    expect(comboText(parent)).toBe('x1.0');

    // Plant an obstacle the player has just overtaken, within the near-miss gap.
    const o = game.traffic.pool[0];
    o.active = true;
    o.passed = false;
    o.lateral = SCORING.nearMissLateral - 1; // inside the window, clear of collision
    o.laneOffset = o.lateral;
    o.distance = 99;
    resolveTraffic(game.lastEvents, game.score, 0, 100, game.traffic);

    expect(game.lastEvents.nearMisses).toBe(1); // detection fired
    expect(game.score.combo).toBeGreaterThan(1); // increment happened

    hud.sync(game, { distance: 0, score: 0 });
    expect(comboText(parent)).toBe(`x${game.score.combo.toFixed(1)}`); // display matches
    expect(comboText(parent)).not.toBe('x1.0');
  });

  it('MAIN-LOOP REPLICA: combo climbs and the HUD reflects it across simulated frames', () => {
    const parent = document.createElement('div');
    const hud = new HUD(parent);
    const game = startRun(createGameState(7));
    const intent: InputIntent = { steer: 0, deploySlowMo: false, restart: false };

    // Replicate main.ts: fixed-timestep update loop, then hud.sync once per frame.
    // Invariant under test: the HUD combo text MIRRORS the internal combo on
    // every single frame (this is exactly the desync the symptom would be).
    let frames = 0;
    for (let frame = 0; frame < 60 * 60; frame++) {
      update(game, intent, TIMESTEP);
      hud.sync(game, { distance: 0, score: 0 });
      expect(comboText(parent)).toBe(`x${game.score.combo.toFixed(1)}`);
      frames++;
      if (game.phase !== 'playing') break;
    }
    expect(frames).toBeGreaterThan(0);
  });
});
