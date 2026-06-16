# Zen sky-slide — camera "spins around" before landing (EVIDENCE, no fix)

**Symptom (Craig):** on the sky-slide the camera "spun around a bunch" **just before landing** — in
the air on the way down, during the final DESCENT (NOT the touchdown/handoff seam). The twist
dizziness (#146) is fixed; this is a NEW, different spin localized to the descent end.

**Verdict:** the slide sets the car heading from `atan2` (wrapped to ±π), and the chase camera eases
toward it **in raw angle space with no wrap handling**. When the slide's heading sweeps across the
±π branch cut, `atan2` jumps ±360° while the true motion is ~1°/frame — and the camera ease "unwinds"
that phantom 360°, **orbiting the car a full turn (~940 deg/s)**. It only bites for launch headings
whose descent settles across world ±180°, so it's intermittent and lands "just before landing."

Everything below is **VERIFIED** (read in the tree + reproduced with a frame-by-frame simulation of
the real path + camera math) unless marked INFERRED.

---

## Step 1 — the heading → camera chain (file:line)

```
ZenSession.ts:359   const t = path.tangentAt(this.slideU);
ZenSession.ts:369   this.v.heading = Math.atan2(t.x, -t.z);   // ← WRAPPED to [−π, π] every slide frame
ZenRenderer.ts:251  this.boomHeading += (v.heading - this.boomHeading) * f;   // ← raw-angle lerp, NO wrap handling
ZenRenderer.ts:258  this.camera.position.x = v.x - Math.sin(this.boomHeading) * distance;
ZenRenderer.ts:259  this.camera.position.z = v.z + Math.cos(this.boomHeading) * distance;
```
So `boomHeading` is the camera's orbit angle around the car. During the slide it eases toward
`v.heading = atan2(tangent.x, −tangent.z)`. **Normal driving never hits this**: `updateZen` accumulates
`v.heading` *continuously* (no wrap), so the ease never sees a ±2π step — only the slide SETS a wrapped
`atan2` value, so only the slide can feed the ease a branch-cut jump.

### The two hypotheses the brief raised — both REFUTED by measurement
- **(a) the tangent swings fast as the curve flattens** — NO. Through the descent the raw path heading
  changes only ~**2 deg/frame** (gentle).
- **(b) the tangent goes degenerate / zero-length → undefined heading** — NO. Although every profile
  (`slideFwdOffset`, `slideLatOffset`, `slideAltOffset`) uses `smoothstep`, which has **zero derivative
  at u=1** (so the *instantaneous* velocity → 0), `tangentAt` uses a **finite central difference** with
  `eps = 1e-3` and clamps `u+eps` to 1 (`ZenSlidePath.ts:91-100`) — so it measures a non-zero finite
  difference. Measured `xzMag` of the unit tangent stays ≈ **0.94 all the way to u=1** (never degenerate).

---

## Step 2 — the measurement (the branch-cut spin, frame by frame)

Simulated a full slide (launch heading `h0 = 2.84 rad ≈ 163°`, the real `ZenSlidePath` + the real
`boomHeading` ease at `ZEN_SLIDE.camPosLerp`), logging the raw `atan2` heading and the camera through
the crossing:

```
u=0.572  v.heading(raw atan2)=-180.0   RAWstep= -0.8 deg   boom=-164.4   boomΔ=-0.7 deg/frame
u=0.574  v.heading(raw atan2)= 179.2   RAWstep=+359.2 deg  boom=-148.7   boomΔ=+15.7 deg/frame   ← BRANCH CUT
u=0.576  v.heading(raw atan2)= 178.3   RAWstep= -0.8 deg   boom=-133.8   boomΔ=+14.9 deg/frame
u=0.581  v.heading(raw atan2)= 175.7                       boom= -93.3   boomΔ=+12.9 deg/frame
u=0.590  v.heading(raw atan2)= 171.0                       boom= -37.9   boomΔ=+10.0 deg/frame
u=0.599  v.heading(raw atan2)= 166.0                       boom=  +4.9   boomΔ= +7.7 deg/frame   ← camera has swung
                                                                                                   ~170° the WRONG way
```
- At **u=0.572→0.574** the path heading moves a real **−0.8°**, but `atan2` flips **−180° → +179.2°**, so
  the *raw* value the ease consumes jumps **+359.2°**.
- The ease `boom += (v.heading − boom)·f` (no wrap) now sees a ~**+344°** gap and drives `boomHeading`
  the **long way around** — **+15.7 deg/frame**, decaying over ~30 frames as it unwinds a full turn.
- `boomHeading` drives `camera.position` via `sin/cos`, so the camera **orbits the car ~360°** — the
  "spun around a bunch."

Across launch headings (same sim): `h0 = 0.9` → max camera **1.5 deg/frame** (no crossing, smooth);
`h0 ≈ 2.64 / 2.84 / −2.74` → max **≈ 15.7 deg/frame ≈ 940 deg/s** (a crossing → spin). So it is
**launch-heading-dependent** (intermittent), exactly when the slide's heading sweep crosses world ±180°.

### Why "just before landing" (INFERRED, consistent)
As `u → 1` the bend windows to 0, so the heading **settles toward the launch-forward direction**. For a
launch oriented near world ±180°, that settle crosses the ±π branch cut **late in the descent** → the
spin lands "just before landing." (The exact crossing `u` shifts with the launch heading; the mechanism
is identical.)

### Mechanism, named
- **(c) VERIFIED — angle-wrap discontinuity.** `v.heading = atan2(...)` (`ZenSession.ts:369`) is wrapped
  to ±π; the camera ease `boomHeading += (v.heading − boomHeading)·f` (`ZenRenderer.ts:251`) is a raw-angle
  lerp with no shortest-path/wrap handling. A ±π crossing → a +360° raw step → the camera unwinds a full
  turn (~940 deg/s). NOT (a) a fast geometric swing, NOT (b) a degenerate tangent (both measured small/stable).

---

## Step 3 — why it passed, the fix DIRECTION (not applied), and the sweep canary

**Why nothing caught it:** the L3 sweep's slide phase asserts pos/cam **finite** and `onSlide` round-trips
— never the camera's **angular velocity**. 940 deg/s is perfectly finite; it's just a violent orbit.
**finite ≠ smooth (camera)** — the same gap class as the tunnel bump.

**Smallest fix DIRECTION (separate PR — do NOT apply here):**
- **Primary — make the heading ease WRAP-AWARE (shortest signed angle).** Lerp by the wrapped delta:
  `boomHeading += wrapToPi(v.heading − boomHeading) · f` (and keep `boomHeading` itself wrapped, or
  unwrap once). One change at `ZenRenderer.ts:251`; it always takes the short way, so a ±π crossing is a
  ~1°/frame step, not a 360° unwind. Harmless for normal driving (continuous heading → `wrapToPi` is a
  no-op there). (INFERRED this is the clean root fix.)
- **Alternative — feed the camera a CONTINUOUS slide heading:** accumulate / unwrap the slide heading
  (track the previous value and add the wrapped delta) instead of a fresh `atan2` each frame, so the
  value the ease consumes never jumps. Equivalent effect; more code.
- Not the cause / not the fix: the path profiles, the tangent `eps`, or the descent geometry (all measured
  smooth).

**FLAG for the validation sweep (the missing canary):** a **"camera heading doesn't spin on the slide"**
check — expose the camera's orbit angle (or `boomHeading`) in `__neonDebug`, and through the whole slide
(incl. the descent end) assert the per-frame |Δ(camera heading)| stays under a small bound (no
high-frequency / >~hundreds-of-deg/s swing). This run hit ~15.7 deg/frame (≈940 deg/s) — it would fail
loudly. Like the tunnel-smoothness canary, this catches the "finite but violent" camera class.

---

## Reproduction
A throwaway vitest (deleted) stepped the real `ZenSlidePath` + the real `boomHeading` ease
(`smoothFollow(ZEN_SLIDE.camPosLerp, dt)`) at `rideMaxSpeed`, sweeping launch headings, logging
`atan2(t.x,−t.z)` (raw + wrapped), the raw step the ease consumes, and `boomHeading` Δ. The +359° raw
step at the ±180° crossing and the camera's ~940 deg/s unwind are the trace above.
