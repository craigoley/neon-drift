/**
 * LIVE 2-PLAYER RACE orchestration (MP-1 PR2). Wraps a PeerConnection and drives
 * input-delay lockstep: both peers run the SAME seed and simulate BOTH cars (local +
 * remote) from the networked intent streams, so the deterministic sims stay in sync
 * with no state transfer. Reuses the existing seam — the remote car is just a second
 * GameState stepped with `update(state, intent, dt)`, exactly like the ghost (#80)
 * but intents arrive over the wire, not from a recording.
 *
 * SCOPE (PR2): synced live racing + the desync detector. NOT here: finish line,
 * win/lose, disconnect/forfeit, polished UI (PR3). The two cars are PHANTOM to each
 * other (no P2P collision — a desync/grief magnet); they share the course's traffic.
 *
 * Handshake (over the DataChannel, before racing):
 *   host → 'mp-hello' { seed, carId }     (host picks the shared seed)
 *   join → 'mp-ready' { carId }
 *   both → start, then stream 'mp-input' windows + periodic 'mp-sum' checksums.
 */

import { PeerConnection, type ConnState } from './PeerConnection';
import { Lockstep, toNetIntent, type FrameInput } from './Lockstep';
import { compareWorld, worldSum, type WorldSum } from './Desync';
import { createGameState, type GameState, GameMode, startRun, update } from '../game/GameState';
import type { InputIntent } from '../game/Input';
import { handlingFor, NET, scoringFor, slowMoFor, TIMESTEP } from '../utils/constants';

type MpMsg =
  | { t: 'mp-hello'; seed: number; carId: string }
  | { t: 'mp-ready'; carId: string }
  | { t: 'mp-input'; w: FrameInput[] }
  | { t: 'mp-sum'; sum: WorldSum };

export type MpPhase = 'connecting' | 'handshaking' | 'racing' | 'stalled' | 'desynced' | 'failed';

export interface MpRaceEvents {
  onPhase?: (phase: MpPhase, info?: string) => void;
  onCode?: (code: string) => void;
  onRtt?: (ms: number) => void;
  /** The LOCAL car took an MP crash-slowdown this tick — for a crash cue (flash/thump). */
  onLocalCrash?: () => void;
}

export class MpRace {
  readonly peer: PeerConnection;
  private readonly isHost: boolean;
  private readonly localCarId: string;
  private readonly events: MpRaceEvents;
  private readonly ls = new Lockstep();

  /** The two sims. localGame is the app's `game` (assigned at beginRace). */
  private localGame: GameState | null = null;
  remoteGame: GameState | null = null;
  remoteCarId = '';
  private seed = 0;
  private racing = false;
  private desynced = false;
  /** Our own world checksums by frame, awaiting the peer's to compare. */
  private readonly localSums = new Map<number, WorldSum>();

  constructor(isHost: boolean, localCarId: string, events: MpRaceEvents = {}) {
    this.isHost = isHost;
    this.localCarId = localCarId;
    this.events = events;
    this.peer = new PeerConnection({
      onCode: (c) => this.events.onCode?.(c),
      onRtt: (ms) => this.events.onRtt?.(ms),
      onState: (s, info) => this.onConnState(s, info),
      onMessage: (m) => this.onMessage(m as MpMsg),
    });
  }

  /** Host a race (returns once connected; the code is delivered via onCode). */
  host(): Promise<void> {
    this.events.onPhase?.('connecting');
    return this.peer.host();
  }

  /** Join a race by code. */
  join(code: string): Promise<void> {
    this.events.onPhase?.('connecting');
    return this.peer.join(code);
  }

  /** True once both sims are started and racing. */
  get isRacing(): boolean {
    return this.racing;
  }

  /** Bind the app's local GameState. Called by the composition root when the race
   *  is about to begin so MpRace steps the SAME `game` the renderers read. */
  bindLocalGame(game: GameState): void {
    this.localGame = game;
  }

  close(): void {
    this.racing = false;
    this.peer.close();
  }

  // --- handshake ---------------------------------------------------------------

