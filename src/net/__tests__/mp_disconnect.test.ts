/**
 * MP disconnect handling (MP-1 PR3-pt2, Part C). A mid-race DataChannel drop must end
 * the race — the survivor wins by default — and must NOT leave them hanging on
 * lockstep inputs that will never come (the freeze-class bug). WebRTC isn't available
 * in the test env, so we stub RTCPeerConnection and drive the real onConnState path,
 * then assert the survivor's tick reports a finished/disconnected race (no stall).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MpRace, type MpRaceView } from '../MpRace';
import { createGameState, GameMode, startRun } from '../../game/GameState';
import { createIntent } from '../../game/Input';
import { handlingFor, scoringFor, slowMoFor } from '../../utils/constants';

/** Minimal RTCPeerConnection stub: enough to construct PeerConnection + fire a drop. */
class FakePC {
  connectionState = 'new';
  iceGatheringState = 'complete';
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: unknown = null;
  localDescription = { type: 'offer', sdp: 'x' };
  createDataChannel() {
    return { readyState: 'open', send() {}, close() {}, onopen: null, onclose: null, onmessage: null };
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.connectionState = 'closed';
    this.onconnectionstatechange?.();
  }
}

const startCar = (seed: number, carId: string) =>
  startRun(createGameState(seed), handlingFor(carId), 0, seed, scoringFor(carId), GameMode.Classic, slowMoFor(carId), true);

afterEach(() => vi.unstubAllGlobals());

describe('MP disconnect — survivor wins, race ends, no hang', () => {
  it('a mid-race connection drop finishes the race for the survivor', () => {
    vi.stubGlobal('RTCPeerConnection', FakePC);
    const views: MpRaceView[] = [];
    const onDisconnect = vi.fn();
    const race = new MpRace(true, 'pulse', { onDisconnect, onRaceState: (v) => views.push(v) });

    // Force the racing state (bypass the WebRTC handshake, which needs the network).
    const r = race as unknown as { racing: boolean; everRaced: boolean; localGame: unknown; remoteGame: unknown };
    race.bindLocalGame(startCar(123, 'pulse'));
    r.remoteGame = startCar(123, 'nova');
    r.racing = true;
    r.everRaced = true;

    // The opponent drops: fire the peer connection's 'failed' transition.
    const pc = (race.peer as unknown as { pc: FakePC }).pc;
    pc.connectionState = 'failed';
    pc.onconnectionstatechange?.();

    expect(onDisconnect, 'disconnect was surfaced').toHaveBeenCalledOnce();

    // The survivor's tick must report a finished/disconnected race (a WIN) and NOT
    // stall waiting on the gone peer.
    const ticked = race.tick(createIntent());
    expect(ticked).toBe(true);
    const last = views.at(-1)!;
    expect(last.finished, 'race ended').toBe(true);
    expect(last.disconnected, 'flagged as a disconnect').toBe(true);
    expect(last.result, 'survivor wins by default').toBe('win');
  });

  it('the joiner is the survivor if it is the one left (perspective is correct)', () => {
    vi.stubGlobal('RTCPeerConnection', FakePC);
    const views: MpRaceView[] = [];
    const race = new MpRace(false, 'nova', { onRaceState: (v) => views.push(v) }); // isHost=false
    const r = race as unknown as { racing: boolean; everRaced: boolean; remoteGame: unknown };
    race.bindLocalGame(startCar(7, 'nova'));
    r.remoteGame = startCar(7, 'pulse');
    r.racing = true;
    r.everRaced = true;

    const pc = (race.peer as unknown as { pc: FakePC }).pc;
    pc.connectionState = 'failed';
    pc.onconnectionstatechange?.(); // the opponent drops

    race.tick(createIntent());
    expect(views.at(-1)!.result).toBe('win'); // the joiner-survivor wins
  });
});

describe('MP race HUD state — position, gap, and the overtake alert', () => {
  it('computes the gap + leader and fires the overtake alert on a lead flip', () => {
    vi.stubGlobal('RTCPeerConnection', FakePC);
    const views: MpRaceView[] = [];
    const onLeadChange = vi.fn();
    const race = new MpRace(true, 'pulse', { onRaceState: (v) => views.push(v), onLeadChange });
    const r = race as unknown as {
      localGame: { distance: number };
      remoteGame: { distance: number };
      localLeads: boolean;
      emitRaceState: () => void;
    };
    race.bindLocalGame(startCar(1, 'pulse'));
    r.remoteGame = startCar(1, 'pulse');
    r.localLeads = true;

    // Local ahead by 50 → still leading, gap +50, no alert.
    r.localGame.distance = 200;
    r.remoteGame.distance = 150;
    r.emitRaceState();
    expect(views.at(-1)!.gap).toBe(50);
    expect(views.at(-1)!.localLeads).toBe(true);
    expect(onLeadChange).not.toHaveBeenCalled();

    // Rival passes (local now behind by more than the deadband) → leader flips → alert.
    r.localGame.distance = 150;
    r.remoteGame.distance = 250;
    r.emitRaceState();
    expect(views.at(-1)!.gap).toBe(-100);
    expect(views.at(-1)!.localLeads).toBe(false);
    expect(onLeadChange).toHaveBeenCalledWith(false); // "PASSED"
    expect(onLeadChange).toHaveBeenCalledTimes(1);
  });
});
