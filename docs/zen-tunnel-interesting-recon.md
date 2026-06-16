# Zen Tunnel "More Interesting" — Recon + Staged Build Plan

Goal: turn the underground tunnel from a transit tube into an explorable DESCENT, with all four kinds
at once — (1) visual evolution as you descend, (2) things to see passing by, (3) varied geometry
(dips/rises/twists), (4) a payoff at the bottom (it leads somewhere). Multi-PR project; staged
cheap+safe first, the path-touching kinds last with the off-center canary as the gate.

> Line numbers are from the tree at recon time (around #155); they drift as code changes — trust the
> symbol names. VERIFIED = read in code; INFERRED = reasoned.

## The load-bearing principle (threads through everything)

VERIFIED: the descent shape is ONE pair of pure functions of normalized along-position `t ∈ [−1,1]`,
and BOTH the followed surface and the rendered mesh call them — that's the #149 unification:

- `tunnelDepthFactor(t) = 1 − smoothstep(tunnelDepthEaseStart,1,|t|)` — `ZenLandmarkModel.ts:103-105`
- `tunnelBendShape(t)   = (1 − smoothstep(0.5,1,|t|))·sin(π·waves·t)` — `ZenLandmarkModel.ts:86-93`
- Surface override calls it: `ZenLandmarkSurface.ts:72`; floor mesh calls the same helper: `ZenLandmarks.ts:437`.

Consequence: varied geometry (Kind 3) that changes ONLY these two shared functions keeps mesh+surface
unified automatically (no re-divergence — the #148 root cause). The remaining risk is purely SLOPE
magnitude: per-frame ΔY = `d(depth)/d(along)·speed`. The canary bounds `maxStep < 0.6` at speed 80, so
any new depth profile must stay Lipschitz-bounded (today's grade ~6%; headroom to ~45%). Kind 4's safe
form (warp) sidesteps this entirely by leaving the tunnel surface.

## Architecture map (VERIFIED)

- Tube mesh: `buildTunnel()` `ZenLandmarks.ts:445-509`, LineSegments + LineBasicMaterial, `tunnelColor 0xffcc33`.
- Floor mesh: `buildTunnelFloor()` `ZenLandmarks.ts:516-542`, `tunnelFloorColor 0x00ffff`, loop `z=−halfL..halfL`.
- Color today: single `material.color`; no vertex colors (`lineGeo` sets position only, `:566-570`).
- Bloom #128: `UnrealBloomPass` `ZenPost.ts`; `ZEN_BLOOM` strength 0.75 / threshold 0.4 / radius 0.6 / res 0.5×; color brightness drives it.
- Reach pulse: whole-material lerp toward white `ZenLandmarks.ts:148-169`.
- Frenet membership: `d=|perp−bendOff|/√(1+slope²)`; `if (s>=halfL||d>=hw) return null;` `ZenLandmarkSurface.ts:66-69`.
- Mouth handoff: floor anchored to tunnel CENTRE: `_su.y = heightAt(lm.x,lm.z) − depth` `ZenLandmarkSurface.ts:70-73`.
- Corridor invariant: `hw − bendAmp ≥ 25` asserted `zen_tunnel_smooth.test.ts`; today 46−14=32.
- Off-center canary: offsets `[0,12,20,28]` nearest + `[0,20,30]` largest; `toggles===0`, `maxStep<0.6`; `zen_tunnel_smooth.test.ts`.
- Warp machinery: fade-out → teleport at opaque midpoint → fade-in; `advanceWarp()`/`doTeleport()` `ZenSession.ts:410-454`.
- Safe arrival #130: `v.y=heightAt(...)+rideHeight; vy=0; airborne=false` + `returnGuardDistance 130`.
- Secret space #129: `inSecret` + `VehicleSnapshot` save/restore + forced `ZEN_SECRET_BIOME`; gateway = return portal `ZenSecret.ts:37-91`.
- Biome system: 4 biomes by position-noise `biomeAt()` `ZenBiome.ts:43-72`; controls sky/fog/mountain/terrain/prop-tint.
- Trigger: `crossedOpening()` / `crossedAnyOfType()` `ZenLandmarkModel.ts:256-278`. Tunnel is an ARRIVAL type — no exit trigger today.
- Geometry shared once per type, culled at `drawRadius 2600` / `fadeBand 450` `ZenLandmarks.ts:86-95,108,183-187`.
- Far-mouth today: override drops out → plain `heightAt`; no payoff fires.

## Kind 1 — VISUAL EVOLUTION (cheapest; do first)
Options: (a) depth-driven palette shift cyan→violet→gold [REC]; (b) bloom/intensity ramp; (c) floor pattern density.
Reused: `lineGeo` (add color array), tube/floor materials, `tunnelDepthFactor`, `ZEN_BLOOM`.
Invariant impact: NONE (pure visual; never touches `surfaceUnder`).
Cost: S. Gotcha: `vertexColors` → final = `material.color × vertexColor`, and the reach-pulse mutates
`material.color` (`:148-169`). Put the gradient in the per-vertex color; keep `material.color` white as
the pulse multiplier (brighten by scaling above white for vertex-lit meshes).

## Kind 2a — THINGS TO SEE (decorative, identical-per-tunnel)
Options: (a) decorative line-geometry baked into `buildTunnel()` [REC]; (b) per-tunnel varied (= 2b); (c) drivable branches (out of scope).
Reused: `buildTunnel()` line() closure (the beacon/chevrons `:490-508` prove decorative geometry attaches), bloom.
Invariant impact: NONE (decorative; surface is depth-only). Set decoration into the WALLS/ceiling, above the road.
Cost: S. Catch: geometry is shared per type → decoration identical on every tunnel (fine for 2a).

## Kind 3 — VARIED GEOMETRY (canary-gated)
Options: (a) richer DEPTH profile (dips/rises/plateaus) within a bounded grade [REC]; (b) varied bend; (c) both.
Reused: `tunnelDepthFactor`/`tunnelBendShape` substituted in place → surface+mesh stay unified.
Invariant impact: HIGH. Keep provably green: (1) max |bendOff| ≤ bendAmp (corridor unchanged);
(2) bound `|d(depth)/d(along)|` so `grade·(speed/60)<0.6` (canary); (3) keep variation in the INNER
region (mouths still window to 0); (4) EXTEND the canary (more offsets + axial sampling).
Cost: M.

## Kind 4 — BOTTOM PAYOFF (last, its own slice)
Options: (a) warp at the bottom → distinct hidden space (reuse #129/#130) [REC, lowest risk];
(b) drivable chamber (new drivable surface — own canary); (c) drop into a contrasting biome.
Reused: `advanceWarp()`/`doTeleport()` + safe-arrival #130 + `inSecret`/snapshot/secret-biome + a NEW
"reached the deep point" trigger (tunnel has no drive-through trigger today).
Invariant impact: NONE for (a) (warp leaves the surface). (b) HIGH.
Cost: M–L (most is design: which destination / return / how it reads).

## Staged plan
| Stage | Kind | Invariant risk | Gate before merge | Cost |
|---|---|---|---|---|
| 1 | Visual evolution | None | build + existing tests | S |
| 2a | Things to see (uniform) | None | build + existing tests | S |
| 2b | Things to see (varied) | None | build; perf (geo count) | M |
| 3 | Varied geometry | HIGH | off-center canary green (extended) + corridor + unified-floor | M |
| 4 | Bottom payoff | None (a) / High (b) | canary still green + warp round-trip | M–L |

## Open calls
1. Palette direction (S1). 2. Decoration variety: uniform (S) vs per-tunnel (M) (S2). 3. Varied-geometry
character + comfort grade cap (S3). 4. Payoff destination: new hidden space / existing secret / biome
drop; return mechanic; chamber vs warp (S4). 5. Trigger at the deep point vs the far mouth (S4).
