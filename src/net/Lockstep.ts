/**
 * INPUT-DELAY LOCKSTEP buffer (MP-1 PR2) — PURE, no DOM/WebRTC, fully unit-testable.
 *
 * The model (MULTIPLAYER_DECISION.md §1.1): local input decided now EXECUTES `delay`
 * (N) fixed frames later, giving the packet N×16.7ms to reach the peer. A frame F is
 * simulated only once BOTH players' inputs for F are known — both peers then step
 * identical inputs at identical frames, so the deterministic sims stay in sync with
 * no state transfer (just inputs). The first N frames execute with NEUTRAL input on
 * both sides (a brief rolling start) so there's no input to wait on yet.
 *
 * Packet-loss resilience: each outbound message carries the last K inputs (a window),
 * so a dropped packet self-heals from the next one — no retransmit, no added latency.
 * Intents are tiny.
 *
 * This module owns only the SCHEDULING; the caller owns the two GameStates and steps
 * them with the intents `drain()` hands back. The wire form (NetIntent) drops
 * `restart` (a menu/crash control, always false in-run), like the ghost recording.
 */

import { createIntent, type InputIntent } from '../game/Input';
import { NET } from '../utils/constants';

/** Compact on-the-wire intent (one frame). */
export interface NetIntent {
  steer: number;
  deploy: boolean;
}

/** A frame-tagged intent (sent + buffered). */
export interface FrameInput {
  f: number;
  i: NetIntent;
}

/** A frame ready to simulate: both sides' intents resolved. */
export interface ReadyFrame {
  f: number;
  local: InputIntent;
  remote: InputIntent;
}

const NEUTRAL: NetIntent = { steer: 0, deploy: false };

/** NetIntent → the sim's InputIntent (restart is never networked → false). */
export function toInputIntent(n: NetIntent): InputIntent {
  const i = createIntent();
  i.steer = n.steer;
  i.deploySlowMo = n.deploy;
  return i;
}

/** The sim's InputIntent → the compact wire form. */
export function toNetIntent(i: InputIntent): NetIntent {
  return { steer: i.steer, deploy: i.deploySlowMo };
}

export class Lockstep {
  readonly delay: number;
  readonly redundancy: number;
  /** Next exec-frame to assign local input to (starts at `delay`). */
  private nextLocalFrame: number;
  /** Next frame to simulate. */
  private simFrame = 0;
  private readonly local = new Map<number, NetIntent>();
  private readonly remote = new Map<number, NetIntent>();

  constructor(delay: number = NET.lockstepDelay, redundancy: number = NET.lockstepRedundancy) {
    this.delay = delay;
    this.redundancy = redundancy;
    this.nextLocalFrame = delay; // first real input executes at frame `delay`
  }

  /** Current sim frame (next to execute). */
  get frame(): number {
    return this.simFrame;
  }

  /**
   * Record this tick's local input (executes `delay` frames in the future) and
   * return the last-K window to SEND (redundancy). Call once per render tick.
   */
  produceLocal(intent: NetIntent): FrameInput[] {
    const f = this.nextLocalFrame++;
    this.local.set(f, intent);
    const window: FrameInput[] = [];
    const start = Math.max(this.delay, f - this.redundancy + 1);
    for (let j = start; j <= f; j++) {
      const i = this.local.get(j);
      if (i) window.push({ f: j, i });
    }
    return window;
  }

  /** Ingest a remote input window (idempotent — duplicates from redundancy ignored). */
  receiveRemote(window: FrameInput[]): void {
    for (const { f, i } of window) {
      if (f >= this.delay && !this.remote.has(f)) this.remote.set(f, i);
    }
  }

  /**
   * Advance as far as both sides' inputs allow, returning the frames to simulate
   * (in order). STALLS (returns fewer/none) when the remote input for the next
   * frame hasn't arrived — the caller simply doesn't step those frames yet.
   */
  drain(): ReadyFrame[] {
    const out: ReadyFrame[] = [];
    for (;;) {
      const f = this.simFrame;
      // Can't run past the local input horizon (we only produce one per tick).
      if (f >= this.nextLocalFrame) break;
      // First `delay` frames are a neutral rolling start (no input to wait on).
      const rolling = f < this.delay;
      const ln = rolling ? NEUTRAL : this.local.get(f);
      const rn = rolling ? NEUTRAL : this.remote.get(f);
      if (!ln || !rn) break; // stall — missing an input for this frame
      out.push({ f, local: toInputIntent(ln), remote: toInputIntent(rn) });
      this.local.delete(f);
      this.remote.delete(f);
      this.simFrame++;
    }
    return out;
  }

  /** True when the sim is blocked waiting on a remote input (for the "waiting…" cue).
   *  i.e. local input exists for simFrame but the remote one is missing. */
  get stalled(): boolean {
    const f = this.simFrame;
    if (f >= this.nextLocalFrame || f < this.delay) return false;
    return this.local.has(f) && !this.remote.has(f);
  }
}
