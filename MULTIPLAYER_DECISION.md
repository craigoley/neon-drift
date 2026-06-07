# Real-time 2-player multiplayer — architecture decision doc (MP-1)

**Status:** recon + decision only. No netcode written. This is the project's biggest
architectural decision; map it fully first.

Tags: **[OBS]** = observed in code (file:line). **[INF]** = inferred/researched.

---

## 0. Foundation — confirmed on current main

The GHOST-1 work (#80) is the live-MP prerequisite, and it holds:

- **The step seam:** `update(state: GameState, intent: InputIntent, dt: number)`
  [OBS `src/game/GameState.ts:248`]. A run is advanced purely by feeding it an intent
  each fixed step. **A remote player's car = a second `GameState` advanced with the
  remote player's `InputIntent` through this exact call — no game-logic change.**
- **The replay/MP boundary already exists:** `intentAtFrame` / `createGhostState` /
  `replayToEnd` drive a *second* sim from non-live intents [OBS `src/game/Replay.ts:80,106,117`;
  the step is `update(state, intentAtFrame(...), TIMESTEP)` at `Replay.ts:121`]. Live MP
  swaps "intent from a recording" for "intent from the network" at the same seam.
- **InputIntent is tiny + serializable:** `{ steer:number, deploySlowMo:boolean, restart:boolean }`
  [OBS `src/game/Input.ts`]. Per-frame wire payload is ~a few bytes.
- **Determinism prerequisites:** no module-level mutable state in `src/game/` (every
  `let` is function-local) and no `Math.random`/`Date.now`/`performance` in the sim
  [OBS grep of `src/game/*.ts`]; seeded RNG + fixed timestep `TIMESTEP = 1/60`. Two
  `GameState(seed)` instances run identically — enforced by the #73 determinism
  meta-test. **Both peers `startRun(…, seed, …)` with the SAME seed → identical course.**

⚠️ **The one determinism caveat that matters for lockstep (see §1.4):** the meta-test
proves V8→V8 reproducibility. Lockstep across *different* JS engines (Chrome V8 vs
Safari JSC) is **unverified** — float math can differ in the last ULPs and, in
lockstep, any divergence compounds into desync. This is the top technical risk.

---

## 1. The core netcode model (the central decision)

Two deterministic sims, real-time. Because the sim is deterministic, **we never sync
game state — only inputs.** Both peers run the same sim on the same seed; feed both
the same input stream and they stay identical. The only question is *how inputs are
scheduled* against network latency.

### 1.1 Input-delay lockstep (recommended first)

Each peer sends its per-frame intent. Both peers **delay simulating frame F until they
have BOTH players' input for frame F.** You buffer your own input N frames ahead: at
local frame F you input, but the sim executes that input at frame F+N — giving the
packet N×16.7ms to arrive. Both sides execute identical inputs at identical frames →
identical sim → no state sync, ever.

- **How N works:** N frames of delay = N×16.7ms of head-start for the network. The
  remote input for frame F must arrive before you simulate F. So `N×16.7ms ≥ one-way
  latency`. [INF/RESEARCHED] Typical same-country RTT ~40–80ms (one-way ~20–40ms);
  cross-region ~100–200ms.
- **Starting N:** **N = 4** (~67ms of input delay) covers ~40ms one-way comfortably —
  imperceptible for a friendly race. Make it **adaptive later** (measure RTT during
  the handshake, set `N = ceil(oneWay / 16.7) + 1`, clamp ~2–8).
- **Packet-loss resilience** [RESEARCHED, GGPO-standard]: each packet carries the last
  K inputs (e.g. K=8), not just the newest. A dropped packet self-heals from the next
  one — no retransmit, no added latency. Inputs are tiny, so redundancy is ~free.
- **Cost:** simple, tractable, maps 1:1 onto the existing seam. Tradeoff: a fixed few
  frames of input lag, and **the sim STALLS if an input is missing** (both peers wait)
  — a lag spike freezes both briefly ("waiting for opponent"). Acceptable for casual.

### 1.2 Rollback (later upgrade, if needed)

Simulate forward with a *predicted* remote input (usually "same as last frame");
when the real input arrives and differs, **restore the sim to the last-confirmed
frame and re-simulate** to now with the correct input. Hides latency almost entirely —
far better feel.

- **Why the pure sim makes it POSSIBLE** [INF]: rollback needs cheap save/restore of
  full sim state every frame. `GameState` is plain data with fixed-size pools and no
  external refs — structured-clone/snapshot is feasible (this is exactly why #80
  emphasised "no module state"). The #73 determinism is also a hard requirement.
- **Why it's much harder** [RESEARCHED]: per-frame snapshot + re-sim budget, input
  prediction, visual smoothing of corrections, and *merciless* determinism (any
  divergence is visible as a snap). It's real engineering — weeks, not days.
- **Verdict:** a later upgrade *if* input-delay feel proves insufficient. The seam is
  the same, so it's not throwaway work to start with input-delay.

### 1.3 Recommendation → **input-delay lockstep first**

It's tractable, the sim supports it directly (`update(state, remoteIntent, dt)`), and
a family/casual race tolerates ~67ms of input delay. Rollback is the upgrade path, not
the v1. Building input-delay first is *not* wasted if rollback comes later — both ride
the same deterministic-inputs-over-the-wire foundation.

### 1.4 The determinism risk (must address in netcode v1)

Lockstep is unforgiving: a 1-ULP float difference between peers compounds into a
desync. V8↔V8 is reliable [OBS #73 meta-test]; **V8↔JSC (Chrome↔Safari) is unverified
and a real risk** [INF]. Mitigation for v1 (cheap): **a desync detector** — each peer
hashes a few key state fields (distance, vehicle.lateral, rng.getState(), score) every
~30 frames and sends the checksum; on mismatch, **void the race gracefully** ("desync —
race cancelled") rather than letting two diverging worlds drift. Longer-term options if
cross-engine desync proves common: restrict to same-engine, soft-authoritative
correction, or fixed-point math (expensive rewrite — avoid unless forced). **Validate
cross-engine determinism empirically before relying on it.**

---

## 2. Signaling + transport

### 2.1 Transport → **WebRTC DataChannel** (unreliable, unordered)

[RESEARCHED] For real-time intents, WebRTC `RTCDataChannel` with
`{ ordered: false, maxRetransmits: 0 }` is correct: peer-to-peer (no game data through
a server → lowest latency, no per-game server cost), and unreliable/unordered avoids
head-of-line blocking (a lost packet must NOT delay newer inputs; the K-input
redundancy in §1.1 covers loss). A **WebSocket relay** would be simpler to stand up but
puts a server in the data path (adds latency + bandwidth cost + a scaling liability) —
wrong for twitch intent streaming. Use WebRTC for gameplay.

### 2.2 Signaling — the unavoidable non-static infra

WebRTC needs a tiny rendezvous to exchange SDP offers/answers + ICE candidates. **It
carries NO game data** — it just introduces the two peers, then gets out of the way.
This is what breaks "pure static on Vercel." Options:

| Option | What | Cost | Notes |
|---|---|---|---|
| (a) Vercel serverless + KV | Peer A POSTs offer under match code to Upstash/Vercel KV; B polls, POSTs answer; A polls | **~$0** (Vercel Hobby + Upstash free 10k cmds/day) | Stateless store-and-poll. Fine for match codes. **But can't host matchmaking** (no long-lived process) → throwaway once matchmaking lands. |
| (b) Hosted service (PeerJS cloud / Firebase / Ably) | Third-party brokers the handshake | Free tier → paid at volume | Fastest to wire; adds a third-party dependency + reliability/privacy surface. |
| (c) **Minimal always-on signaling server** | Tiny Node WebSocket server brokers handshakes by match code | **~$5/mo** (Fly.io/Render/Railway small instance; free tiers exist) | Cleanest signaling, and **the SAME process grows into matchmaking** (§3). |

### 2.3 The hidden cost of "P2P is free": STUN + TURN

[RESEARCHED] P2P is not actually free to make *reliable*:
- **STUN** (NAT traversal) is free (Google's public STUN). Covers most connections.
- **TURN** (relay fallback) is needed when both peers are behind symmetric NAT
  (~10–20% of pairs) — without it, those matches simply **fail to connect**. TURN
  relays the data → bandwidth cost: Twilio (pay/GB), Metered.ca (free 50GB/mo),
  Cloudflare TURN (free tier), or self-host `coturn` (~$5/mo VPS). Budget for TURN or
  accept that ~1-in-6 matches won't connect.

### 2.4 Minimum infra to ship match-code 2P, and its cost

**Because matchmaking is in scope (§3), build signaling as option (c) from day one** —
a single tiny always-on Node WS server that does match-code signaling now and
matchmaking later (don't build serverless signaling and throw it away). Plus a TURN
fallback. **Minimum non-static infra: one small always-on server (~$5/mo, or free
tier) + a TURN service (free tier → small bandwidth cost).** Realistic running cost at
low/family volume: **$0–10/mo.**

---

## 3. Matchmaking layer (architect now, build last)

[RESEARCHED] Random matchmaking is a **stateful service**: hold a pool of waiting
players, pair them, handle timeouts / no-match / mid-queue disconnect, then hand the
pair the SAME peer-connection handshake match codes already use. **Match-code and
matchmaking share the identical WebRTC peer connection underneath** — matchmaking just
replaces "type a code" with "server assigns you a partner." So: **netcode first,
matchmaking as a thin layer on top** is the correct order.

- **Hosting reality:** a pool is a long-lived process — *real* hosting, not
  serverless-free. The same always-on server from §2.4 (Fly/Render/Railway, ~$5/mo,
  optional Redis for the queue if you scale past one instance) does it. This is the
  decisive reason to pick signaling option (c) over Vercel serverless.
- **Child-safety flag** (recording both, per the brief): matchmaking pairs strangers.
  Craig's decision is **ungated, no chat** — recorded as the chosen design. **Flagged
  recommendation:** for a game with child players, a **default-OFF "Play strangers"
  toggle** (match-code-only by default; random opt-in) is the lower-risk default — no
  chat already removes the worst vector, and inputs/positions carry no PII, but
  pairing minors with strangers is the residual risk. Both options recorded; Craig's
  call stands.

---

## 4. Disconnect / desync / edge cases (must-handle)

[INF/RESEARCHED] A real-time game must degrade gracefully:

| Case | Detection | Handling |
|---|---|---|
| **Peer drops mid-race** | RTCPeerConnection `disconnected`/`failed`, or input silence > grace | Short reconnect window (~3–5s, ICE restart); if it lapses → **other player wins by forfeit**, race ends cleanly. |
| **Lag spike / input starvation** | Lockstep has no input for the next frame | Stall both with "waiting for opponent…"; resume when inputs arrive; escalate to the drop path after the grace window. |
| **Never connects** (NAT/TURN fail, bad code) | No DataChannel `open` within a timeout | Clear "couldn't connect" + fall back to **solo / race-the-ghost** so the player isn't stuck. |
| **Desync** (cross-engine float drift) | Periodic state-checksum mismatch (§1.4) | **Void the race** gracefully ("connection desynced"); log for telemetry. v1 doesn't attempt resync. |
| **Both crash / one finishes** | Sim phase | See race rules (§5). |
| **Cheating/tampering** | — | P2P lockstep with no authority is trust-based; acceptable for friendly/family. Note for later if competitive. |

---

## 5. Race rules for live 2P (Craig's design call — proposal)

Both cars visible, same seeded course, real-time. Open questions + recommendation:

- **Win condition:** **first-to-distance** (a finish line at a fixed distance D) is the
  clearest live-race read — someone crosses, they win. Alternative: highest score when
  both runs end. Recommend **first-to-distance** for the "we're racing RIGHT NOW" feel;
  score can be a secondary tiebreaker/medal.
- **Crash rule — do NOT use no-death** (it guts the core tension, as established).
  Recommend ONE of:
  1. **Crash ends YOUR run, the race continues** — the other player keeps going; you
     watch/finish as a ghost. Simple, preserves stakes, clear winner.
  2. **Respawn with a time penalty** — crash costs you N seconds (frozen/faded), then
     you rejoin. Keeps both players active; better for lopsided skill (kids vs adults).
  - **Recommendation:** **respawn-with-penalty** for a *family* racer (a young player
    who crashes early still gets to finish alongside) — with crash-ends-run as a
    "ranked"/hardcore variant later.
- **Collision between the two player cars:** **phantom (pass-through)**, like the ghost
  — peer-to-peer collision between two independently-simulated cars is a desync magnet
  and a grief vector. Keep cars non-colliding with each other; they still share the
  course's traffic/gates.

Flagged as **Craig's design call** — this section is a proposal, not a decision.

---

## 6. Recommended PR staging

Each stage shippable + testable on its own:

- **PR1 — Connect + signaling (no gameplay).** The always-on Node WS signaling server
  (option c) + STUN/TURN config; client WebRTC connect by match code; two peers open a
  DataChannel and exchange a heartbeat. Acceptance: two browsers connect via a code and
  see "connected / RTT = Xms". *(Infra PR — introduces the first non-static dependency.)*
- **PR2 — Input-delay lockstep racing.** Both peers `startRun` on a shared seed; stream
  intents; the N-frame input buffer; step the local + remote `GameState` in lockstep;
  render the remote car (reuse the GHOST renderer — it already draws a second car from a
  second state). Acceptance: two cars race live on the same course, staying in sync.
  Add the **checksum desync-detector** here (§1.4) — it's load-bearing.
- **PR3 — Robustness + race rules + UI.** Disconnect/forfeit/reconnect, stall handling,
  connect-fail fallback, desync-void; the chosen race rules (§5); lobby/finish UI.
  Acceptance: pull a cable mid-race → graceful forfeit; finish line declares a winner.
- **PR4 — Matchmaking layer.** Add the stateful pool to the same server; "Find a match"
  replaces the code entry; timeouts/no-match/requeue; the child-safety toggle decision.
  Acceptance: two players with no shared code get paired and race.

Rationale: PR1 de-risks the infra/transport (the part most likely to surprise) before
any game integration; PR2 is the core feature on the proven seam; PR3 makes it
shippable; PR4 layers matchmaking onto the identical peer connection.

---

# DECISIONS A–F

**(A) Netcode model first → INPUT-DELAY LOCKSTEP.** Inputs-only over the wire (sim is
deterministic, no state sync); buffer **N=4 frames** (~67ms, later adaptive from RTT);
K-input redundancy for packet loss. Tractable and maps 1:1 onto `update(state, intent,
dt)` [OBS `GameState.ts:248`]. Rollback is a later upgrade the pure sim *enables*
(cheap snapshot/restore) but is far more work — not v1. **Gating risk:** cross-engine
float determinism is unverified — ship a state-checksum desync detector in PR2.

**(B) Transport + signaling + min infra.** WebRTC **DataChannel** (unordered,
`maxRetransmits:0`) for intents — P2P, lowest latency, no game data on a server. STUN
(free) for traversal + **TURN fallback** (free tier → small bandwidth cost) or ~1-in-6
matches won't connect. Signaling = a **minimal always-on Node WS server** (option c,
~$5/mo / free tier) — NOT Vercel serverless, because matchmaking needs the same
long-lived process. **Minimum non-static infra to ship match-code 2P: one small
always-on server + TURN. Running cost ~$0–10/mo at family volume.**

**(C) Matchmaking = a stateful pool** (waiting-players queue, pairing, timeouts,
disconnect) on the **same always-on server** (optional Redis at scale). It **layers on
top of the identical WebRTC peer connection** match codes use — matchmaking only
replaces "type a code" with "server assigns a partner," so netcode-first is correct.
Cost: the same ~$5/mo process. **Craig's decision: ungated, no chat** — recorded;
**flagged recommendation:** a default-OFF "play strangers" toggle is lower-risk for a
game with children (both recorded, Craig's call stands).

**(D) Disconnect/desync plan.** Reconnect grace (~3–5s, ICE restart) → else
forfeit/win; input starvation → "waiting for opponent" stall then forfeit;
connect-fail → fall back to solo/ghost; desync (periodic checksum mismatch) → void the
race gracefully. P2P is trust-based (fine for friendly/family).

**(E) Race rules (Craig's design call — proposal).** Same-seed course, both cars
visible; **win = first-to-distance**; **crash = respawn-with-time-penalty** (family-
friendly; crash-ends-run as a hardcore variant) — explicitly NOT no-death; the two
player cars are **phantom to each other** (no P2P collision). Proposal, not decided.

**(F) PR staging.** PR1 connect + signaling (heartbeat, no gameplay) → PR2 input-delay
lockstep two-car race on a shared seed + desync detector (reuse the ghost renderer) →
PR3 disconnect/edge handling + race rules/UI → PR4 matchmaking layer on the same
server.

---

*Recon + decision only — no netcode written. The deterministic-sim foundation (#73/#80)
makes input-delay lockstep a direct extension of the existing `update(state, intent,
dt)` seam; the real new surface is INFRA (signaling/TURN/matchmaking server) and the
cross-engine determinism risk — both mapped above.*
