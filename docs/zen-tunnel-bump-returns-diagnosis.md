# Zen tunnel bump RETURNS — diagnosis (EVIDENCE, no fix)

**Symptom (Craig, video):** the underground-tunnel bump is back — the car POPS between the cyan
tunnel floor and the normal surface (enclosed-on-floor one moment, up on the surface with the tube
splayed wide the next). Same class as #148/#149.

**Two findings:**
1. **The bump is the #148 root-cause-#1 (`lat ≥ hw` → null → pop), and #149 only HALF-fixed it.** #149
   widened the tube to `hw ≥ tunnelBendAmplitude`, which guarantees the **exact centred axis** stays
   inside — but the usable straight-driving corridor is only `hw − bendAmp = 34 − 26 = `**8u** wide.
   Drive more than ~8u off the centreline (normal in a ±34 tube) and the weaving tube curves out from
   under you → `lat ≥ hw` → the override returns `null` → you pop to the surface.
2. **The #149 canary missed it because it drives only the one path that's guaranteed safe** — `steer=0`
   from a **centred** start (perp ≈ 0). It never tests an off-centre line, so it can't see the pop.

The **longer+deeper PR didn't create the bug** (it left `hw`/`bendAmplitude` unchanged) — it **surfaced**
it: deeper ⇒ each pop is a bigger Y jump (−21 → surface vs the old ~−9), longer ⇒ more weave/time to
be off-centre. So Craig now clearly sees a latent #149 incompleteness.

All **VERIFIED** (read in the tree + reproduced frame-by-frame with the real physics) unless INFERRED.

---

## Step 1 — reproduce + measure (current main, the longest real tunnel)

Drove the nearest tunnel (`scale 1.01`, `halfL 913`, `hw 34`, `bendAmp 26`) along its axis at several
**lateral offsets** from the centre, running the real `surfaceSlopeAlong → updateZen →
queryDrivableSurface → updateVertical` each frame:

```
offset=0  (= the canary's path): toggles=0  maxLat=26/34  maxStep=0.22 u/frame   ← SMOOTH
offset=12: toggles=2  maxLat=38/34  maxStep=2.94 u/frame (≈176 u/s)
   POP along=-548  lat=34/34 → SURFACE  y=-21.0      ← floor (deep) → normal surface
   POP along=-296  lat=34/34 → FLOOR    y=-3.1       ← and back to the floor
offset=20: toggles=2  maxLat=46/34   POP → SURFACE → FLOOR
offset=28: toggles=1  maxLat=54/34
```
- **Centred (offset 0): no pop** — `maxLat = bendAmp = 26 < hw = 34`. (Exactly why the canary passes.)
- **Off-centre ≥ 12u: pops** — `lat = |perp − bendOff|` swings to `offset + bendAmp` as the centreline
  weaves the opposite way; once `lat ≥ hw` the override drops out. `maxStep 2.94 u/frame ≈ 176 u/s` —
  **worse than #148's ~1.90** (the deeper floor → a bigger jump: −21 ↔ surface).

---

## Step 2 — which #149 invariant broke (and what longer+deeper changed)

**The null-cut (unchanged since #148):**
```
ZenLandmarkSurface.ts:57  const bendOff = ZEN_LANDMARK.tunnelBendAmplitude * lm.scale * tunnelBendShape(along / halfL);
ZenLandmarkSurface.ts:58  const lat = Math.abs(perp - bendOff);   // distance from the CURVED centreline
ZenLandmarkSurface.ts:59  if (s >= halfL || lat >= hw) return null;   // ← OUTSIDE the curved tube → normal terrain
```
**(a) Did the curve out-swing the tube again?** No — VERIFIED in constants: `tunnelHalfWidth 34 ≥
tunnelBendAmplitude 26` still holds (`constants.ts:1679, 1690`), and `bendOff` max is
`bendAmplitude·scale` — it does **not** scale with length or depth. So the *centred-axis* invariant is
intact.

**BUT the invariant #149 established is too weak.** `hw ≥ bendAmp` only protects `perp = 0` (lat =
|bendOff| ≤ bendAmp < hw). The **straight-driving corridor** — the set of `perp` that stays inside for
*every* `along` as the centreline weaves ±bendAmp — has half-width **`hw − bendAmp = 34 − 26 = 8u`**.
#149's own comment even names it: *"hw 34 ≥ bendAmplitude 26 + an ~8u drive margin."* 8u is far too
thin in a ±34 tube — any normal off-centre line clips a wall somewhere along the weave. **So #149 was
INCOMPLETE** (it fixed the unified floor + the *centred* path; it did not give a real driving corridor).
**VERIFIED.**

