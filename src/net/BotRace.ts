/**
 * vs-COMPUTER race orchestration — LOCAL, no network. The bot car is a 2nd
 * GameState stepped with BOT-generated intents on the SAME shared course as the
 * player (mpRace=true → the #92 position-deterministic field), reusing the exact
 * ghost/MP seam: `update(state, intent, dt)`. This is `MpRace` minus the wire —
 * no PeerConnection, no Lockstep, no desync detector (a local sim can't desync).
 *
 * Winner/finish/lead reuse the pure raceLogic (decideWinner / leadWithDeadband /
 * resultFor) and the shared RaceHud view, so a bot race finishes + reads exactly
 * like a 2-player race. The player is the "host" role (local), the bot the "join".
 *
 * ANTI-RUBBER-BAND: the bot's intent is produced by botIntent(botGame, skill, rng)
 * — it is never handed the player's game/distance/gap, so it cannot catch up by
 * magic. Difficulty is the bot's SKILL only.
 */

import { createGameState, type GameState, GameMode, startRun, update } from '../game/GameState';
import { botIntent, catchUpSkill, createBotState, type BotState } from '../game/Bot';
import { decideWinner, leadWithDeadband, resultFor, type RaceWinner } from './raceLogic';
import type { RaceView } from './RaceHud';
import { handlingFor, MP_RACE, scoringFor, slowMoFor, TIMESTEP, type BotSkill } from '../utils/constants';
import type { InputIntent } from '../game/Input';

export interface BotRaceEvents {
  /** Per-tick race state for the shared HUD (position / gap / finish / result). */
  onRaceState?: (view: RaceView) => void;
  /** The lead changed — `localLeads` is the NEW state (overtake / passed alert). */
  onLeadChange?: (localLeads: boolean) => void;
  /** The PLAYER's car took a crash-slowdown this tick — for a crash cue. */
  onLocalCrash?: () => void;
}

export class BotRace {
  private readonly skill: BotSkill;
  private readonly events: BotRaceEvents;

  /** The two sims. `playerGame` is the app's `game` (bound at begin). */
  private playerGame: GameState | null = null;
  private bot: GameState | null = null;
  private botState: BotState | null = null;
  private botCar = '';

  private racing = false;
  /** Own fixed-timestep accumulator (the race steps independently of the SP loop). */
  private accumulator = 0;
  private frame = 0;

  // Race completion (deterministic; player = 'host' role, bot = 'join').
  private playerFinishFrame = -1;
  private botFinishFrame = -1;
  private finished = false;
  private winner: RaceWinner | null = null;
  private localLeads = true;

  constructor(skill: BotSkill, events: BotRaceEvents = {}) {
    this.skill = skill;
    this.events = events;
  }

  get isRacing(): boolean {
    return this.racing;
  }

  /** The bot's GameState (the rival the renderer draws), or null before begin. */
  get rivalGame(): GameState | null {
    return this.bot;
  }

  /** The bot's car id (for the rival renderer's cosmetic). */
  get rivalCarId(): string {
    return this.botCar;
  }

  /**
   * Bind the app's player GameState and start BOTH sims on the SAME seed with
   * mpRace=true (shared course + crash-slowdown). The bot gets its own seeded
   * mistake-rng. Renderers read `playerGame` + `rivalGame` after this.
   */
  begin(playerGame: GameState, seed: number, playerCarId: string, botCarId: string): void {
    this.playerGame = playerGame;
    this.botCar = botCarId;
    startRun(playerGame, handlingFor(playerCarId), 0, seed, scoringFor(playerCarId), GameMode.Classic, slowMoFor(playerCarId), true);
    this.bot = startRun(createGameState(seed), handlingFor(botCarId), 0, seed, scoringFor(botCarId), GameMode.Classic, slowMoFor(botCarId), true);
    this.botState = createBotState(seed);
    this.racing = true;
    this.emitRaceState();
  }

  /** Advance the race by one render tick: step both sims at the fixed timestep for
   *  the elapsed time, generating the bot's intent each sub-step. */
  tick(playerIntent: InputIntent, realDt: number): void {
    if (!this.racing || !this.playerGame || !this.bot || !this.botState) return;
    if (!this.finished) {
      this.accumulator += realDt;
      while (this.accumulator >= TIMESTEP) {
        this.accumulator -= TIMESTEP;
        // EASY-ONLY catch-up: shape the skill by the bot's current LEAD over the player BEFORE the intent
        // (botIntent itself stays position-blind). For MEDIUM/HARD catchUpSkill is a no-op → pure skill,
        // anti-rubber-band preserved. lead = bot ahead of player (positive).
        const lead = this.bot.distance - this.playerGame.distance;
        const intent = botIntent(this.botState, this.bot, catchUpSkill(this.skill, lead), TIMESTEP);
        update(this.playerGame, playerIntent, TIMESTEP); // consumes the deploy latch (one/press)
        update(this.bot, intent, TIMESTEP);
        if (this.playerGame.lastEvents.mpCrashed) this.events.onLocalCrash?.();
        this.frame++;
        if (this.detectFinish()) break;
      }
    }
    this.emitRaceState();
  }

  /** Record finish frames + finalize the winner the first frame any car crosses. */
  private detectFinish(): boolean {
    if (!this.playerGame || !this.bot) return false;
    const fin = MP_RACE.finishDistance;
    if (this.playerFinishFrame < 0 && this.playerGame.distance >= fin) this.playerFinishFrame = this.frame;
    if (this.botFinishFrame < 0 && this.bot.distance >= fin) this.botFinishFrame = this.frame;
    if (this.playerFinishFrame < 0 && this.botFinishFrame < 0) return false;
    this.finished = true;
    // player → 'host', bot → 'join' (the same tested tiebreak as MP).
    this.winner = decideWinner(this.playerFinishFrame, this.botFinishFrame, this.playerGame.distance, this.bot.distance);
    return true;
  }

  /** Build + push the per-tick HUD view, and fire the overtake alert on a lead flip. */
  private emitRaceState(): void {
    if (!this.playerGame || !this.bot) return;
    const localDistance = this.playerGame.distance;
    const rivalDistance = this.bot.distance;
    const gap = localDistance - rivalDistance;
    const leads = leadWithDeadband(this.localLeads, gap, MP_RACE.leadChangeDeadband);
    if (leads !== this.localLeads) {
      this.localLeads = leads;
      if (!this.finished) this.events.onLeadChange?.(leads);
    }
    this.events.onRaceState?.({
      localDistance,
      rivalDistance,
      finishDistance: MP_RACE.finishDistance,
      gap,
      localLeads: this.localLeads,
      finished: this.finished,
      result: this.finished && this.winner ? resultFor(this.winner, true) : null, // player = host
      disconnected: false,
    });
  }

  close(): void {
    this.racing = false;
  }
}
