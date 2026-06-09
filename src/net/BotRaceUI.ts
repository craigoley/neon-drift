/**
 * vs-COMPUTER entry: a tiny difficulty picker (EASY / MEDIUM / HARD). On pick it
 * starts a LOCAL BotRace against an AI car on a shared course and hands the running
 * race back to the composition root (which steps it + shows the rival car). The
 * in-race HUD is the SHARED RaceHud — identical to the 2-player race. No network.
 */

import { BotRace } from './BotRace';
import { RaceHud } from './RaceHud';
import type { GameState } from '../game/GameState';
import { BOT_DIFFICULTY, type BotDifficulty } from '../utils/constants';

export interface BotRaceUIOptions {
  /** The app's local GameState — bound + raced by BotRace (renderers read it). */
  game: GameState;
  /** The player's selected car id. */
  localCarId: string;
  /** The bot's car id (a visually distinct rival, chosen by the composition root). */
  botCarId: string;
  /** A fresh run seed for the race (shared by both cars). */
  makeSeed: () => number;
  /** Called once the race starts, so the composition root steps it + shows the rival. */
  onRacing: (race: BotRace) => void;
  /** The PLAYER took a crash-slowdown — for a crash cue (flash/thump). */
  onLocalCrash?: () => void;
  /** Leave a finished race → tear down (close, reset game, show menu). */
  onLeaveRace?: () => void;
  /** Backed out before racing. */
  onExit: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = style;
  if (text !== undefined) e.textContent = text;
  return e;
}

const PANEL = 'position:fixed;inset:0;z-index:9998;background:rgba(26,0,51,0.96);color:#e9d5ff;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;';
const STRIP = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:9998;background:rgba(26,0,51,0.85);color:#e9d5ff;font:600 13px system-ui,sans-serif;padding:6px 12px;border-radius:8px;';
const BTN = 'font:inherit;font-weight:700;padding:12px 24px;border:2px solid #00ffff;background:transparent;color:#00ffff;border-radius:8px;cursor:pointer;min-width:8em;';

const TIERS: ReadonlyArray<{ id: BotDifficulty; label: string; blurb: string }> = [
  { id: 'easy', label: 'EASY', blurb: 'sees late · dodges loosely · a beginner can win' },
  { id: 'medium', label: 'MEDIUM', blurb: 'a steady, fair opponent' },
  { id: 'hard', label: 'HARD', blurb: 'sees far · clean dodges · a real challenge' },
];

export function mountBotRaceUI(parent: HTMLElement, opts: BotRaceUIOptions): void {
  const root = el('div', PANEL);
  root.className = 'bot-race-ui';
  const title = el('h1', 'color:#ff00ff;text-shadow:0 0 12px #ff00ff;margin:0;font-size:clamp(20px,5vw,30px);', 'vs COMPUTER');
  const sub = el('p', 'opacity:0.7;margin:0;max-width:30em;', 'Race an AI opponent on a shared course. Pick a difficulty — the bot plays at its skill, no rubber-banding.');
  const tiers = el('div', 'display:flex;flex-direction:column;gap:10px;align-items:center;');
  const backBtn = el('button', `${BTN};border-color:#888;color:#bbb`, 'BACK');
  root.append(title, sub, tiers);

  const strip = el('div', STRIP, '');
  strip.className = 'bot-race-strip';
  strip.style.display = 'none';
  parent.append(strip);

  let race: BotRace | null = null;

  const leaveRace = () => {
    raceHud.remove();
    race?.close();
    strip.remove();
    opts.onLeaveRace?.();
  };
  const raceHud = new RaceHud(parent, {
    onLeave: leaveRace,
    winSubtitle: () => `you beat the ${started ?? ''} bot`,
  });

  let started: string | null = null;
  const pick = (tier: { id: BotDifficulty; label: string }) => {
    started = tier.label;
    race = new BotRace(BOT_DIFFICULTY[tier.id], {
      onRaceState: (v) => raceHud.render(v),
      onLeadChange: (localLeads) => raceHud.flashLead(localLeads),
      onLocalCrash: () => opts.onLocalCrash?.(),
    });
    root.remove(); // hide the picker; the race is on
    strip.textContent = `RACING · vs COMPUTER · ${tier.label}`;
    strip.style.display = 'block';
    race.begin(opts.game, opts.makeSeed(), opts.localCarId, opts.botCarId);
    opts.onRacing(race);
  };

  for (const tier of TIERS) {
    const btn = el('button', BTN, tier.label);
    const blurb = el('div', 'font:500 11px system-ui,sans-serif;opacity:0.6;margin-top:-4px;', tier.blurb);
    const wrap = el('div', 'display:flex;flex-direction:column;align-items:center;gap:2px;');
    wrap.append(btn, blurb);
    tiers.append(wrap);
    btn.addEventListener('click', () => pick(tier));
  }
  tiers.append(backBtn);
  parent.append(root);

  backBtn.addEventListener('click', () => {
    raceHud.remove();
    strip.remove();
    root.remove();
    opts.onExit();
  });
}
