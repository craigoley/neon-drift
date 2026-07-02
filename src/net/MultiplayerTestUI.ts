/**
 * MULTIPLAYER CONNECTION TEST screen (MP-1 PR1). A standalone full-screen overlay
 * (reached via ?mp=1) that proves the INFRA before any gameplay exists:
 *   1. two browsers connect via a match code over WebRTC,
 *   2. a heartbeat shows the RTT,
 *   3. the cross-engine determinism probe runs over the link and reports OK/MISMATCH.
 *
 * NO game / racing here by design. Self-contained DOM (inline styles) so it doesn't
 * touch the game Shell or its visual baselines. Reachable in production builds (Craig
 * tests Chrome-vs-Safari on real devices against the deployed signaling function).
 */

import { PeerConnection, type ConnState } from './PeerConnection';
import { reportConnectError } from './connectionStatus';
import { hasTurn } from './iceServers';
import { compareProbe, probeChecksum, type ProbeChecksum } from './probe';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = style;
  if (text !== undefined) e.textContent = text;
  return e;
}

const PANEL = 'position:fixed;inset:0;z-index:9999;background:#1a0033;color:#e9d5ff;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;';
const BTN = 'font:inherit;font-weight:700;padding:12px 20px;border:2px solid #00ffff;background:transparent;color:#00ffff;border-radius:8px;cursor:pointer;';
const INPUT = 'font:inherit;text-transform:uppercase;letter-spacing:0.2em;padding:10px;width:8em;text-align:center;border:2px solid #ff00ff;background:#0a001a;color:#fff;border-radius:8px;';

export function mountMultiplayerTest(parent: HTMLElement): void {
  const root = el('div', PANEL);
  root.className = 'mp-test';

  const title = el('h1', 'color:#ff00ff;text-shadow:0 0 12px #ff00ff;margin:0;font-size:clamp(20px,5vw,32px);', 'MULTIPLAYER — CONNECTION TEST');
  const sub = el('p', 'opacity:0.7;margin:0;max-width:34em;', 'PR1: connect two browsers, measure RTT, and run the cross-engine determinism probe. No racing yet.');

  const hostBtn = el('button', BTN, 'HOST');
  const codeInput = el('input', INPUT) as HTMLInputElement;
  codeInput.placeholder = 'CODE';
  codeInput.maxLength = 8;
  const joinBtn = el('button', BTN, 'JOIN');
  const joinRow = el('div', 'display:flex;gap:8px;align-items:center;');
  joinRow.append(codeInput, joinBtn);

  const codeLine = el('p', 'font-size:clamp(28px,9vw,56px);font-weight:800;letter-spacing:0.3em;color:#00ffff;text-shadow:0 0 16px #00ffff;margin:8px 0;min-height:1em;');
  const statusLine = el('p', 'margin:0;font-size:18px;', 'idle');
  const rttLine = el('p', 'margin:0;opacity:0.85;');
  const detLine = el('p', 'margin:0;font-weight:800;font-size:20px;');
  const turnLine = el('p', 'margin:0;opacity:0.6;font-size:13px;max-width:34em;',
    hasTurn() ? 'TURN relay configured.' : 'STUN-only (no TURN): some networks (symmetric NAT, ~1 in 6) will fail to connect — configure VITE_TURN_* for reliability.');
  const hint = el('p', 'opacity:0.5;font-size:12px;', 'Cross-engine test: open Chrome on one device + Safari on another, HOST on one, JOIN with the code on the other, read "determinism".');

  const controls = el('div', 'display:flex;gap:16px;align-items:center;flex-wrap:wrap;justify-content:center;');
  controls.append(hostBtn, el('span', 'opacity:0.5;', 'or'), joinRow);

  // Fixed ‹ BACK escape (audit #191) — this ?mp=1 overlay had NO exit but browser chrome,
  // the same store-trap class fixed for the store (#180) + leaderboard. Reuse the global
  // `.shell-back` style/placement. There's no Shell handle here, so BACK navigates to the
  // root: a clean return to the menu that also tears down the peer and drops ?mp=1 (so a
  // refresh can't re-trap you).
  const back = el('button', '', '‹ BACK');
  back.className = 'shell-back';
  back.type = 'button';
  back.setAttribute('aria-label', 'Back to menu');
  back.addEventListener('click', () => {
    window.location.href = '/';
  });

  root.append(back, title, sub, controls, codeLine, statusLine, rttLine, detLine, turnLine, hint);
  parent.append(root);

  // --- connection + probe orchestration --------------------------------------
  let peer: PeerConnection | null = null;
  let localProbe: ProbeChecksum | null = null;
  let remoteProbe: ProbeChecksum | null = null;

  const setStatus = (s: ConnState, info?: string) => {
    statusLine.textContent = info ? `${s} · ${info}` : s;
    statusLine.style.color = s === 'connected' ? '#39ff14' : s === 'failed' ? '#ff6600' : '#e9d5ff';
  };

  /** On connect: compute our checksum once, send it, and compare when both exist. */
  const runProbe = () => {
    if (!peer) return;
    if (!localProbe) {
      detLine.textContent = 'determinism: running probe…';
      localProbe = probeChecksum();
      peer.send({ t: 'probe', checksum: localProbe });
    }
    if (localProbe && remoteProbe) {
      const v = compareProbe(localProbe, remoteProbe);
      detLine.textContent = `determinism: ${v.ok ? 'OK ✓' : 'MISMATCH ✗'} — ${v.detail}`;
      detLine.style.color = v.ok ? '#39ff14' : '#ff6600';
    }
  };

  const events = {
    onCode: (code: string) => {
      codeLine.textContent = code;
    },
    onState: (s: ConnState, info?: string) => {
      setStatus(s, info);
      if (s === 'connected') runProbe();
    },
    onRtt: (ms: number) => {
      rttLine.textContent = `RTT: ${ms} ms`;
    },
    onMessage: (msg: unknown) => {
      const m = msg as { t?: string; checksum?: ProbeChecksum };
      if (m.t === 'probe' && m.checksum) {
        remoteProbe = m.checksum;
        runProbe();
      }
    },
  };

  const begin = (start: (p: PeerConnection) => Promise<void>) => {
    hostBtn.disabled = joinBtn.disabled = true;
    peer = new PeerConnection(events);
    start(peer).catch((err) => {
      setStatus('failed', reportConnectError(err)); // logs the detail, shows the human message
      hostBtn.disabled = joinBtn.disabled = false; // allow a retry / fresh code
    });
  };

  hostBtn.addEventListener('click', () => begin((p) => p.host()));
  joinBtn.addEventListener('click', () => {
    const code = codeInput.value.trim().toUpperCase();
    if (code) begin((p) => p.join(code));
  });
}
