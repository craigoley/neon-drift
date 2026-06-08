/**
 * Stage-aware connection diagnostics (MP-1). Locks the state→message mapping: every
 * failure reason has a distinct human + console string, ConnectError carries its
 * stage, and reportConnectError returns the human message (and logs the detail). This
 * is what makes a failed connect a 5-second diagnosis instead of "connecting failed".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectError, consoleDetail, reportConnectError, userMessage, type ConnectReason } from '../connectionStatus';

const ALL: ConnectReason[] = ['server', 'expired', 'no-join', 'bad-sdp', 'no-route', 'aborted'];

describe('connectionStatus — the stage→message mapping', () => {
  it('every reason has a distinct, non-empty on-screen + console message', () => {
    const users = new Set<string>();
    const cons = new Set<string>();
    for (const r of ALL) {
      expect(userMessage(r).length, r).toBeGreaterThan(0);
      expect(consoleDetail(r).startsWith(`[MP] connect failed @ ${r}`), r).toBe(true);
      users.add(userMessage(r));
      cons.add(consoleDetail(r));
    }
    expect(users.size, 'on-screen messages are distinct').toBe(ALL.length);
    expect(cons.size, 'console messages are distinct').toBe(ALL.length);
  });

  it('the expiry message names the fix (fresh code), and no-route names TURN', () => {
    expect(userMessage('expired').toLowerCase()).toContain('expired');
    expect(userMessage('expired').toLowerCase()).toContain('fresh code');
    expect(userMessage('no-route').toLowerCase()).toContain('turn');
    expect(consoleDetail('no-route')).toContain('VITE_TURN_'); // the dev hint to fix symmetric NAT
  });

  it('ConnectError carries its stage and uses the human message as .message', () => {
    const e = new ConnectError('expired', 'offer 404 after 20000ms');
    expect(e).toBeInstanceOf(Error);
    expect(e.reason).toBe('expired');
    expect(e.message).toBe(userMessage('expired'));
    expect(e.detail).toContain('20000ms');
  });
});

describe('connectionStatus — reportConnectError', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs the developer detail and returns the human message for a ConnectError', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const shown = reportConnectError(new ConnectError('server', 'POST → HTTP 503'));
    expect(shown).toBe(userMessage('server'));
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0][0])).toContain('HTTP 503');
  });

  it('falls back gracefully for a non-ConnectError', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(reportConnectError(new Error('boom'))).toBe('boom');
    expect(reportConnectError('weird')).toBe('weird');
  });
});
