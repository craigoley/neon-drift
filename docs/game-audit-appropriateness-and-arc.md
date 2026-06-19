# Neon Drift — Recon audit (READ-ONLY): Appropriateness/Familiarity + Gameplay-Arc

Two independent read-only audits of the whole game (racing + Zen). Findings only — **no code was changed**.
Each finding is tagged **VERIFIED** (read in code, quoted) or **INFERRED** (reasoned). Fix *directions*, not fixes.
Code-verifiable items are distinguished from FEEL items (phone-playtest only). Done at commit `main` (post #173).

---

# AUDIT 1 — Appropriateness + Familiarity (generic US players, incl. kids / ESRB lens)

## Headline
**The game is clean and kid-safe.** No profanity, no mature/violent framing, no data exfiltration, no
ads/IAP, no chat, no name entry, no third-party IP. The only real call-outs are a **familiarity** choice
(metric units) and one **minor privacy nuance** inherent to peer-to-peer multiplayer (IP exposure to a
peer you deliberately share a code with). Details below.

## A. Content (ESRB content-descriptor lens) — CLEAN ✅
- **No profanity in any user-facing string.** VERIFIED across `src/ui/`, `src/net/`, `src/rendering/HUD.ts`,
  `src/main.ts`, `src/utils/constants.ts`. A wordlist grep (damn/hell/ass/shit/etc.) returned **only code
  comments** using technical terms: `constants.ts:33` "spiral of death" (loop-bug term), `GameState.ts:101`
  "single-collision death", `Vehicle.ts:83` "Kill velocity into the wall". None surface to a player.
- **Crash / competition framing is clean + sporting.** VERIFIED: the crash screen is **"WIPEOUT"**
  (`Shell.ts:3`), race results are **"YOU WIN" / "YOU LOSE" / "DRAW"** (`RaceHud.ts:171–185`). No
  "death/destroyed/wasted/blood/gore" language anywhere user-facing. Obstacles are colour-coded by intent,
  not gore.
- **Console/debug strings are professional.** VERIFIED: the only `console.*` calls are MP diagnostics —
  `MpRace.ts:297` `` `[MP] DESYNC ${...}` ``, `connectionStatus.ts:70` `'[MP] connect failed…'`. Technical,
  not edgy, and console-only (never on-screen). No unprofessional/edgy line ships to a player.
- INFERRED: tone overall is calm-synthwave (e.g. the Zen mode, "a steady, fair opponent"). Nothing off-tone.

## B. Familiarity / US culturalization
- **UNITS are metric — the one familiarity flag.** VERIFIED: speed renders `` `${Math.round(speed)} km/s` ``
  (`HUD.ts:171`); distance/gaps render in metres — `RaceHud.ts:38` `` `${Math.round(d)}m` ``, milestones
  "1000m — +1000!" (`constants.ts:2393+`). A generic US player expects **mph + miles/feet**. Also note
  **"km/s" is physically nonsensical** as a ground-vehicle speed (km/*second* = orbital velocity) — it reads
  as a stylized "big number" unit, but a US kid/parent may find it odd. *Fix direction (a choice, not a bug):*
  either switch the readout to mph (display-only; the sim is unitless), or keep it stylized but consider a
  saner label. Flag for Craig's call — **don't change without a decision.**
- **Spelling is US-safe in the UI.** VERIFIED: British spellings (`colour`, `centre`, `honour`) appear **only
  in code comments + internal identifiers** (`Shell.ts:49` "CSS colour", `main.ts:168` "honour persisted…",
  `Shell.ts:804` `carPlaystyleEl`, many `constants.ts` comments). **No user-facing copy uses British spelling**
  — the visible strings ("NEON DRIFT", "WIPEOUT", "NEW BEST!", "VS COMPUTER", "Slow-Mo", "Score x2") are
  US-neutral. Nothing to change for players (the comments are internal).
- **No non-US idioms/slang/references, no date/number-format issues** surfaced. Numbers use plain `1000m` /
  `10,000m` (`constants.ts:2399`) — US-readable.

## C. ESRB "Interactive Elements" + privacy (COPPA lens) — LOW RISK ✅ (one nuance)
- **No analytics / tracking / telemetry-exfil.** VERIFIED: no `gtag`/`sentry`/`posthog`/`mixpanel`/`amplitude`/
  `beacon` anywhere. `utils/Telemetry.ts:2` is **local FPS measurement** — "PURE — no DOM, no three" (a frame-time
  ring buffer), it transmits nothing.
- **No user data leaves the device except WebRTC multiplayer.** VERIFIED:
  - **localStorage is local-only** — keys `neon-drift.best/leaderboard/daily/settings/ghost/progress/missions`
    (`constants.ts:2465–3490`). Stored on-device, never uploaded. The "ghost" is an **input replay**, not PII.
  - **Multiplayer is private code-based P2P** (`MpRaceUI.ts:53` "Race a friend live… Host and share the code,
    or join with theirs"; an 8-char `CODE` input, `:56–57`). **No random matchmaking with strangers.**
  - **Signaling carries no game/personal data** — `signaling.ts:3–4` "Carries NO game data — only the one-time
    WebRTC handshake"; it POSTs/polls SDP under the match code to `/api/signal`.
  - **The P2P wire protocol carries no PII or free text** — VERIFIED the entire message set: `mp-hello{seed,carId}`
    (`MpRace.ts:147`), `mp-ready{carId}` (`:172`), `mp-input{window}` (`:213`), `mp-sum{checksum}` (`:284`).
    Only the shared seed, which **cosmetic car**, lockstep inputs, and a desync checksum.
- **No user-to-user chat / free text / names.** VERIFIED: there is **no name/nickname entry anywhere** (the only
  "username" hit is `iceServers.ts:22` `VITE_TURN_USERNAME` — a TURN-server credential, not a player name). No
  chat surface. No unmoderated UGC a child could see.
- **No in-game purchases, no ads.** VERIFIED: the STORE spends **earned in-game credits** shown as ★ (`Shell.ts:158–159`
  `credits`, `:919` `` `${c.price} ★` ``). No `$`/USD/real-money path, no ad SDK.
- **No external links / unrestricted internet.** VERIFIED: the only outbound network is the MP signaling fetch +
  WebRTC. The Share button posts the game's **own** URL (`Shell.ts:1196` `share({title:'Neon Drift', url: shareUrl})`)
  via the native share sheet/clipboard — no third-party link a kid could wander to.
- **NUANCE (INFERRED, minor):** WebRTC P2P (`PeerConnection.ts:53` `new RTCPeerConnection({iceServers})`) inherently
  reveals each peer's **IP address** to the other during ICE. This is standard for P2P games and only happens with
  someone you *deliberately shared a code with* (not strangers), but in a strict COPPA framing it's the one piece of
  device-identifying data that leaves the device. *Fix direction (optional):* a one-line note in any future
  privacy blurb that 2-player races connect directly device-to-device. Not a blocker.

## D. Naming / branding — CLEAN ✅
- **All names are original/generic; no third-party trademarks or IP.** VERIFIED: cars **Pulse / Vapor / Ember /
  Ghost / Nova / Onyx / Slipstream** (`constants.ts:3143–3285`); biomes **Sunset / Midnight / Toxic / Dawn / Aurora /
  Secret Void / Deep Tunnel**; powerups **Shield / Slow-Mo / Score x2 / Magnet**; ranks **Rookie / Cruiser / Time
  Bender / Veteran / Legend** (`constants.ts:3551–3555`). No real car marque, song title, or copyrighted reference.
  "Neon Drift" itself is a generic synthwave name.

## Audit 1 — prioritized
1. **Choice-level (decide, don't auto-fix): metric units (`km/s`, `m`).** US players expect mph/miles, and "km/s"
   is physically odd. VERIFIED `HUD.ts:171`. → Craig's call: switch the *display* to mph, or keep stylized.
2. **Optional/minor: P2P IP-exposure note** for any privacy text (INFERRED). Inherent to WebRTC; private-code only.
3. Everything else (content, profanity, spelling-in-UI, data/chat/IAP/ads/links, branding): **verified clean —
   nothing to change.**

---

# AUDIT 2 — Full gameplay-arc review (FTUE → modes → loop → polish → enhancements)

## A. First-time experience (FTUE)
- **The start screen is clean + legible.** VERIFIED `Shell.ts:523–543`: a `NEON DRIFT` title, a best-score line, a
  credits line, ONE dominant **PLAY** button, a **controls hint**, then collapsible **MODES** + **GARAGE** groups.
  Utility (settings ⚙ / share ↗) is tucked in a corner. Good information hierarchy.
- **Controls are taught; the GOAL is not.** VERIFIED the hint (`Shell.ts:526–527`): "← → / A D to steer · SPACE to
  deploy a banked slow-mo" (or touch "drag to steer · tap SLOW-MO…"). **INFERRED gap (should-fix, code-verifiable):**
  a brand-new player is told *how to steer* but never *what the game is* — there's no "endless racer: weave through
  traffic, don't crash, chase distance/score" line on the start screen. The good one-liner already exists in the
  page `<meta description>` ("A synthwave endless racer — weave through traffic and chase the neon horizon") but
  isn't shown in-app. *Fix direction:* surface that one line under the title or as a first-run subtitle.
- **The hint references "slow-mo" before the player has one** (INFERRED, minor) — it names a banked-charge mechanic
  a first-timer hasn't met yet. Low priority.
- **No tutorial** — drop-in-and-play. INFERRED: acceptable/idiomatic for an arcade racer (you learn "don't crash" on
  the first WIPEOUT), but combined with the missing goal line, the very first 10 seconds lean on inference. FEEL.

## B. The modes + the arc
- **Mode map (VERIFIED `Shell.ts:563–600`):** PLAY (classic endless), **DAILY** (fixed daily seed), **VS COMPUTER**
  (the bot race, EASY/MED/HARD), **2P RACE** (private-code live MP), **ZEN** (free-roam, parallel system), **STORE**
  (spend credits on cars/cosmetics), **MISSIONS** (objectives → ranks), **SCORES** (local leaderboard). Each tile is
  presence-gated by its handler. Discoverable from one screen.
- **Progression is real, not stubbed (VERIFIED):**
  - **Missions** are concrete objectives — `constants.ts` MISSIONS: "Thread 25 near-misses", "Collect 15 powerups",
    "Deploy 5 slow-mos", "Reach the Midnight biome 3×", "Score 6,000 in one run", "Drive 3,000m in one run", scaling
    to nm60/pu40/etc. Cumulative + per-run metrics.
  - **Ranks** Rookie → Cruiser → Time Bender → Veteran → Legend (`constants.ts:3551–3555`), gated by missions
    completed, and they **unlock start biomes** (a real reward, not cosmetic-only).
  - **Credits → STORE** (cars + trail/glow cosmetics), **rival GHOSTS** (per-mode best input-replay), **daily**
    challenge. A coherent "reason to keep playing" loop.
- **No dead ends / broken modes found (VERIFIED):** no "coming soon"/unimplemented/dead buttons (the only `disabled`
  is the *unaffordable* STORE buy button, which is correct UX). MP failure states are handled with human messages
  (`connectionStatus.ts`).

## C. Core loop + feel
- **Racing loop coheres (CODE-VERIFIED structure; balance = FEEL):** near-misses (combo), powerups (Shield / Slow-Mo /
  Score x2 / Magnet), ramps (boost), distance milestones with fanfare, score combo. Objectives map cleanly onto the
  mission metrics. The **EASY bot was just made genuinely beatable** (#173) — that removes the prior "vs-CPU EASY is
  unwinnable" wall. Whether the *overall* difficulty curve feels right now is a **phone-playtest (FEEL)** judgment.
- **Zen discovery loop (CODE-VERIFIED systems; pacing = FEEL):** procedural world with landmark beacons (ring / arch /
  gateway / vista / tunnel), a secret-area warp, the tunnel→cave hybrid, a corner radar/minimap, and (per #172) a
  **fresh random world each entry** so replay has something new. The pieces are in place; whether discovery is *paced*
  and *rewarding* is FEEL (and several Zen items are Craig's active phone-validation list — see D).

## D. Polish / friction / bugs
- **No surfacing stubs / TODOs / dead UI (VERIFIED).** Grep for coming-soon/unimplemented/placeholder found only
  internal comments + the legit unaffordable-button `disabled`.
- **Zen "what do I do" gap (INFERRED, should-fix):** the Zen hint is controls-only — "drag to steer · hold GAS to
  cruise" (`ZenSession.ts:199`). A new Zen player isn't told there are **things to discover** (beacons / secret areas).
  The radar hints at it, but an explicit "follow the beacons / explore" nudge would help. FEEL-adjacent but code-fixable.
- **Known pending = Craig's phone-validation backlog (do NOT treat as recon bugs):** the Zen drive items — ring warp,
  compass, sky-slide, jumps, the #164 tunnel hybrid, #172 random worlds. The CODE for these is present/merged; their
  correctness is *phone-validation*, not a static-recon finding. Recon spotted nothing statically broken in them.
- **Accessibility (cross-ref Lighthouse #168):** `user-scalable=no` is an intentional, documented touch-game trade-off;
  A11y was otherwise ~91. No new a11y friction found in the racing/menu DOM (buttons are labelled — there's an e2e
  `assertButtonsLabelled` helper).

## E. Enhancements (highest-leverage, grounded in what exists; restraint applied)
Prioritized impact-vs-effort:
1. **(should-fix, low effort) Show the one-line "what is this" on the start screen.** Reuse the existing meta tagline.
   Closes the FTUE goal gap — the cheapest meaningful FTUE win.
2. **(decision, low effort) Resolve the units question** (mph vs km/s) — display-only change once Craig decides.
3. **(nice, low effort) A one-line Zen "explore the beacons" nudge** on first Zen entry — closes the Zen FTUE gap
   using the systems already there (landmarks + radar).
4. **(nice, med effort) Surface mission progress where players see it** (e.g. a "next mission" hint on the crash/start
   screen) — the missions + ranks exist and reward biome unlocks; making the next goal visible boosts retention.
   (VERIFY first whether the crash screen already shows mission progress — `Shell.ts` has `crashTargetEl`; if it does,
   skip this.)
5. **(nice, the existing ★ economy) Make the credit reward loop legible** — a brief "+N ★" on the crash screen ties
   runs → store. (Again, verify the crash credits readout `crashCreditsEl`/`startCreditsEl` `Shell.ts:207–208` already
   covers this before adding.)

Deliberately **not** recommended (anti-bloat): online leaderboards/accounts (would introduce the COPPA/PII surface the
game currently, cleanly, avoids), chat, real-money store, random MP matchmaking.

## Audit 2 — prioritized
- **Should-fix (code-verifiable):** start-screen goal line (FTUE); Zen "explore" nudge.
- **Decision:** units (mph vs km/s) — shared with Audit 1.
- **Nice-to-have:** make mission/credit progress more visible (verify it isn't already).
- **FEEL (phone-only):** difficulty curve after the EASY fix; Zen discovery pacing; the pending Zen-drive items.

---

*Read-only recon. No source changed. Quotes are from `main` post-#173; line numbers drift — trust the symbol names.*