  private onConnState(s: ConnState, info?: string): void {
    if (s === 'connected') {
      this.events.onPhase?.('handshaking');
      if (this.isHost) {
        this.seed = (Math.random() * 0x1_0000_0000) >>> 0; // host picks the shared seed
        this.send({ t: 'mp-hello', seed: this.seed, carId: this.localCarId });
      }
    } else if (s === 'failed') {
      // The ICE/no-route message is already stage-aware (PeerConnection); forward it.
      this.racing = false;
      this.events.onPhase?.('failed', info);
    }
  }

  private onMessage(m: MpMsg): void {
    switch (m.t) {
      case 'mp-hello': // joiner receives the shared seed + host's car
        this.seed = m.seed;
        this.remoteCarId = m.carId;
        this.send({ t: 'mp-ready', carId: this.localCarId });
        this.begin();
        break;
      case 'mp-ready': // host receives joiner's car
        this.remoteCarId = m.carId;
        this.begin();
        break;
      case 'mp-input':
        this.ls.receiveRemote(m.w);
        break;
      case 'mp-sum':
        this.checkDesync(m.sum);
        break;
    }
  }

  /** Start both sims on the shared seed once the handshake completes. */
  private begin(): void {
    if (this.racing || !this.localGame || !this.remoteCarId) return;
    // mpRace=true (the 8th arg) on BOTH sims → a crash slows the car instead of ending
    // the run, so neither stops producing intents (the lockstep never starves). Both
    // peers simulate both cars with mpRace=true, so the slowdown is identical.
    startRun(this.localGame, handlingFor(this.localCarId), 0, this.seed, scoringFor(this.localCarId), GameMode.Classic, slowMoFor(this.localCarId), true);
    this.remoteGame = startRun(createGameState(this.seed), handlingFor(this.remoteCarId), 0, this.seed, scoringFor(this.remoteCarId), GameMode.Classic, slowMoFor(this.remoteCarId), true);
    this.racing = true;
    this.events.onPhase?.('racing');
  }

  // --- per-frame step (called by the render loop) ------------------------------

  /**
   * Advance the race by one render tick: schedule + send the local input, then step
   * BOTH sims for every frame whose inputs are now known. Stalls cleanly when the
   * remote input hasn't arrived. Returns false when not racing (caller runs SP).
   */
  tick(localIntent: InputIntent): boolean {
    if (!this.racing || !this.localGame || !this.remoteGame) return false;
    // Schedule local input N frames ahead + broadcast the redundant window.
    const window = this.ls.produceLocal(toNetIntent(localIntent));
    this.send({ t: 'mp-input', w: window });

    for (const step of this.ls.drain()) {
      update(this.localGame, step.local, TIMESTEP);
      update(this.remoteGame, step.remote, TIMESTEP);
      if (this.localGame.lastEvents.mpCrashed) this.events.onLocalCrash?.(); // crash-slowdown cue
      if (step.f % NET.desyncCheckFrames === 0) this.emitChecksum(step.f);
    }

    this.events.onPhase?.(this.desynced ? 'desynced' : this.ls.stalled ? 'stalled' : 'racing');
    return true;
  }

  // --- desync detector ---------------------------------------------------------

  /** Compute + send our world checksum for frame f (and stash it to compare). */
  private emitChecksum(f: number): void {
    if (!this.localGame || !this.remoteGame) return;
    const hostGame = this.isHost ? this.localGame : this.remoteGame;
    const joinGame = this.isHost ? this.remoteGame : this.localGame;
    const sum = worldSum(f, hostGame, joinGame);
    this.localSums.set(f, sum);
    this.send({ t: 'mp-sum', sum });
  }

  private checkDesync(remoteSum: WorldSum): void {
    const local = this.localSums.get(remoteSum.f);
    if (!local) return; // our checksum for that frame not computed yet — ignore
    this.localSums.delete(remoteSum.f);
    const v = compareWorld(local, remoteSum);
    if (!v.ok && !this.desynced) {
      this.desynced = true;
      console.error(`[MP] DESYNC at frame ${remoteSum.f}: ${v.detail}`); // PR3: graceful void
      this.events.onPhase?.('desynced', v.detail);
    }
  }

  private send(m: MpMsg): void {
    this.peer.send(m);
  }
}
