/**
 * Shared in-race HUD: position + gap readout, a finish-progress bar with a YOU + a
 * RIVAL marker, the overtake/passed toast, and the win/lose/draw result card. Pure
 * DOM (inline styles), no game/sim coupling — it renders a `RaceView` snapshot.
 *
 * Extracted from the 2-player overlay so BOTH the live MP race and the local
 * vs-COMPUTER race present the IDENTICAL race HUD (no duplication). Each mode keeps
 * its own lobby + status strip; this owns only the shared in-race chrome.
 */

import { finishProgress, type RaceResult } from './raceLogic';
import { CSS_PALETTE, MP_RACE } from '../utils/constants';

/** The per-tick snapshot the HUD renders (mode-agnostic: MP and bot both produce it). */
export interface RaceView {
  /** This player's car distance. */
  localDistance: number;
  /** The rival (remote / bot) car distance. */
  rivalDistance: number;
  /** Finish line distance. */
  finishDistance: number;
  /** localDistance − rivalDistance (positive = local ahead). */
  gap: number;
  /** True if the local car currently leads (with deadband). */
  localLeads: boolean;
  /** Race over. */
  finished: boolean;
  /** This player's result once finished, else null. */
  result: RaceResult | null;
  /** True if the race ended because the opponent disconnected (MP only). */
  disconnected: boolean;
}

const AHEAD = CSS_PALETTE.ahead;
const BEHIND = CSS_PALETTE.behind;
const YOU = CSS_PALETTE.cyan;
const RIVAL = CSS_PALETTE.magenta;
const m = (d: number) => `${Math.round(d)}m`;

const markerStyle = (color: string) =>
  `position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;` +
  `background:${color};box-shadow:0 0 10px ${color};transition:left 0.08s linear,transform 0.15s;`;

const PANEL =
  'position:fixed;inset:0;z-index:9998;background:rgba(26,0,51,0.96);color:#e9d5ff;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;';
const BTN = 'font:inherit;font-weight:700;padding:12px 20px;border:2px solid #00ffff;background:transparent;color:#00ffff;border-radius:8px;cursor:pointer;';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = style;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface RaceHudOptions {
  /** Dismiss the result card (MENU / Esc) → leave the race. */
  onLeave: () => void;
  /** Subtitle on a WIN card (e.g. "first to 10000m" or "you beat the HARD bot"). */
  winSubtitle?: (v: RaceView) => string;
}

export class RaceHud {
  private readonly hud: HTMLElement;
  private readonly posEl: HTMLElement;
  private readonly gapEl: HTMLElement;
  private readonly finishEl: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly youMark: HTMLElement;
  private readonly rivalMark: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly card: HTMLElement;
  private readonly cardTitle: HTMLElement;
  private readonly cardSub: HTMLElement;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private raceOver = false;
  private readonly opts: RaceHudOptions;
  private readonly onKey: (e: KeyboardEvent) => void;

  constructor(parent: HTMLElement, opts: RaceHudOptions) {
    this.opts = opts;

    // Position + gap readout.
    this.hud = el(
      'div',
      'position:fixed;top:40px;left:50%;transform:translateX(-50%);z-index:9998;display:none;flex-direction:column;align-items:center;gap:2px;font-family:system-ui,sans-serif;text-shadow:0 0 8px currentColor;pointer-events:none;',
    );
    this.hud.className = 'race-hud';
    this.posEl = el('div', 'font:800 22px system-ui,sans-serif;letter-spacing:0.05em;');
    this.gapEl = el('div', 'font:700 16px ui-monospace,monospace;');
    this.finishEl = el('div', 'font:600 11px system-ui,sans-serif;opacity:0.6;color:#e9d5ff;');
    this.hud.append(this.posEl, this.gapEl, this.finishEl);
    parent.append(this.hud);

    // Finish-progress bar (NOT a minimap): two markers advancing toward the finish post.
    this.bar = el(
      'div',
      'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:9998;width:min(640px,88vw);display:none;pointer-events:none;font-family:system-ui,sans-serif;',
    );
    this.bar.className = 'race-progress';
    const track = el('div', 'position:relative;height:8px;border-radius:5px;background:rgba(233,213,255,0.16);box-shadow:inset 0 0 8px rgba(0,255,255,0.18);');
    const finishMark = el('div', 'position:absolute;right:-2px;top:-7px;width:4px;height:22px;border-radius:2px;background:#fff;box-shadow:0 0 10px #fff;');
    this.rivalMark = el('div', markerStyle(RIVAL));
    this.youMark = el('div', markerStyle(YOU)); // appended last → drawn on top
    track.append(finishMark, this.rivalMark, this.youMark);
    const legend = el('div', 'display:flex;justify-content:space-between;margin-top:5px;font:600 10px system-ui,sans-serif;opacity:0.75;');
    legend.append(
      el('span', `color:${YOU};text-shadow:0 0 6px ${YOU};`, '● YOU'),
      el('span', 'color:#e9d5ff;opacity:0.6;', `${m(MP_RACE.finishDistance)} FINISH`),
      el('span', `color:${RIVAL};text-shadow:0 0 6px ${RIVAL};`, 'RIVAL ●'),
    );
    this.bar.append(track, legend);
    parent.append(this.bar);

    // Transient overtake/passed alert.
    this.toast = el(
      'div',
      'position:fixed;top:38%;left:50%;transform:translateX(-50%);z-index:9999;font:900 clamp(26px,7vw,52px) system-ui,sans-serif;letter-spacing:0.08em;opacity:0;transition:opacity 0.25s;pointer-events:none;text-shadow:0 0 16px currentColor;',
    );
    this.toast.className = 'race-toast';
    parent.append(this.toast);

    // Win / lose / draw card.
    this.card = el('div', `${PANEL};display:none;background:rgba(26,0,51,0.92);`);
    this.card.className = 'race-result';
    this.cardTitle = el('h1', 'margin:0;font:900 clamp(34px,11vw,76px) system-ui,sans-serif;letter-spacing:0.06em;text-shadow:0 0 24px currentColor;', '');
    this.cardSub = el('p', 'margin:0;opacity:0.85;font-size:17px;', '');
    const menuBtn = el('button', BTN, 'MENU');
    this.card.append(this.cardTitle, this.cardSub, menuBtn);
    parent.append(this.card);
    menuBtn.addEventListener('click', () => this.opts.onLeave());

    this.onKey = (e: KeyboardEvent) => {
      if (this.raceOver && (e.key === 'Escape' || e.key === 'Enter')) this.opts.onLeave();
    };
    window.addEventListener('keydown', this.onKey);
  }

