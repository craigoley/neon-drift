/**
 * Minimal in-game 2-PLAYER entry (MP-1 PR2). A small overlay: Host (shows a code) /
 * Join (enter a code); on connect + handshake it starts the live lockstep race and
 * hands the running MpRace back to the composition root, then collapses to a tiny
 * status strip. The in-race HUD (position/gap/finish bar/overtake toast/result card)
 * is the SHARED RaceHud, used by both MP and vs-Computer. Self-contained DOM (inline
 * styles) so it doesn't touch the game Shell screens.
 *
 * Handshake (over the DataChannel, before racing):
 *   host → 'mp-hello' { seed, carId }     (host picks the shared seed)
 *   join → 'mp-ready' { carId }
 */

import { MpRace, type MpPhase, type MpRaceView } from './MpRace';
import { reportConnectError } from './connectionStatus';
import { RaceHud } from './RaceHud';
import type { GameState } from '../game/GameState';

export interface MpRaceUIOptions {
  /** The app's local GameState — bound + raced by MpRace (renderers read it). */
  game: GameState;
  /** The local player's selected car id. */
  localCarId: string;
  /** Called once the race is live, so the composition root starts stepping it. */
  onRacing: (race: MpRace) => void;
  /** The local car took an MP crash-slowdown — for a crash cue (flash/thump). */
  onLocalCrash?: () => void;
  /** Fired ONCE when the race finishes (with the final view) — for the PROG-1 win
   *  credit award. */
  onResult?: (view: MpRaceView) => void;
  /** Leave a finished/disconnected race → tear down (close, reset game, show menu). */
  onLeaveRace?: () => void;
  /** Called when the user backs out before racing. */
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
// Mirrors the shell's `.shell-btn--ghost` design tokens (audit #191, F13) — cyan outline,
// 10px radius, uppercase, cyan glow, 46px tap target — so the lobby matches the rest of the
// shell. Kept inline (not the CSS class) to preserve this panel's deliberate self-contained
// styling (see the file header) and a COMPACT width so the HOST / CODE / JOIN row doesn't wrap.
const BTN = "font:800 clamp(13px,3.4vw,15px) 'Segoe UI',system-ui,sans-serif;letter-spacing:0.08em;text-transform:uppercase;padding:11px 16px;min-height:46px;border:2px solid #00ffff;background:transparent;color:#00ffff;border-radius:10px;box-shadow:0 0 12px rgba(0,255,255,0.35);cursor:pointer;";
const INPUT = 'font:inherit;text-transform:uppercase;letter-spacing:0.2em;padding:10px;width:7em;text-align:center;border:2px solid #ff00ff;background:#0a001a;color:#fff;border-radius:8px;';

export function mountMpRaceUI(parent: HTMLElement, opts: MpRaceUIOptions): void {
  const root = el('div', PANEL);
  root.className = 'mp-race-ui';
  const title = el('h1', 'color:#ff00ff;text-shadow:0 0 12px #ff00ff;margin:0;font-size:clamp(20px,5vw,30px);', '2-PLAYER RACE');
  const sub = el('p', 'opacity:0.7;margin:0;max-width:30em;', 'Race a friend live on the same course. Host and share the code, or join with theirs.');
  const hostBtn = el('button', BTN, 'HOST');
  const codeInput = el('input', INPUT) as HTMLInputElement;
  codeInput.placeholder = 'CODE';
  codeInput.maxLength = 8;
  const joinBtn = el('button', BTN, 'JOIN');
  // BACK now uses the same cyan ghost token as the rest (was grey #888 — a different system, F13).
  const backBtn = el('button', BTN, 'BACK');
  const row = el('div', 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center;');
  row.append(hostBtn, el('span', 'opacity:0.5;', 'or'), codeInput, joinBtn);
  const codeLine = el('p', 'font-size:clamp(28px,9vw,52px);font-weight:800;letter-spacing:0.3em;color:#00ffff;text-shadow:0 0 16px #00ffff;margin:6px 0;min-height:1em;');
  const status = el('p', 'margin:0;font-size:16px;min-height:1.2em;', '');
  root.append(title, sub, row, codeLine, status, backBtn);
  parent.append(root);

  const strip = el('div', STRIP, '');
  strip.className = 'mp-race-strip';
  strip.style.display = 'none';
  parent.append(strip);

  let race: MpRace | null = null;
  let racingHandedOff = false;
  let resultFired = false; // one-shot guard so the win credit awards exactly once

  const leaveRace = () => {
    raceHud.remove();
    race?.close();
    strip.remove();
    opts.onLeaveRace?.();
  };

  // The shared in-race HUD (hidden until the first race tick renders it).
  const raceHud = new RaceHud(parent, { onLeave: leaveRace });

  const phase = (p: MpPhase, info?: string) => {
    if (p === 'racing' && !racingHandedOff && race) {
      racingHandedOff = true;
      root.remove(); // hide the lobby; the race is on
      strip.style.display = 'block';
      strip.textContent = 'RACING · 2P';
      opts.onRacing(race);
    } else if (p === 'racing' && racingHandedOff) {
      strip.textContent = 'RACING · 2P';
    } else if (p === 'stalled') {
      strip.textContent = 'waiting for opponent…';
    } else if (p === 'desynced') {
      // Diagnostic: make the readout big + red + sticky so Craig can read the field +
      // magnitude + frame mid-race without catching the console live.
      strip.textContent = `⚠ DESYNC ${info ?? ''}`.trim();
      strip.style.background = 'rgba(120,0,0,0.92)';
      strip.style.color = '#ffd0d0';
      strip.style.font = '700 15px ui-monospace,monospace';
      strip.style.padding = '8px 14px';
    } else if (p === 'failed') {
      // Stage-aware connection failure (e.g. ICE/no-route). Show it + allow a retry.
      status.textContent = info ?? 'connection failed';
      hostBtn.disabled = joinBtn.disabled = false;
    } else {
      status.textContent = info ? `${p} · ${info}` : p;
    }
  };

  const events = {
    onPhase: phase,
    onCode: (c: string) => (codeLine.textContent = c),
    onRtt: (ms: number) => {
      if (racingHandedOff) strip.textContent = `2P · ${ms} ms`;
    },
    onLocalCrash: () => opts.onLocalCrash?.(),
    onRaceState: (v: MpRaceView) => {
      raceHud.render(v);
      if (v.finished && !resultFired) {
        resultFired = true;
        opts.onResult?.(v);
      }
    },
    onLeadChange: (localLeads: boolean) => raceHud.flashLead(localLeads),
    onDisconnect: () => {
      /* handled via onRaceState (finished + disconnected) on the next tick */
    },
  };

  const begin = (isHost: boolean, code?: string) => {
    hostBtn.disabled = joinBtn.disabled = true;
    race = new MpRace(isHost, opts.localCarId, events);
    race.bindLocalGame(opts.game);
    const p = isHost ? race.host() : race.join(code ?? '');
    p.catch((err) => {
      status.textContent = reportConnectError(err); // logs the detail, returns the human message
      hostBtn.disabled = joinBtn.disabled = false; // let them retry / host a fresh code
    });
  };

  hostBtn.addEventListener('click', () => begin(true));
  joinBtn.addEventListener('click', () => {
    const code = codeInput.value.trim().toUpperCase();
    if (code) begin(false, code);
  });
  backBtn.addEventListener('click', () => {
    race?.close();
    raceHud.remove();
    strip.remove();
    root.remove();
    opts.onExit();
  });
}
