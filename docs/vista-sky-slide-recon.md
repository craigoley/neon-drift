# Vista Sky-Slide — design recon (NO build)

Design recon for the **Vista Sky-Slide**: driving onto a vista auto-catapults the car up into an
enclosed neon **sky-tunnel** that twists + descends like a playful slide, depositing you back on the
ground. It solves the vista's "does nothing" problem (arriving on it **is** the payoff) and adds
**verticality** — a soaring note Zen has never had.

**This is recon only — a staged build plan + the open design calls, NOT a feature.** Every code
citation is marked **VERIFIED** (read in the tree) or **INFERRED** (design judgement). All work
lands in `src/zen/` (grep gate: no `three` under `src/game/`, no `../game` under `src/zen/`).

---

## TL;DR — the two findings that shape everything

1. **The chase camera is already verticality-ready.** Camera Y and look-at are *purely car-relative*
   with **no ground clamp** — `this.camera.position.y += (v.y + ZEN.camHeight - this.camera.position.y) * f`
   and `this.lookY += (v.y + ZEN.camLookAtHeight - this.lookY) * f` (`ZenRenderer.ts:238,242`,
   **VERIFIED**). Soaring up + descending through a tube *works mechanically* with zero camera
   changes. Only **feel** (whip on the twist, the up-launch framing) needs on-device iteration.
2. **The launch can't reach the sky, and the surface override can't leave the ground.** The
   ballistic launch is capped: `v.vy = Math.min(v.vy, ZEN.maxLaunchVel)` (`ZenVehicle.ts:160`,
   **VERIFIED**) with `maxLaunchVel: 28`, `airGravity: 80` → apex ≈ `28²/(2·80)` ≈ **4.9u** of air.
   And the drivable surface is ground-bound: vista `heightAt()·(1−bump)+flatTopY·bump`
   (`ZenLandmarkSurface.ts:38`) and tunnel `heightAt(seed,x,z) − dip` (`ZenLandmarkSurface.ts:62`)
   — both **VERIFIED**, both `heightAt`-relative with no "absolute altitude" notion.

