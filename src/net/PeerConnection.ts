/**
 * WebRTC peer connection for MP-1 PR1 — CONNECTION FOUNDATION ONLY.
 *
 * Two browsers connect via a match code over the store-and-poll signaling, open an
 * UNRELIABLE/UNORDERED DataChannel ({ordered:false, maxRetransmits:0} — the exact
 * transport intent-streaming will use later), and exchange a heartbeat for an RTT
 * readout. NO gameplay here: the channel carries only ping/pong + the determinism
 * probe this PR. Non-trickle ICE (gather fully, then post one SDP) keeps signaling
 * to a simple offer→answer swap (no candidate-list polling).
 *
 * Layering: this is client INFRA (src/net) — it may use WebRTC/DOM, like the
 * rendering layer. It never imports or mutates the pure sim (src/game stays pure).
 */

import { iceServers } from './iceServers';
import { postSDP, pollSDP } from './signaling';
import { NET } from '../utils/constants';

export type ConnState = 'idle' | 'signaling' | 'connecting' | 'connected' | 'failed' | 'closed';

export interface PeerEvents {
  /** Connection state changes (with optional human-readable info). */
  onState?: (state: ConnState, info?: string) => void;
  /** The host's generated match code, as soon as it exists (for the UI to show). */
  onCode?: (code: string) => void;
  /** Round-trip time in ms from the heartbeat. */
  onRtt?: (ms: number) => void;
  /** An APP message arrived (anything that isn't the internal heartbeat). */
  onMessage?: (msg: unknown) => void;
}

type HeartbeatMsg = { t: '__ping' | '__pong'; sentAt: number };

function randomCode(): string {
  const a = NET.codeAlphabet;
  let s = '';
  for (let i = 0; i < NET.codeLength; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

export class PeerConnection {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly abort = new AbortController();
  private closed = false;
  private readonly events: PeerEvents;

  constructor(events: PeerEvents = {}) {
    this.events = events;
    this.pc = new RTCPeerConnection({ iceServers: iceServers() });
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed') this.setState('failed', 'peer connection failed');
      else if (s === 'disconnected') this.setState('failed', 'peer disconnected');
    };
  }

  /** HOST: generate a code, create the channel + offer, post it, await the answer. */
  async host(): Promise<void> {
    const code = randomCode();
    this.events.onCode?.(code);
    this.wireChannel(this.pc.createDataChannel('mp', { ordered: false, maxRetransmits: 0 }));
    this.setState('signaling', `code ${code} — waiting for a peer`);
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.iceComplete();
    await postSDP(code, 'offer', JSON.stringify(this.pc.localDescription));
    const answer = await pollSDP(code, 'answer', this.abort.signal);
    this.setState('connecting', 'peer found — connecting');
    await this.pc.setRemoteDescription(JSON.parse(answer) as RTCSessionDescriptionInit);
  }

  /** JOIN: fetch the host's offer for the code, answer it, post the answer. */
  async join(code: string): Promise<void> {
    this.pc.ondatachannel = (e) => this.wireChannel(e.channel);
    this.setState('signaling', `joining ${code}`);
    const offer = await pollSDP(code, 'offer', this.abort.signal);
    await this.pc.setRemoteDescription(JSON.parse(offer) as RTCSessionDescriptionInit);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.iceComplete();
    await postSDP(code, 'answer', JSON.stringify(this.pc.localDescription));
    this.setState('connecting', 'connecting');
  }

  /** Send an app message (JSON) over the data channel. No-op if not open. */
  send(msg: unknown): void {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(msg));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.dc?.close();
    this.pc.close();
    this.setState('closed');
  }

  // --- internals ---------------------------------------------------------------

  private wireChannel(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.onopen = () => {
      this.setState('connected');
      this.startHeartbeat();
    };
    dc.onclose = () => this.setState('closed');
    dc.onmessage = (e) => this.onChannelMessage(e.data);
  }

  private onChannelMessage(data: unknown): void {
    let msg: unknown;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : '');
    } catch {
      return;
    }
    const hb = msg as Partial<HeartbeatMsg>;
    if (hb.t === '__ping' && typeof hb.sentAt === 'number') {
      this.send({ t: '__pong', sentAt: hb.sentAt } satisfies HeartbeatMsg);
      return;
    }
    if (hb.t === '__pong' && typeof hb.sentAt === 'number') {
      this.events.onRtt?.(Math.round(performance.now() - hb.sentAt));
      return;
    }
    this.events.onMessage?.(msg); // an app message (e.g. the probe)
  }

  private startHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    const ping = () => this.send({ t: '__ping', sentAt: performance.now() } satisfies HeartbeatMsg);
    ping();
    this.heartbeat = setInterval(ping, NET.heartbeatMs);
  }

  /** Wait until ICE gathering finishes (non-trickle) so the posted SDP carries all
   *  candidates. A safety timeout resolves anyway (some browsers stall on 'gathering'). */
  private iceComplete(): Promise<void> {
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        if (this.pc.iceGatheringState === 'complete') {
          this.pc.removeEventListener('icegatheringstatechange', done);
          resolve();
        }
      };
      this.pc.addEventListener('icegatheringstatechange', done);
      setTimeout(resolve, NET.iceGatheringTimeoutMs);
    });
  }

  private setState(state: ConnState, info?: string): void {
    if (this.closed && state !== 'closed') return;
    this.events.onState?.(state, info);
  }
}
