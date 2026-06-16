# Zen underground tunnel — the "bumps up and down" diagnosis (EVIDENCE, no fix)

**Symptom (Craig):** driving through the underground tunnel, the car "bumps up and down between the
tunnel and normal ground" — **throughout**, even in the middle (not just the mouths, so not the
entry/exit transition).

**Verdict:** the car bumps because **the drivable surface the car follows and the visible cyan floor
mesh are computed from two SEPARATE definitions** that disagree, and because the **curved tube swings
twice as far sideways as it is wide** (`tunnelBendAmplitude 26` vs `tunnelHalfWidth 13`) — so a car
that doesn't perfectly track the weaving road keeps crossing the tube's lateral edge and **flips
between the tunnel floor and normal ground**. Both causes arrived with the #134 curve work.

Everything below is **VERIFIED** (read in the tree + reproduced with a frame-by-frame simulation
using the real physics) unless marked INFERRED.

---

## Step 1 — the two Y definitions (they do NOT share one definition)

**KEY QUESTION (from the brief): is the Y the car FOLLOWS the same value as the visible floor mesh, at
the car's curved position?** — **No. VERIFIED.** They differ in anchor AND in the lateral profile.

### The FOLLOWED surface-Y — `src/zen/ZenLandmarkSurface.ts` (the car rides this)
```
ZenLandmarkSurface.ts:45   const tx = Math.sin(lm.rotationY);   // through-axis
ZenLandmarkSurface.ts:54   const bendOff = ZEN_LANDMARK.tunnelBendAmplitude * lm.scale * tunnelBendShape(along / halfL);
ZenLandmarkSurface.ts:55   const lat = Math.abs(perp - bendOff);          // distance from the CURVED centreline
ZenLandmarkSurface.ts:56   if (s >= halfL || lat >= hw) return null;      // ← OUTSIDE the tube → NO override (normal terrain)
ZenLandmarkSurface.ts:58   const depthF = 1 - smoothstep(halfL * ZEN_LANDMARK.tunnelDepthEaseStart, halfL, s);
ZenLandmarkSurface.ts:60   const latF   = 1 - smoothstep(hw * ZEN_LANDMARK.tunnelLateralEaseStart, hw, lat);  // ← lateral taper
ZenLandmarkSurface.ts:61   const dip    = ZEN_LANDMARK.tunnelDepth * lm.scale * depthF * latF;
ZenLandmarkSurface.ts:62   _su.y = heightAt(seed, x, z) - dip;            // ← anchored to terrain UNDER THE CAR
```
So the followed Y = `heightAt(car.x, car.z) − tunnelDepth·scale·depthF·latF`.

### The VISIBLE floor mesh — `src/zen/ZenLandmarks.ts` (the cyan road you see)
```
ZenLandmarks.ts:434  private static tunnelFloorY(z, halfL) {
ZenLandmarks.ts:435    const f = 1 - smoothstep(halfL * ZEN_LANDMARK.tunnelDepthEaseStart, halfL, Math.abs(z));
ZenLandmarks.ts:436    return -ZEN_LANDMARK.tunnelDepth * f;            // LOCAL y: depth profile only, NO latF
ZenLandmarks.ts:291  floorMesh.position.set(lm.x, groundY, lm.z);     // groundY = heightAt(lm.x, lm.z) — the CENTRE
ZenLandmarks.ts:293  floorMesh.scale.setScalar(lm.scale);
```
So the visible floor world-Y ≈ `heightAt(centre) − tunnelDepth·scale·depthF` — anchored to terrain at
the tunnel **centre** (a constant), and **with no `latF`** (the mesh floor is flat across its width).

