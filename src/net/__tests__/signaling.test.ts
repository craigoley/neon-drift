/**
 * Signaling failures are STAGE-TAGGED (MP-1). The load-bearing case: a joiner polling
 * for a host offer that's gone (expired/never posted) → 'expired' ("code expired"),
 * NOT the host's "no one joined". A non-OK status → 'server'. Mocks fetch so the poll
 * resolves instantly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pollSDP, postSDP } from '../signaling';
import { ConnectError, type ConnectReason } from '../connectionStatus';

/** Stub global fetch with a fixed Response (or a thrown network error). */
function stubFetch(impl: () => Response | Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(impl));
}
const resp = (status: number, body = '') =>
  new Response(body, { status });

async function reasonOf(p: Promise<unknown>): Promise<ConnectReason | 'NO-THROW'> {
  try {
    await p;
    return 'NO-THROW';
  } catch (e) {
    return e instanceof ConnectError ? e.reason : ('NO-THROW' as const);
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('pollSDP — stage-tagged outcomes', () => {
  it('returns the SDP body on 200', async () => {
    stubFetch(() => resp(200, 'SDP-DATA'));
    await expect(pollSDP('UVPBE', 'offer', undefined, 1000)).resolves.toBe('SDP-DATA');
  });

  it('joiner waiting on a GONE offer (404 → deadline) → "expired", not "no-join"', async () => {
    stubFetch(() => resp(404));
    expect(await reasonOf(pollSDP('UVPBE', 'offer', undefined, 0))).toBe('expired');
  });

  it('host waiting on an absent answer (404 → deadline) → "no-join"', async () => {
    stubFetch(() => resp(404));
    expect(await reasonOf(pollSDP('UVPBE', 'answer', undefined, 0))).toBe('no-join');
  });

  it('a non-404 status (e.g. 503 Redis down) → "server"', async () => {
    stubFetch(() => resp(503));
    expect(await reasonOf(pollSDP('UVPBE', 'offer', undefined, 5000))).toBe('server');
  });

  it('a network error → "server"', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await reasonOf(pollSDP('UVPBE', 'answer', undefined, 5000))).toBe('server');
  });

  it('an aborted signal → "aborted"', async () => {
    stubFetch(() => resp(404));
    const ac = new AbortController();
    ac.abort();
    expect(await reasonOf(pollSDP('UVPBE', 'offer', ac.signal, 5000))).toBe('aborted');
  });
});

describe('postSDP — stage-tagged outcomes', () => {
  it('resolves on 200', async () => {
    stubFetch(() => resp(200));
    await expect(postSDP('UVPBE', 'answer', 'SDP')).resolves.toBeUndefined();
  });

  it('a non-OK POST → "server"', async () => {
    stubFetch(() => resp(503));
    expect(await reasonOf(postSDP('UVPBE', 'answer', 'SDP'))).toBe('server');
  });
});
