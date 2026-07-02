/**
 * vs-COMPUTER entry: a tiny difficulty picker (EASY / MEDIUM / HARD). On pick it
 * starts a LOCAL BotRace against an AI car on a shared course and hands the running
 * race back to the composition root (which steps it + shows the rival car). The
 * in-race HUD is the SHARED RaceHud — identical to the 2-player race. No network.
 */

import { BotRace } from './BotRace';
import { RaceHud, type RaceView } from './RaceHud';
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
  /** Fired ONCE when the race finishes (with the final view) — for the PROG-1 win
   *  credit award. */
  onResult?: (view: RaceView) => void;
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
// The mode label sits just BELOW the main stats bar (top:0, ~44px tall) — its own slot, clear of the
// speed/best readout it used to overlap. The position/gap readout (RaceHud) sits below this in turn.
const STRIP = 'position:fixed;top:calc(50px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:9998;background:rgba(26,0,51,0.85);color:#e9d5ff;font:600 13px system-ui,sans-serif;padding:6px 12px;border-radius:8px;';
// Mirrors the shell's `.shell-btn--ghost` design tokens (audit #191, F13) — cyan outline,
// 10px radius, uppercase, cyan glow, 46px tap target — so the picker matches the rest of the
// shell. Kept inline (not the CSS class) to preserve this panel's deliberate self-contained
// styling (see the file header) and its compact width.
const BTN = "font:800 clamp(15px,4.2vw,18px) 'Segoe UI',system-ui,sans-serif;letter-spacing:0.1em;text-transform:uppercase;padding:12px 24px;min-height:46px;min-width:8em;border:2px solid #00ffff;background:transparent;color:#00ffff;border-radius:10px;box-shadow:0 0 12px rgba(0,255,255,0.35);cursor:pointer;";

// Descriptors as PHRASE arrays (rendered as nowrap "beats" joined by · — see the loop below): so a
// phrase never breaks mid-word + the separators read. HONEST about rubber-banding now that EASY has
// catch-up: EASY signals it helps you ("stumbles when ahead"); MEDIUM/HARD state they DON'T ("no
// catch-up" / "no mercy") — the no-rubber-banding promise now lives where it's actually true.
const TIERS: ReadonlyArray<{ id: BotDifficulty; label: string; phrases: readonly string[] }> = [
  { id: 'easy', label: 'EASY', phrases: ['sees late', 'stumbles when ahead', 'a beginner can win'] },
  { id: 'medium', label: 'MEDIUM', phrases: ['a steady, fair opponent', 'no catch-up'] },
  { id: 'hard', label: 'HARD', phrases: ['sees far', 'clean dodges', 'no mercy'] },
];

export function mountBotRaceUI(parent: HTMLElement, opts: BotRaceUIOptions): void {
  const root = el('div', PANEL);
  root.className = 'bot-race-ui';
  // All-caps to match the menu tile "VS COMPUTER" + the shell's uppercase titles (audit #191, F13).
  const title = el('h1', 'color:#ff00ff;text-shadow:0 0 12px #ff00ff;margin:0;font-size:clamp(20px,5vw,30px);letter-spacing:0.08em;', 'VS COMPUTER');
  const sub = el('p', 'opacity:0.7;margin:0;max-width:30em;', 'Race an AI opponent on a shared course. Pick your challenge.');
  const tiers = el('div', 'display:flex;flex-direction:column;gap:10px;align-items:center;');
  // BACK now uses the same cyan ghost token as the rest (was grey #888 — a different system, F13).
  const backBtn = el('button', BTN, 'BACK');
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
  let resultFired = false; // one-shot guard so the win credit awards exactly once
  const pick = (tier: { id: BotDifficulty; label: string }) => {
    started = tier.label;
    race = new BotRace(BOT_DIFFICULTY[tier.id], {
      onRaceState: (v) => {
        raceHud.render(v);
        if (v.finished && !resultFired) {
          resultFired = true;
          opts.onResult?.(v);
        }
      },
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
    // TYPOGRAPHY (UI/UX): each phrase is a NOWRAP "beat" (so it never breaks mid-word — no "a / beginner
    // can win"), joined by a leading "· " that stays glued to its phrase, so a wrap can ONLY happen
    // between beats with the middot leading the continuation line. `text-wrap: balance` evens the line
    // lengths (kills orphans/ragged breaks); max-width in CH targets ~34 chars/line (mobile microcopy);
    // line-height 1.45 + the wrap's gap give it breathing room as a caption for THIS button.
    const blurb = el('div', 'font:500 12.5px/1.45 system-ui,sans-serif;color:#c9a8ff;max-width:34ch;text-align:center;text-wrap:balance;');
    blurb.innerHTML = tier.phrases
      .map((p, i) => `<span style="white-space:nowrap">${i === 0 ? '' : '· '}${p}</span>`)
      .join(' ');
    const wrap = el('div', 'display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:6px;');
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