**(b) Did the floor mesh + followed surface re-split?** No — both still use the shared, normalized
`tunnelDepthFactor` and `heightAt(centre)`, so they deepen/lengthen together (the canary's "== mesh"
test still passes). Root-cause-#2 stays fixed. **VERIFIED.**

**What longer+deeper actually did (it surfaced, not caused):** `hw`/`bendAmplitude` are unchanged, so
the 8u corridor is identical to post-#149. `tunnelDepth 16→28` makes each pop a **bigger** Y jump
(−21 ↔ surface vs the old ~−9; `maxStep 2.94` vs `1.90`); `tunnelLength 1200→1800` gives a longer
weave + more time off-centre. So the latent #149 gap became plainly visible. **VERIFIED (constants) /
INFERRED (that this is why Craig sees it only now).**

---

## Step 3 — ⚠️ why the #149 canary didn't catch it (the guard doesn't guard)

`src/zen/__tests__/zen_tunnel_smooth.test.ts` — the "driving straight through is SMOOTH" test:
```
zen_tunnel_smooth.test.ts:70-75  v.x = tun.x − ax*(halfL+40); v.z = tun.z − az*(halfL+40);  // CENTRED on the axis (perp ≈ 0)
zen_tunnel_smooth.test.ts:73     v.heading = Math.PI − tun.rotationY;                        // straight down the axis
zen_tunnel_smooth.test.ts:84     updateZen(v, 0, 1, dt, ...);                                 // steer = 0 — never leaves the axis
zen_tunnel_smooth.test.ts:101    expect(maxLat).toBeLessThan(hw);                            // passes: maxLat = bendAmp = 26 < 34
```
**VERIFIED gaps:**
- **It drives the one path that's guaranteed safe** (centred, `steer=0`): `maxLat = |bendOff| ≤ bendAmp <
  hw`, so `lat` *can't* reach `hw` → `toggles=0`, `maxStep<0.5` always pass. The realistic **off-centre**
  line (where the pop lives) is never exercised.
- **It tests only the NEAREST tunnel** (`:19-21`) at its one `scale`. It doesn't sweep scales or terrains.
- The longer+deeper PR re-ran this same centred test → green → false confidence. The test was *written*
  to the safe path, so it can never regress on the unsafe one. **A guard that only checks the case that
  can't fail.**

The sweep's e2e tunnel canary has the same shape (drives *to* a tunnel + a brief through-pass; not an
off-centre traversal), so it didn't catch it either. **finite ≠ smooth**, and **centred ≠ how you drive**.

---

## Smallest fix DIRECTIONS (for a follow-up PR — do NOT apply here)

**Re-establish a REAL corridor (the bump):**
- **Widen the tube to give a real straight-driving margin:** require `hw ≥ bendAmplitude + driveMargin`
  with `driveMargin` a comfortable corridor (≈25–30u, not 8u) → e.g. `tunnelHalfWidth ≈ 56`. Then any
  reasonable off-centre line stays `lat < hw`. (VERIFIED the 8u corridor is the trigger; the exact width
  is a tuning call.) **Or** reduce `tunnelBendAmplitude` so the weave is small vs `hw`. **Or** decouple
  the *drivable* footprint from the *visual* weave — test `lat` against a wider drivable half-width than
  the rendered tube, or make the drivable band the envelope of the weave (so "drive straight" always
  stays on a floor), instead of a hard `lat ≥ hw` cut at the curved wall.

**Fix the guard so it can't miss this again (the canary):**
- Drive the tunnel **OFF-CENTRE** (sweep several `perp` offsets up to ~half the tube width) and/or with
  steering — assert **no `onSurface` toggle** + bounded ΔY across the whole traversal, on **multiple
  tunnel scales** (incl. `scaleMax`). And assert the corridor itself: `tunnelHalfWidth − tunnelBendAmplitude
  ≥ driveMargin`. The guard must test the line a player actually drives, not the razor-thin centred axis.

---

## Reproduction
A throwaway vitest (deleted) drove the nearest real tunnel along its axis at lateral offsets {0, 12, 20,
28}u with the real `ZenVehicle` + `ZenLandmarkSurface`, logging `onSurface` toggles, `lat` vs `hw`, and
per-frame ΔY. offset 0 → smooth; offset ≥ 12 → pops (the trace above).
