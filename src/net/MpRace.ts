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
import { decideWinner, leadWithDeadband, resultFor, type RaceResult, type RaceWinner } from './raceLogic';
import { createGameState, type GameState, GameMode, startRun, update } from '../game/GameState';
import type { InputIntent } from '../game/Input';
import { handlingFor, MP_RACE, NET, scoringFor, slowMoFor, TIMESTEP } from '../utils/constants';

type MpMsg =
  | { t: 'mp-hello'; seed: number; carId: string }
  | { t: 'mp-ready'; carId: string }
  | { t: 'mp-input'; w: FrameInput[] }
  | { t: 'mp-sum'; sum: WorldSum };

export type MpPhase = 'connecting' | 'handshaking' | 'racing' | 'stalled' | 'desynced' | 'failed';

/** Per-tick race state the HUD renders from (position / gap / finish / result). */
export interface MpRaceView {
  /** This peer's car distance. */
  localDistance: number;
  /** The rival car distance. */
  rivalDistance: number;
  /** Finish line distance. */
  finishDistance: number;
  /** localDistance − rivalDistance (positive = local ahead). */
  gap: number;
  /** True if the local car currently leads (with deadband). */
  localLeads: boolean;
  /** Race over (a car finished, or a disconnect). */
  finished: boolean;
  /** This peer's result once finished, else null. */
  result: RaceResult | null;
  /** True if the race ended because the opponent disconnected. */
  disconnected: boolean;
}

export interface MpRaceEvents {
  onPhase?: (phase: MpPhase, info?: string) => void;
  onCode?: (code: string) => void;
  onRtt?: (ms: number) => void;
  /** The LOCAL car took an MP crash-slowdown this tick — for a crash cue (flash/thump). */
  onLocalCrash?: () => void;
  /** Per-tick race state for the HUD (position / gap / finish). */
  onRaceState?: (view: MpRaceView) => void;
  /** The lead changed — `localLeads` is the NEW state (for the overtake/passed alert). */
  onLeadChange?: (localLeads: boolean) => void;
  /** The opponent disconnected mid-race (the survivor wins by default). */
  onDisconnect?: () => void;
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
  /** Short, persistent desync readout (frame + earliest field + magnitude) for the UI. */
  private desyncSummary = '';
  /** Our own world checksums by frame, awaiting the peer's to compare. */
  private readonly localSums = new Map<number, WorldSum>();

  // --- race completion (deterministic; computed identically on both peers) ---------
  /** Lowest sim frame at which each car reached the finish (-1 = not yet). */
  private hostFinishFrame = -1;
  private joinFinishFrame = -1;
  private finished = false;
  private winner: RaceWinner | null = null;
  private disconnected = false;
  /** True once the race has begun (to tell a pre-race connect failure from a drop). */
  private everRaced = false;
  /** Tracks the leader (local perspective) for overtake-alert edge detection. */
  private localLeads = true;

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
    } else if (s === 'failed' || s === 'closed') {
      if (this.racing && !this.finished) {
        // Mid-race DISCONNECT (distinct from a normal lockstep stall, which is
        // transient): the opponent's inputs will never arrive, so end the race rather
        // than hang the survivor waiting. The survivor (this peer) wins by default.
        this.disconnected = true;
        this.finished = true;
        this.winner = this.isHost ? 'host' : 'join';
        this.events.onDisconnect?.();
        this.emitRaceState();
      } else if (!this.everRaced) {
        // Pre-race connection failure — already stage-aware (PeerConnection).
        this.events.onPhase?.('failed', info);
      }
      // else: an intentional close after the race ended → nothing to surface.
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
    this.everRaced = true;
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
    // ALWAYS schedule + broadcast local input (even after finishing) so the peer's
    // lockstep never starves while it catches up to the finish frame.
    const window = this.ls.produceLocal(toNetIntent(localIntent));
    this.send({ t: 'mp-input', w: window });

    // Step both sims only while the race is live. Stop the instant the FIRST car
    // crosses the finish (in shared sim time) — both peers hit the identical frame.
    if (!this.finished) {
      for (const step of this.ls.drain()) {
        update(this.localGame, step.local, TIMESTEP);
        update(this.remoteGame, step.remote, TIMESTEP);
        if (this.localGame.lastEvents.mpCrashed) this.events.onLocalCrash?.(); // crash-slowdown cue
        if (step.f % NET.desyncCheckFrames === 0) this.emitChecksum(step.f);
        if (this.detectFinish(step.f)) break; // race over this frame
      }
    }

    this.emitRaceState();
    // Once desynced, keep surfacing the (persistent) summary so it's readable
    // mid-race without catching the console live.
    if (this.desynced) this.events.onPhase?.('desynced', this.desyncSummary);
    else if (!this.finished) this.events.onPhase?.(this.ls.stalled ? 'stalled' : 'racing');
    return true;
  }

  /** Record finish frames + finalize the winner the first frame any car crosses.
   *  Pure-deterministic: both peers run this over the identical sim → identical result. */
  private detectFinish(frame: number): boolean {
    if (!this.localGame || !this.remoteGame) return false;
    const hostG = this.isHost ? this.localGame : this.remoteGame;
    const joinG = this.isHost ? this.remoteGame : this.localGame;
    const fin = MP_RACE.finishDistance;
    if (this.hostFinishFrame < 0 && hostG.distance >= fin) this.hostFinishFrame = frame;
    if (this.joinFinishFrame < 0 && joinG.distance >= fin) this.joinFinishFrame = frame;
    if (this.hostFinishFrame < 0 && this.joinFinishFrame < 0) return false;
    // A car has crossed this frame → finalize (the FIRST crosser wins; dead-heat
    // tiebreak is deterministic — see decideWinner).
    this.finished = true;
    this.winner = decideWinner(this.hostFinishFrame, this.joinFinishFrame, hostG.distance, joinG.distance);
    return true;
  }

  /** Build + push the per-tick HUD view, and fire the overtake alert on a lead flip. */
  private emitRaceState(): void {
    if (!this.localGame || !this.remoteGame) return;
    const localDistance = this.localGame.distance;
    const rivalDistance = this.remoteGame.distance;
    const gap = localDistance - rivalDistance;
    const leads = leadWithDeadband(this.localLeads, gap, MP_RACE.leadChangeDeadband);
    if (leads !== this.localLeads) {
      this.localLeads = leads;
      if (!this.finished) this.events.onLeadChange?.(leads); // overtake / passed
    }
    this.events.onRaceState?.({
      localDistance,
      rivalDistance,
      finishDistance: MP_RACE.finishDistance,
      gap,
      localLeads: this.localLeads,
      finished: this.finished,
      result: this.finished && this.winner ? resultFor(this.winner, this.isHost) : null,
      disconnected: this.disconnected,
    });
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
      this.desyncSummary = v.summary;
      // Full per-field breakdown (root→downstream, with magnitudes) for diagnosis,
      // plus the earliest diverging field called out explicitly.
      console.error(`[MP] DESYNC ${v.detail}`); // PR3: graceful void
      if (v.first) {
        console.error(`[MP] DESYNC earliest field: ${v.first.role}.${v.first.field} (${v.first.exact ? 'exact offset' : 'float Δ'}) — ${v.summary}`);
      }
      this.events.onPhase?.('desynced', v.summary);
    }
  }

  private send(m: MpMsg): void {
    this.peer.send(m);
  }
}
