/**
 * Client side of the store-and-poll signaling (MP-1 PR1). Thin fetch wrapper around
 * /api/signal: POST your SDP under a match code, poll for the peer's. Carries NO
 * game data — only the one-time WebRTC handshake.
 */

import { NET } from '../utils/constants';
import { ConnectError } from './connectionStatus';

export type SignalRole = 'offer' | 'answer';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const url = (code: string, role: SignalRole) => `/api/signal?code=${encodeURIComponent(code)}&role=${role}`;

/** Store this peer's SDP under the match code. */
export async function postSDP(code: string, role: SignalRole, sdp: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url(code, role), { method: 'POST', body: sdp });
  } catch (e) {
    throw new ConnectError('server', `POST ${role} network error: ${String(e)}`);
  }
  if (!res.ok) throw new ConnectError('server', `POST ${role} → HTTP ${res.status}`);
}

/**
 * Poll for the peer's SDP until it appears, the timeout elapses, or aborted.
 * Failures are STAGE-TAGGED: a 404-until-deadline means "expired/not found" when
 * we're the joiner waiting on the host's OFFER (it should already be there), but "no
 * one joined yet" when we're the host waiting on the joiner's ANSWER. A non-404
 * status (or a network error) is a 'server' problem.
 */
export async function pollSDP(
  code: string,
  role: SignalRole,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) throw new ConnectError('aborted');
    let res: Response;
    try {
      res = await fetch(url(code, role));
    } catch (e) {
      throw new ConnectError('server', `GET ${role} network error: ${String(e)}`);
    }
    if (res.ok) return res.text();
    if (res.status !== 404) throw new ConnectError('server', `GET ${role} → HTTP ${res.status}`);
    if (Date.now() > deadline) {
      throw new ConnectError(role === 'offer' ? 'expired' : 'no-join', `${role} poll gave up after ${timeoutMs}ms`);
    }
    await sleep(NET.signalPollMs);
  }
}
