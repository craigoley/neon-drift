/**
 * Input-delay lockstep buffer (MP-1 PR2) — the PURE core of live racing. Tests the
 * scheduling contract: input decided now executes N frames later; a frame runs only
 * when BOTH sides' inputs are present; the K-input window self-heals a dropped
 * packet; a missing remote input stalls (doesn't crash/skip). The actual two-device
 * sync is canvas-walled (Craig's playtest); this locks the model.
 */
import { describe, expect, it } from 'vitest';
import { Lockstep, type FrameInput, type NetIntent } from '../Lockstep';

const I = (steer: number, deploy = false): NetIntent => ({ steer, deploy });

describe('Lockstep — input delay (frame F input executes at F+N rolling start)', () => {
  it('the first N frames run with neutral input, then real input executes', () => {
    const ls = new Lockstep(4, 8);
    // Produce local input each tick; mirror it as the remote so frames are ready.
    const sent: FrameInput[][] = [];
    for (let tick = 0; tick < 6; tick++) {
      const w = ls.produceLocal(I(tick + 1)); // distinct steer per tick
      sent.push(w);
      ls.receiveRemote(w); // simulate a perfectly-mirrored peer
    }
    const ready = ls.drain();
    // 6 produced inputs → exec frames 4..9; plus the neutral rolling start 0..3.
    expect(ready.map((r) => r.f)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (let f = 0; f < 4; f++) expect(ready[f].local.steer).toBe(0); // neutral
    expect(ready[4].local.steer).toBe(1); // first produced input executes at frame 4 (= delay)
    expect(ready[5].local.steer).toBe(2);
  });

  it('produceLocal assigns increasing exec-frames starting at the delay', () => {
    const ls = new Lockstep(4, 8);
    const a = ls.produceLocal(I(0.1));
    const b = ls.produceLocal(I(0.2));
    expect(a[a.length - 1].f).toBe(4);
    expect(b[b.length - 1].f).toBe(5);
  });
});

describe('Lockstep — readiness + stall', () => {
  it('does NOT run a frame until the remote input for it arrives', () => {
    const ls = new Lockstep(2, 8);
    // Produce 4 local inputs (exec frames 2,3,4,5) — frames 0,1 are neutral.
    for (let t = 0; t < 4; t++) ls.produceLocal(I(t));
    // No remote yet → only the neutral rolling-start frames (0,1) can run.
    expect(ls.drain().map((r) => r.f)).toEqual([0, 1]);
    expect(ls.stalled).toBe(true); // waiting on remote frame 2
    // Remote sends frames 2,3 → those run; still stalled on 4.
    ls.receiveRemote([{ f: 2, i: I(9) }, { f: 3, i: I(9) }]);
    expect(ls.drain().map((r) => r.f)).toEqual([2, 3]);
    expect(ls.stalled).toBe(true);
  });

  it('resumes exactly where it stalled once the missing input arrives', () => {
    const ls = new Lockstep(0, 8); // no rolling start — pure dependency on inputs
    for (let t = 0; t < 5; t++) ls.produceLocal(I(t));
    ls.receiveRemote([{ f: 0, i: I(0) }, { f: 1, i: I(0) }]); // skip frame 2
    expect(ls.drain().map((r) => r.f)).toEqual([0, 1]); // stalls at 2
    ls.receiveRemote([{ f: 3, i: I(0) }]); // 3 arrives but 2 still missing → still stalled
    expect(ls.drain().map((r) => r.f)).toEqual([]);
    ls.receiveRemote([{ f: 2, i: I(0) }]); // the gap fills → 2 AND the buffered 3 run
    expect(ls.drain().map((r) => r.f)).toEqual([2, 3]);
  });
});

describe('Lockstep — K-input redundancy self-heals a dropped packet', () => {
  it('a dropped message is recovered from the next one (which re-sends the last K)', () => {
    const localTx: FrameInput[][] = [];
    const tx = new Lockstep(0, 8);
    for (let t = 0; t < 5; t++) localTx.push(tx.produceLocal(I(t)));

    const rx = new Lockstep(0, 8);
    for (let t = 0; t < 5; t++) rx.produceLocal(I(0)); // rx's own local stream
    // DROP message #2 (frame 2's packet); deliver the rest. The window in messages
    // #3/#4 still CONTAINS frame 2, so it self-heals.
    rx.receiveRemote(localTx[0]);
    rx.receiveRemote(localTx[1]);
    // (localTx[2] dropped)
    rx.receiveRemote(localTx[3]); // window includes frames ...,2,3
    rx.receiveRemote(localTx[4]);
    expect(rx.drain().map((r) => r.f)).toEqual([0, 1, 2, 3, 4]); // no gap despite the drop
  });

  it('the sent window never exceeds K and is contiguous to the newest frame', () => {
    const ls = new Lockstep(0, 3); // K=3
    let w: FrameInput[] = [];
    for (let t = 0; t < 6; t++) w = ls.produceLocal(I(t));
    expect(w.length).toBe(3);
    expect(w.map((x) => x.f)).toEqual([3, 4, 5]); // last 3
  });
});
