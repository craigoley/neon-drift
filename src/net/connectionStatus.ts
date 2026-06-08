/**
 * STAGE-AWARE connection diagnostics (MP-1). A small state→message mapping (NOT a
 * logging framework) so a failed connect says WHICH stage broke — on-screen in plain
 * language, and in the console with the underlying cause for debugging.
 *
 * Each distinct failure carries a `ConnectReason`; signaling.ts / PeerConnection.ts
 * throw a `ConnectError(reason)` (or report 'no-route' on ICE failure), and the UIs
 * call `reportConnectError` to log the detail + show the human message.
 */

export type ConnectReason =
  | 'server' // signaling POST/GET returned non-OK (503 / Redis not configured / network)
  | 'expired' // joiner: the host's offer is gone — code expired or never existed
  | 'no-join' // host: no answer arrived before the lobby wait elapsed
  | 'bad-sdp' // an offer/answer was found but malformed (setRemoteDescription/parse)
  | 'no-route' // SDP exchanged but ICE/DataChannel never opened (symmetric NAT → TURN)
  | 'aborted'; // the user backed out / closed mid-connect

/** Short, human, on-screen message per failure stage. */
const USER_MESSAGE: Record<ConnectReason, string> = {
  server: 'Multiplayer server unavailable — try again in a moment.',
  expired: 'Code expired or not found — ask the host for a fresh code.',
  'no-join': 'No one joined yet — share the code, or host again for a fresh one.',
  'bad-sdp': 'Connection data was invalid — host a fresh code and try again.',
  'no-route': "Couldn't establish a direct connection — your networks may need a relay (TURN).",
  aborted: 'Connection cancelled.',
};

/** Fuller, developer-facing explanation per stage (for the console). */
const CONSOLE_HINT: Record<ConnectReason, string> = {
  server: 'signaling endpoint returned non-OK (Redis not configured / 503, or a network error)',
  expired: 'no offer stored for this code — TTL-expired or never posted; host again for a fresh code',
  'no-join': 'no answer arrived before the host wait elapsed — the peer never joined',
  'bad-sdp': 'setRemoteDescription / JSON.parse failed on the peer SDP',
  'no-route': 'ICE found no candidate pair (likely symmetric NAT) — set VITE_TURN_* to enable a relay',
  aborted: 'connect aborted (overlay closed / back)',
};

export function userMessage(reason: ConnectReason): string {
  return USER_MESSAGE[reason];
}

export function consoleDetail(reason: ConnectReason, detail?: string): string {
  return `[MP] connect failed @ ${reason}: ${CONSOLE_HINT[reason]}${detail ? ` — ${detail}` : ''}`;
}

/** A connection failure tagged with its stage. `.message` is the human (on-screen)
 *  text; `.detail` is the underlying cause (for the console). */
export class ConnectError extends Error {
  readonly reason: ConnectReason;
  readonly detail?: string;
  constructor(reason: ConnectReason, detail?: string) {
    super(USER_MESSAGE[reason]);
    this.name = 'ConnectError';
    this.reason = reason;
    this.detail = detail;
  }
}

/**
 * Log the developer detail and return the human message to show. The UIs use this in
 * their connect `.catch` so logging + display stay consistent across both the ?mp=1
 * overlay and the in-game race.
 */
export function reportConnectError(err: unknown): string {
  if (err instanceof ConnectError) {
    console.error(consoleDetail(err.reason, err.detail));
    return err.message;
  }
  console.error('[MP] connect failed (unclassified):', err);
  return err instanceof Error ? err.message : String(err);
}