### The mismatch (subtract them)
```
followed − visible  =  [heightAt(car) − heightAt(centre)]   ← (A) terrain undulation: car tracks LOCAL terrain, road is CENTRE-anchored
                    +  tunnelDepth·scale·depthF·(1 − latF)   ← (B) lateral taper the mesh doesn't have
```
The along-axis depth profile (`depthF`) DOES match the mesh's `f` (same formula) — so the mouths ease
correctly (that part of #133/#134 is fine). The disagreement is **(A) the anchor** and **(B) the
lateral taper**, plus the hard **null cut-off at `lat ≥ hw`**.

The car's vertical follow itself is fine and not the cause: `followSurface` eases toward the surface at
`terrainFollowLerp 12`, capped per frame (`ZenVehicle.ts:90-96`), and on a landmark surface the session
passes `allowAir = !surface.onSurface` so there's no crest-detach while covered
(`ZenSession.ts` vertical block). It faithfully follows whatever surface it's given — the surface is the problem.

---

## Step 2 — the measurement (frame-by-frame, real physics)

Simulated driving **straight** (steer 0, throttle 1) along the through-axis of the nearest real tunnel
(`@ 1187,3235`, scale 1.01), running the actual `surfaceSlopeAlong → updateZen → queryDrivableSurface
→ updateVertical` each frame and logging the car's Y, the followed surface-Y, the visible-floor-Y, the
local terrain, and `lat` vs `hw`. Representative trace:

```
TUNNEL halfL=609 hw=13 bendAmp=26 (vs hw=13)      ← the curve swings 2× the tube's half-width
f36  along=-608 lat=0/13  on=1  carY=-0.2  floorY= 1.4  terrain= 0.2  surf= 0.2   ← at the MOUTH the visible road (1.4) is already 1.2u ABOVE the car (centre-anchor, cause A)
f120 along=-497 lat=4/13  on=1  carY=-5.6  floorY=-3.6  terrain=-1.4  surf=-6.4   ← descending; car 2u BELOW the visible road, riding local terrain−dip
f150 along=-452 lat=10/13 on=1  carY=-9.3  floorY=-7.1  terrain=-1.5  surf=-9.3
f156 along=-443 lat=11/13 on=1  carY=-7.8                              surf=-5.8   ← latF taper lifts the surface as lat→hw: dY=+0.43
f162 along=-434 lat=13/13 on=1  carY=-4.5                              surf=-1.9   ← dY=+0.57 (≈34 u/s UP)
f168 along=-425 lat=14/13 on=0  carY=-1.3  floorY=-9.2  terrain=-1.3  surf=-1.3   ← lat>hw → surfaceUnder returns NULL → car POPS to normal terrain (−9.3 → −1.3 ≈ 8u)
SUMMARY: per-frame dY sign-flips=6, onSurface toggles=2, maxStep=1.90 u/frame (≈114 u/s)
```

**What the trace shows (VERIFIED):**
1. **At the mouth** the visible cyan road sits **1.2u above** where the car actually drives — the car
   is never on the road it sees (cause **A**, the centre vs local-terrain anchor), from the first frame.
2. **`lat` GROWS with depth even though the car drives perfectly straight** (`perp ≈ 0`): `lat = |perp −
   bendOff|` and `bendOff` ramps `0 → 26·scale` toward mid-tunnel. Because **`bendAmp 26 > hw 13`**, the
   curved tube slides out from under the straight path — `lat` crosses `hw` at ~`along −425`.
3. **As `lat → hw`, `latF` tapers the dip to 0**, lifting the followed surface from `−9.3` to `−1.9`
   over ~0.3s (cause **B**), then at **`lat ≥ hw` the override returns `null`** and the car snaps to
   **normal terrain** — an **~8u jump from the tunnel floor to the ground**, the literal "bumps between
   the tunnel and normal ground." Peak vertical rate ≈ **114 u/s**.

**Why it bumps THROUGHOUT in real play (INFERRED from the above, consistent with the symptom):** the
**visible road also weaves by `bendOff`** (`ZenLandmarks.ts:529` uses the same `bend(z)`), so the player
steers to follow the cyan road. Each time the weave pushes them toward a wall, `latF` lifts them /
`lat ≥ hw` drops the override (pop UP to terrain); steering back into the tube drops them onto the floor
again (pop DOWN). With `bendAmp` at 2× `hw`, the tube edge is crossed on every bend → **continuous
up/down bumping the whole length**, worse on the bends — matching "came with the curving work" (#134).

### Mechanism, named
- **(1) VERIFIED — lateral cut-off / taper vs an over-wide curve.** `tunnelBendAmplitude 26` (constants.ts:1677)
  is **2×** `tunnelHalfWidth 13` (constants.ts:1671). The followed surface tapers (`latF`, line 60) then
  hard-returns `null` (line 56) past `hw`, so straying off the weaving centreline flips the car between
  tunnel floor and normal ground (~8u, ≈114 u/s).
- **(2) VERIFIED — anchor mismatch.** Followed-Y uses `heightAt(car)` (line 62); the visible road uses
  `heightAt(centre)` (ZenLandmarks.ts:291). The car rides the rolling local terrain (minus dip) while the
  road is a flat centre-anchored profile, so the car is never on the visible road and bobs with the
  terrain undulation under the tunnel — even dead-centre.
- NOT the cause: the mouth ease (depthF matches), the follow-ease/landing loop, or a NaN. The pos stays
  finite throughout (that's exactly why it passed).

---

## Step 3 — why it passed tests + the sweep, and the smallest fix DIRECTIONS (not applied)

**Why green:** the L3 validation sweep asserts the tunnel position is **finite** (`isFinite`) and reaches
the floor, and the unit tests cover placement/rarity/minimap — **nothing asserts the car's Y is SMOOTH /
stable while driving the tunnel.** `maxStep 1.90 u/frame` is perfectly finite; it's just violently
non-smooth. **finite ≠ smooth** — that's the gap.

**Smallest fix DIRECTIONS (for a separate PR — do NOT apply here):**
- **Primary — unify to ONE curved floor definition.** Make the visible floor mesh and the followed
  surface-Y the same function of the car's position: anchor BOTH to `heightAt(car)` (or both to the
  centre) AND give the mesh the same `latF` taper (or drop `latF` from the surface). One source of
  truth → the car sits exactly on the road it sees. (INFERRED this is the clean root fix.)
- **Secondary — stop the over-wide curve crossing the wall.** Either widen the tube
  (`tunnelHalfWidth ≥ tunnelBendAmplitude`, e.g. hw ≥ ~28) so the curved floor stays under the driver, or
  reduce `tunnelBendAmplitude` below `hw`, so `lat` can't exceed `hw` along the centreline → no null-flip
  to terrain. (VERIFIED `26 > 13` is the trigger; the exact value is a tuning call.)
- **Soften, don't cure:** damping the follow would only smear the bump, not remove the floor-vs-road
  disagreement — not recommended as the fix.

**FLAG for the validation sweep (the missing canary):** add a **"car-Y smooth in the tunnel"** check —
drive straight through a tunnel and assert the per-frame |ΔY| stays under a small bound (no high-frequency
oscillation) and that `onSurface` doesn't toggle mid-tunnel. With it, `maxStep ≈ 114 u/s` /
`onSurface toggles ≥ 1` mid-tunnel would have failed loudly. Finite isn't enough.

---

## Reproduction
A throwaway vitest (deleted) drove the nearest tunnel straight with the real `ZenVehicle` +
`ZenLandmarkSurface` functions and logged the trace above. Re-runnable by simulating
`surfaceSlopeAlong → updateZen → queryDrivableSurface → updateVertical` per frame from a mouth along the
through-axis and logging `v.y`, `queryDrivableSurface().y`, `onSurface`, `heightAt(v.x,v.z)`, and
`lat = |perp − bendOff|` vs `hw`.