  /** Render one tick: the result card once finished, else the live HUD + bar. */
  render(v: RaceView): void {
    if (v.finished) this.showResult(v);
    else this.renderLive(v);
  }

  private renderLive(v: RaceView): void {
    this.hud.style.display = 'flex';
    const lead = v.localLeads;
    this.posEl.textContent = lead ? '1st' : '2nd';
    this.posEl.style.color = lead ? AHEAD : BEHIND;
    const ahead = v.gap >= 0;
    this.gapEl.textContent = `${ahead ? '+' : '−'}${m(Math.abs(v.gap))} ${ahead ? 'ahead' : 'behind'}`;
    this.gapEl.style.color = ahead ? AHEAD : BEHIND;
    this.finishEl.textContent = `finish in ${m(Math.max(0, v.finishDistance - v.localDistance))}`;

    this.bar.style.display = 'block';
    const youPct = finishProgress(v.localDistance, v.finishDistance) * 100;
    const rivalPct = finishProgress(v.rivalDistance, v.finishDistance) * 100;
    this.youMark.style.left = `${youPct}%`;
    this.rivalMark.style.left = `${rivalPct}%`;
    const near = MP_RACE.progressNearFinishFraction * 100;
    this.youMark.style.transform = youPct >= rivalPct && youPct >= near ? 'scale(1.45)' : 'scale(1)';
    this.rivalMark.style.transform = rivalPct > youPct && rivalPct >= near ? 'scale(1.45)' : 'scale(1)';
  }

  private showResult(v: RaceView): void {
    if (this.raceOver) return;
    this.raceOver = true;
    this.hud.style.display = 'none';
    this.bar.style.display = 'none';
    this.card.style.display = 'flex';
    if (v.disconnected) {
      this.cardTitle.textContent = 'YOU WIN';
      this.cardTitle.style.color = AHEAD;
      this.cardSub.textContent = 'opponent disconnected — win by default';
    } else if (v.result === 'win') {
      this.cardTitle.textContent = 'YOU WIN';
      this.cardTitle.style.color = AHEAD;
      this.cardSub.textContent = this.opts.winSubtitle ? this.opts.winSubtitle(v) : `first to ${m(v.finishDistance)}`;
    } else if (v.result === 'lose') {
      this.cardTitle.textContent = 'YOU LOSE';
      this.cardTitle.style.color = BEHIND;
      this.cardSub.textContent = 'rival reached the finish first';
    } else {
      this.cardTitle.textContent = 'DRAW';
      this.cardTitle.style.color = '#00ffff';
      this.cardSub.textContent = 'a dead heat';
    }
  }

  /** Flash the overtake (lead gained) / passed (lead lost) alert. */
  flashLead(localLeads: boolean): void {
    const text = localLeads ? 'OVERTAKE!' : 'PASSED';
    const color = localLeads ? AHEAD : BEHIND;
    this.toast.textContent = text;
    this.toast.style.color = color;
    this.toast.style.opacity = '1';
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast.style.opacity = '0'), MP_RACE.toastDurationMs);
  }

  /** Tear down all HUD DOM + listeners/timers. */
  remove(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    window.removeEventListener('keydown', this.onKey);
    this.hud.remove();
    this.bar.remove();
    this.toast.remove();
    this.card.remove();
  }
}