→ **The sky-slide is therefore a GUIDED PARAMETRIC RIDE on an absolute-Y path** (a "slide"), **not**
free-physics air-time and **not** a sky-ified surface override. The ascent ("catapult") is the
rising first segment of that path, ridden on-rails — not a ballistic launch. This one decision
answers Q1–Q4 coherently and reuses the most proven code (`tunnelBendShape` for the twist, the
tube/floor mesh builders, the camera, the #118 landing handoff, #128 bloom).

---

## The 7 design questions

### Q1 — The sky-tunnel path: what is it, structurally?

**Options**
- **(a) Extend the tunnel surface-override** (drivable surface + floored tube + #134 curve), placed
  ABOVE ground + descending, entered by a launch.
- **(b) A new parametric "ride"** — the car tracks a path `P(s) = (x, y, z)`; steering nudges a
  lateral offset within the tube, but `s` advances by speed (a guided slide).

**What the code supports**
- The surface override is **ground-relative** and cannot natively go above ground:
  `_su.y = heightAt(seed, x, z) - dip` (tunnel, `ZenLandmarkSurface.ts:62`, **VERIFIED**); vista
  `_su.y = heightAt(seed, x, z) * (1 - bump) + flatTopY * bump` (`:38`, **VERIFIED**); the fallback
  is also `heightAt` (`:84,:106`). There is **no absolute-altitude path** anywhere. **INFERRED:**
  making (a) work means replacing `heightAt(…) ± offset` with `skyY − descentProfile` *and* the car
  would still be *free-driving* on a floating surface (it could veer off the side, not "ride" the
  descent). That fights the "it's a slide, you ride it" goal.
- The **twist** is already a clean, reusable parametric curve — `tunnelBendShape(t)` for `t ∈ [−1,1]`
  returning a windowed sine offset with **zero value + zero tangent at the mouths**
  (`ZenLandmarkModel.ts:86`, **VERIFIED**); it already drives the tube, floor, *and* drivable surface
  (`ZenLandmarks.ts:456`, `ZenLandmarkSurface.ts:54`, **VERIFIED**). It can be evaluated for a point
  + a finite-difference tangent at any `s` — exactly what a guided ride needs.

**RECOMMEND (b), the parametric ride.** While on the slide, bypass free-driving entirely: advance a
path parameter `s` by `v.speed·dt` along `P(s)`, set the car's `x,y,z,heading` from the path, and let
steering nudge a clamped lateral offset within the tube. **Reuse:** `tunnelBendShape` for the
sideways twist; a new descending **absolute-Y** profile for the altitude; the tube + floor **mesh
builders** (`buildTunnel`/`buildTunnelFloor`, `ZenLandmarks.ts`, **VERIFIED** they exist) re-skinned
along the absolute path; the camera (already works, see Q5). This keeps `heightAt` out of the slide's
altitude entirely — the one thing the override can't give us.

---

### Q2 — The catapult (vista → sky): the launch transition

**Trigger.** Reuse the existing vista **reach / on-top** detection: a landmark is "reached" within
`reachRadius·scale` (`ZenLandmarkModel.ts`, reach test **VERIFIED**), and vista/tunnel arrival types
already hold a *persistent on-top* state — the breathing "overlook" glow while `near` is true
(`ZenLandmarks.ts:155-169`, **VERIFIED**; `isSurfaceType` = VISTA|TUNNEL, `ZenLandmarkModel.ts:68`,
**VERIFIED**). The slide arms when the car is **on the vista deck** (within a tighter on-deck radius)
and moving — the same reach signal, gated to the top.

**The launch itself — can air-time aim?** **No.** The launch is pure ballistic with no targeting:
detach is `surfaceAccel < -ZEN.airGravity` (`ZenVehicle.ts:158`), then `vy -= airGravity·dt; y += vy·dt`
(`:133-134`), with `vy` **capped at 28** (`:160`) — all **VERIFIED**. Max apex ≈ **4.9u**. A vista is
`vistaHeight: 14` tall (**VERIFIED**, constants) and the sky-tube mouth needs to sit *well above*
that, so free physics **cannot** deliver the car to a sky mouth, and there is **no trajectory
solver**.

**RECOMMEND: the "catapult" is the scripted ASCENDING FIRST SEGMENT of the slide path**, not a
ballistic launch. On trigger → enter the `onSlide` state → `P(s)` for small `s` rises from the vista
deck up to the sky-tube mouth (a smooth eased ramp in absolute Y), then twists + descends. The car is
on-rails the whole time, so it *always* arrives at the mouth (no aim problem, no cap problem). Use
the airborne **nose-pitch** purely as a visual flourish during the climb (`ZenRenderer.ts:183-186`
already tilts the car by `atan2(vy, speed)` when airborne, **VERIFIED**) — but driven from the path
tangent, not from `vy`.

**Camera on the climb.** Mechanically fine (Q5) — `camera.position.y` tracks `v.y + camHeight` with
no clamp. The **feel** of a fast upward move is new (the rig has only ever trailed ground-level
driving) → the slice's on-device gate.

---

### Q3 — The ride (the twisty slide): playful but smooth

**Steer vs ride.** A **guided slide**: `s` advances by `v.speed` (the player still feels throttle —
gas to go faster down the slide, the existing fwd/back hold), and **steering nudges a lateral offset
within the tube**, clamped to `±(halfWidth − margin)` so you can't fall off. This gives "a fun ride"
(some control, banking into the twist) without open driving.

**Reuse + make it playful.** Reuse `tunnelBendShape` for the centreline twist; for a longer, more
playful slide, raise `tunnelBendWaves` (currently `1` = a single S; **VERIFIED**) and/or chain
segments — but keep frequency LOW and eased (research: exhilarating ≠ twitchy). Reuse the camera's
visual **bank** into turns (`leanMax: 0.18`, **VERIFIED**) for the slide's banking. Keep the descent
gradient gentle and continuous (the same smoothstep-windowed easing the tunnel uses, so there are no
kinks).

**Camera on the descent.** This is the core feel risk — like the #127 tunnel-camera-on-curves lesson,
now in the sky and descending. The eased look-at (`lookY` toward `v.y + camLookAtHeight` at
`camPosLerp: 4.5`, **VERIFIED**) may lag/whip on a fast vertical twist → on-device tuning (Q5).

---

### Q4 — The return to ground: how the slide ends

**RECOMMEND: the path's final segment eases Y down to `heightAt(exitX, exitZ)` and hands back to
normal driving**, with the #118 soft-landing path absorbing any residual gap:
`v.y += Math.min(groundY − v.y, landCatchupRate(...))` (`ZenVehicle.ts:135-142`, **VERIFIED**) plus
the per-frame `terrainFollowLerp: 12` smoothing (**VERIFIED**). Because the path ends *at* ground
height, the handoff is a no-op in the common case (no snap).

**Where does it deposit you?** **RECOMMEND: back near the vista** (simplest + predictable — the slide
is the payoff, not transport). The path is a loop: vista deck → up → twist down → land a short hop
from the vista, facing outward. (The "slide as transport to somewhere new" is a tempting Stage-3
option, but it complicates re-entrancy and the minimap and isn't needed to make arriving feel like a
reward.)

---

### Q5 — Camera: the #1 risk (and the validation gate)

**The good news (mechanical): it already works.** The whole rig is car-relative with no ground
assumption — position `v.y + camHeight` (`:165,:238`), look-at `v.y + camLookAtHeight` (`:168,:242`),
boom-heading easing (`:227`), speed-driven distance/FOV (`:229-231`) — all **VERIFIED**, none derive
from terrain `heightAt`, none clamp to ground. The far plane `camFar: 4000` (**VERIFIED**) easily
covers a soaring view. There is **no airborne-specific camera code** (`:183-186` only tilts the *car*,
**VERIFIED**), so soaring inherits the normal eased follow.

**The risk (feel).** Three never-before-seen moves: (1) the **upward catapult** (rig must rise fast
without lurching — the look-at easing at `camPosLerp 4.5` could trail the climb), (2) the **twisting
descent** (the #127 curve-whip risk, now vertical), (3) the **landing** back to ground. The eased
`lookY`/`boomHeading` are the levers; they will likely need per-segment tuning (e.g. a tighter ease
while on the slide, or aiming the look-at slightly down-path).

**This is the validation gate.** The L3 sweep (#140/#141) can assert the **objective** canaries
through the whole slide — `pos`+`cam` finite, no NaN at the absolute-Y path, no stall, bounded counts
— but per its own boundary (recon §5) it **cannot** judge feel. **Camera feel stays human phone
playtest**, proven on the thin slice (Q7) before any twisty length is authored.

---

### Q6 — State + coherence

- **An `onSlide` state**, mirroring the warp machine. `tick()` already early-returns for a special
  mode — `if (this.warpPhase !== 'none') { this.advanceWarp(dt); …; return; }`
  (`ZenSession.ts:164-171`, **VERIFIED**). Add a sibling: `if (this.onSlide) { this.stepSlide(dt); …;
  return; }` **before** the normal throttle/`updateZen`/surface/vertical block — so crest physics and
  normal steering are *naturally suspended* (the normal block never runs). **INFERRED** (the slot +
  pattern are verified; the new branch is the design).
- **Re-entrancy** reuses the bounce-guard pattern: after the slide deposits you, arm a guard
  (`guardActive` + `guardX/guardZ` + a `slideGuardDistance`, mirroring `returnGuardDistance: 130` and
  the disarm-after-travel check at `ZenSession.ts:197-203`, **VERIFIED**) so you can't instantly
  re-trigger on the vista you just landed next to.
- **Minimap.** It's **XZ-only** — `projectToRadar` ignores Y (`ZenMinimapModel.ts:46-52`,
  **VERIFIED**), so the vertical slide won't *read* as height on the radar; it'll just show the XZ
  footprint tracking the path. That's acceptable (the slide is short + on-rails); the minimap keeps
  updating as it does during a warp (`ZenSession.ts:170,215`, **VERIFIED** it never suspends). A
  Stage-3 nicety: dim/annotate the radar while sliding.
- **Grep gate.** Everything (state, path math, mesh, constants) lives in `src/zen/` + `utils/constants.ts`
  — no `three` under `src/game/`, no `../game` under `src/zen/`.
- **Perf.** The sky tube reuses the tunnel tube/floor builders (one extra mesh while active); bloom is
  mobile-safe (half-res blur, LOW tier bypasses, `ZenPost.ts`, **VERIFIED**); `camFar` already covers
  the view. No new per-frame allocation if the path point/tangent use a reused scratch (the codebase's
  established `_su`/`_query`/`_scratch` pattern, **VERIFIED** in `ZenLandmarkSurface.ts`/`ZenCamera.ts`).

---

### Q7 — Scope: honest 1-PR-vs-staged

**This is the most novel single mechanic since the secret-area warp, and the launch + camera feel is
unproven. STRONGLY recommend slice-first.** Do **not** author a long twisty ride before the catapult +
soaring camera + return are proven to *feel* good on a phone.

---

## Staged build plan

> Each stage is its own PR. Stage 1 is the make-or-break feel gate; stages 2–3 only proceed if it
> feels good on-device. Findings from the L3 sweep gate the objective side; the phone gates feel.

**Stage 0 — constants + the path module (no behaviour).**
`ZEN_SLIDE` constants (mouth altitude, ascent/descent lengths, tube half-width + headroom, bend
amplitude + waves, ease starts, exit-guard distance) and a pure `ZenSlidePath` module exposing
`pointAt(s)` + `tangentAt(s)` (absolute-Y, reusing `tunnelBendShape` for lateral twist). Pure →
unit-testable in `src/game/__tests__`-style Zen tests (finite, monotonic descent, endpoints at deck
+ ground, C¹ at seams). **VERIFIED reuse:** `tunnelBendShape`.

**Stage 1 — THE THIN VERTICAL SLICE (the feel gate).**
Vista on-deck trigger → `onSlide` state → scripted ascent → a **SHORT, SIMPLE** descending tube
(straight or a single gentle bend) → ease to ground near the vista → guard. Minimal tube mesh.
**Goal: does the catapult + soaring camera + return FEEL good?** Tune `lookY`/`boomHeading` ease for
the climb/descent. Prove on-device. (The L3 sweep can already drive a vista + assert objective
canaries through the slide — wire that as the automated gate.)

**Stage 2 — the playful twist length.**
Once the slice feels right: lengthen the slide, raise `tunnelBendWaves`, add banking
(`leanMax`)-style roll, biome-tint the tube. Keep it smooth (low frequency, eased). Re-validate feel.

**Stage 3 — polish + coherence.**
Audio (synth whoosh on launch, a tone down the slide), minimap annotation while sliding, the
on-deck arrival glow → "launching" cue, and a decision on deposit point (keep near-vista unless
playtest wants transport).

---

## Open design calls (need a human decision)

1. **Slide altitude + length.** How high does the mouth sit, how long is the ride? (Drives the whole
   feel — exhilaration vs. a quick hop.) **Recommend** starting modest in Stage 1 (e.g. mouth ~3–4×
   vista height) and growing only if the climb feels good.
2. **Throttle control during the ride.** Does gas/brake modulate slide speed, or is the descent a
   fixed, authored pace? **Recommend** gas modulates within a clamped range (keeps player agency,
   stays smooth).
3. **Deposit point.** Back near the vista (recommended) vs. the slide as transport to a new region
   (Stage-3 option, more coherence cost).
4. **Camera ease during the slide.** Keep the global ease, or a slide-specific tighter look-at? **This
   is the on-device call** — can't be decided from code, only from the phone.
5. **Re-trigger policy.** Guard distance after landing, and whether the *same* vista can re-launch you
   or is spent for a while.
6. **Every vista, or rare?** Vistas are already the rarest landmark (weight 1, **VERIFIED**
   `typeWeights`). Should *all* vistas slide, or only some (keeping a few as quiet overlooks)?

---

## Reuse ledger (VERIFIED unless noted)

| System | Where | Reused for |
| --- | --- | --- |
| `tunnelBendShape(t)` windowed sine, C¹ at ends | `ZenLandmarkModel.ts:86` | the slide's lateral twist |
| Tube + floor mesh builders | `ZenLandmarks.ts` (`buildTunnel`/`buildTunnelFloor`) | the sky-tube skin (re-pathed) |
| Chase camera (car-relative Y, no ground clamp) | `ZenRenderer.ts:238,242` | soaring + descending (mechanically free) |
| Airborne car nose-pitch | `ZenRenderer.ts:183-186` | visual climb/descent tilt (driven by path tangent) |
| #118 soft landing + `terrainFollowLerp` | `ZenVehicle.ts:135-142` | smooth return-to-ground handoff |
| Special-mode early-return in `tick()` | `ZenSession.ts:164-171` | the `onSlide` branch slot |
| Bounce-guard re-entrancy | `ZenSession.ts:197-203`, `returnGuardDistance` | can't re-trigger mid/just-after slide |
| Vista reach / persistent on-top glow | `ZenLandmarks.ts:155-169` | the on-deck launch trigger |
| #128 bloom (mobile-safe) | `ZenPost.ts` | the glowing neon tube |
| Reused-scratch no-alloc pattern | `ZenLandmarkSurface.ts`, `ZenCamera.ts` | per-frame path point/tangent |

**NOT reusable (must be new):** the *altitude* — the surface override is `heightAt`-relative
(`ZenLandmarkSurface.ts:38,62`, **VERIFIED**), so the slide's absolute-Y descending path is the one
genuinely new piece of math; and the *catapult* — ballistic launch is capped at ~4.9u apex
(`ZenVehicle.ts:160`, **VERIFIED**), so the ascent is scripted on-rails, not free physics.
