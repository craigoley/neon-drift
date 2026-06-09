/**
 * BotRace (local vs-Computer) — end-to-end determinism + the anti-rubber-band
 * guarantee. A bot race is two GameStates on the same seed stepped at the fixed
 * timestep; the bot's intents come from botIntent (seeded, no player input), so the
 * whole race is reproducible AND the bot is provably independent of the player.
 */
import { describe, expect, it } from 'vitest';
import { BotRace } from '../BotRace';
import { createGameState } from '../../game/GameState';
import { createIntent, type InputIntent } from '../../game/Input';
import { BOT_DIFFICULTY, TIMESTEP } from '../../utils/constants';
import type { RaceView } from '../RaceHud';

const SEED = 99;

function runRace(seed: number, playerSteer: (t: number) => number, ticks: number) {
  const player = createGameState(seed);
  let last: RaceView | null = null;
  const race = new BotRace(BOT_DIFFICULTY.medium, { onRaceState: (v) => (last = v) });
  race.begin(player, seed, 'pulse', 'vapor');
  const botDist: number[] = [];
  const playerLat: number[] = [];
  for (let t = 0; t < ticks && !(last as RaceView | null)?.finished; t++) {
    const intent: InputIntent = createIntent();
    intent.steer = playerSteer(t);
    race.tick(intent, TIMESTEP);
    botDist.push(race.rivalGame!.distance);
    playerLat.push(player.vehicle.lateral);
  }
  return { last: last as RaceView | null, botDist, playerLat, playerDist: player.distance };
}

describe('BotRace — deterministic / replayable', () => {
  it('same seed + same player inputs → byte-identical race', () => {
    const a = runRace(SEED, () => 0, 600);
    const b = runRace(SEED, () => 0, 600);
    expect(a.botDist).toEqual(b.botDist);
    expect(a.playerDist).toBe(b.playerDist);
    expect(a.last?.localDistance).toBe(b.last?.localDistance);
    expect(a.last?.rivalDistance).toBe(b.last?.rivalDistance);
  });
});

describe('BotRace — anti-rubber-band (the bot ignores the player)', () => {
  it('the bot drives identically no matter how the player drives', () => {
    const cruise = runRace(SEED, () => 0, 600); // player holds centre
    const erratic = runRace(SEED, (t) => Math.sin(t * 0.3), 600); // player swerves
    // The player genuinely drove differently (different lateral trajectory)…
    expect(erratic.playerLat).not.toEqual(cruise.playerLat);
    // …yet the bot's trajectory is byte-identical — the player is not one of its inputs.
    expect(erratic.botDist).toEqual(cruise.botDist);
  });
});
