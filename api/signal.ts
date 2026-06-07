/**
 * WebRTC SIGNALING — Vercel serverless function (MP-1 PR1). Store-and-poll handshake
 * brokering ONLY: it stashes a peer's SDP under a short-lived MATCH CODE and lets the
 * other peer poll for it. NO game data EVER passes through here — once the two peers
 * have swapped SDP, the WebRTC DataChannel is peer-to-peer and this server is out of
 * the loop. Stateless + match-code-only by design (random matchmaking is a later PR
 * on an always-on host — see MULTIPLAYER_DECISION.md §3).
 *
 * Storage: Upstash Redis via the Vercel Marketplace integration (Vercel KV is
 * retired — docs/redis). Keys auto-expire (TTL) so stale codes self-clean; the free
 * tier (500K cmds/mo) dwarfs match-code signaling volume (a handshake is a few SET/
 * GETs). Env vars are injected by the integration; we accept either the KV_* names
 * (Vercel's compat) or the UPSTASH_* names.
 *
 * Web-API handler signature (export GET/POST) — no @vercel/node dependency. Same
 * origin as the game, so no CORS. Not type-checked by the app build (tsconfig =
 * src only); Vercel builds api/ separately.
 */

import { Redis } from '@upstash/redis';

const TTL_SECONDS = 600; // 10 min — a code is for an immediate connect, then dead
type Role = 'offer' | 'answer';

function redis(): Redis | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // not configured → the function reports 503 (see below)
  return new Redis({ url, token });
}

const key = (code: string, role: Role) => `signal:${code}:${role}`;

function parse(url: string): { code: string | null; role: Role | null } {
  const p = new URL(url).searchParams;
  const code = p.get('code');
  const roleRaw = p.get('role');
  const role = roleRaw === 'offer' || roleRaw === 'answer' ? roleRaw : null;
  // Codes are short uppercase alnum; reject anything else (also bounds key space).
  const ok = code && /^[A-Z0-9]{4,8}$/.test(code) ? code : null;
  return { code: ok, role };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** POST ?code=XXXX&role=offer|answer  body = SDP JSON → store it under the code. */
export async function POST(request: Request): Promise<Response> {
  const db = redis();
  if (!db) return json({ error: 'signaling not configured (no Redis env)' }, 503);
  const { code, role } = parse(request.url);
  if (!code || !role) return json({ error: 'bad code/role' }, 400);
  const sdp = await request.text();
  if (!sdp || sdp.length > 100_000) return json({ error: 'bad sdp' }, 400); // bound payload
  await db.set(key(code, role), sdp, { ex: TTL_SECONDS });
  return json({ ok: true });
}

/** GET ?code=XXXX&role=offer|answer → the stored SDP, or 404 while the peer hasn't
 *  posted it yet (the client polls until it appears). */
export async function GET(request: Request): Promise<Response> {
  const db = redis();
  if (!db) return json({ error: 'signaling not configured (no Redis env)' }, 503);
  const { code, role } = parse(request.url);
  if (!code || !role) return json({ error: 'bad code/role' }, 400);
  const sdp = await db.get<string>(key(code, role));
  if (sdp == null) return json({ error: 'not ready' }, 404);
  return new Response(typeof sdp === 'string' ? sdp : JSON.stringify(sdp), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
