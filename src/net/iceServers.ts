/**
 * ICE server config for WebRTC (MP-1 PR1). Free public STUN handles NAT traversal
 * for MOST peers; a TURN relay is needed for the ~1-in-6 symmetric-NAT pairs that
 * can't connect P2P (MULTIPLAYER_DECISION.md §2.3) — without TURN those matches
 * simply fail. TURN is OPTIONAL + configurable via build-time env so we ship STUN-
 * only now and add a TURN provider (e.g. Metered Open Relay — 20GB/mo free — or
 * Cloudflare Realtime TURN) without code changes:
 *
 *   VITE_TURN_URL=turn:relay.example:443?transport=tcp
 *   VITE_TURN_USERNAME=...
 *   VITE_TURN_CREDENTIAL=...
 */

import { NET } from '../utils/constants';

export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: [...NET.stunUrls] }];
  const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: import.meta.env.VITE_TURN_USERNAME as string | undefined,
      credential: import.meta.env.VITE_TURN_CREDENTIAL as string | undefined,
    });
  }
  return servers;
}

/** Whether a TURN relay is configured (for the UI to warn when STUN-only). */
export function hasTurn(): boolean {
  return Boolean(import.meta.env.VITE_TURN_URL);
}
