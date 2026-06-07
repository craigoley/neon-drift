/**
 * Client side of the store-and-poll signaling (MP-1 PR1). Thin fetch wrapper around
 * /api/signal: POST your SDP under a match code, poll for the peer's. Carries NO
 * game data — only the one-time WebRTC handshake.
 */

import { NET } from '../utils/constants';

export type SignalRole = 'offer' | 'answer';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Store this peer's SDP under the match code. */
export async function postSDP(code: string, role: SignalRole, sdp: string): Promise<void> {
  const res = await fetch(`/api/signal?code=${encodeURIComponent(code)}&role=${role}`, {
    method: 'POST',
    body: sdp,
  });
  if (!res.ok) throw new Error(`signaling POST ${role} failed (${res.status})`);
}

/** Poll for the peer's SDP until it appears, the timeout elapses, or aborted. */
export async function pollSDP(code: string, role: SignalRole, signal?: AbortSignal): Promise<string> {
  const deadline = Date.now() + NET.signalTimeoutMs;
  for (;;) {
    if (signal?.aborted) throw new Error('signaling aborted');
    const res = await fetch(`/api/signal?code=${encodeURIComponent(code)}&role=${role}`);
    if (res.ok) return res.text();
    if (res.status !== 404) throw new Error(`signaling GET ${role} failed (${res.status})`);
    if (Date.now() > deadline) throw new Error('signaling timed out (no peer joined)');
    await sleep(NET.signalPollMs);
  }
}
