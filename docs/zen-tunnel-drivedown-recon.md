# Zen Tunnel DRIVE-DOWN — Recon + Staged Plan (replace the warp with a continuous descent)

GOAL: drive fully down the tunnel INTO the cavern (no teleport), so the cavern feels AT THE BOTTOM.
This re-opens surfaceUnder / the drivable tunnel path = the bump-saga code (#148/#149/#153/#154).
Protect the #154 corridor + #149 unified floor + the off-center canary above all. VERIFIED = read in
code; INFERRED = reasoned. (Trust symbol names over line numbers; they drift.)

## Core finding
- Today the far mouth WINDOWS BACK UP to terrain (tunnelDepthFactor -> 0 at |t|->1,
  ZenLandmarkModel) and the payoff is a WARP at the deep point (#158).
- Today's cavern is DECORATION on flat heightAt terrain at SURFACE level - NOT a drivable surface
  (ZenCavern, ZenCavernLayout). Zero surface risk was why #159 was safe.
- A real drive-down needs the cavern floor DEEP + DRIVABLE = NEW drivable surface + a NEW SEAM where
  the tunnel floor hands off to the cavern floor. The seam is the #1 pop risk (a fresh #154-class
  surface). Bigger + riskier than the warp.

## THE SEAM RULE (the crux - makes or breaks it)
At the handoff the cavern-floor Y MUST equal the tunnel floor Y, AND onSurface must never go null:
  (1) Y-EQUALITY by CROSS-ANCHORING: the cavern floor anchors to the SAME
      heightAt(tunnel CENTRE) - tunnelDepth*scale reference as the tunnel's deep Y - NOT
      heightAt(cavernCentre). (Anchoring to local terrain = the #148 bump reborn.)
  (2) COVERAGE: covered = (in tube) OR (in basin) - the basin must contain the tube's far-mouth /
      deep cross-section, so leaving the tube never lands on a frame of terrain (no null -> no pop).
  (3) FLAT-ACROSS + bounded grade: both flat; the descent grade stays within the canary maxStep<0.6.
  (4) UNIFIED MESH: the basin mesh + the followed surface BOTH key off ONE function (the #149 rule).

## Q1 transition: tunnel opens into the cavern via a deep drivable basin
Options: (a) the tunnel opens into a deep drivable cavern floor [REC]; (b) disguised fade-warp
  (REJECTED - Craig wants no teleport). Two models for the cavern floor:
  (a1) BASIN DISC override (sunken radial disc, like the vista-mesa blend) - models a VAST round room,
       cost = a SECOND override + a SEAM. (Stage A proves this.)
  (a2) FLARED TUBE (one surface, no seam) - only fits a MODEST chamber (the Frenet tube doesn't model
       a big circular room).
INVARIANT: HIGH. The SEAM RULE is the gate. Reuse the vista-mesa radial blend as the disc template.

## Q2 cavern location: at the tunnel's deep end (co-located), the ground BECOMES the deep basin
Relocate ZenCavern (#159) onto the deep floor; re-anchor monuments/centerpiece baseY to the DEEP Y
(not heightAt). The cavern ground STOPS being "flat heightAt zero-risk" and BECOMES drivable surface.

## Q3 return: drive back up (continuous) [REC] vs keep a portal
Drive back up is most faithful to no-teleport (cost: a long backtrack). Open call: a shorter exit
ramp, or accept the drive-up. Adds NO new surface risk (same tube+basin in reverse).

## Q4 surface invariant: the merge gate = the EXTENDED CANARY
Drive a full round trip: outside entry mouth -> descend -> THROUGH THE SEAM -> onto the basin ->
around off-centre -> back through the seam -> up. Assert, ADDING the seam: toggles==0 across the seam,
maxStep<0.6, Y-continuity |tunnelFloorY(deep) - basinY(seam)| ~ 0, corridor invariant holds, unified
mesh==surface for tube AND basin. Drive the ACTUAL seam off-centre (#153 lesson). IF not provably
pop-free -> STOP, keep the warp. (Kill-switch.)

## Q5 state: replace inTunnelSpace WARP flag with POSITIONAL "inCavern"
A drive-down has no teleport -> no snapshot. Drive the amber palette + cavern visibility off position
(on the basin floor / within its footprint), not a warp event. inSecret (the violet gateway area)
stays separate + unchanged. Brightness fix + S1/S2 visuals unaffected.

## Q6 scope + staged plan (thin-slice the riskiest unknown FIRST; keep the warp until proven)
  Stage A (PROVE THE SEAM): a SHORT test tunnel + a SIMPLE flat basin at the deep end, cross-anchored.
    The new override + the extended canary ONLY. No beauty, no relocation, warp still shipping behind
    a flag. Deliverable: tube->basin->tube with toggles==0, maxStep<0.6, Y-continuous. FAIL -> STOP.
  Stage B (ASYMMETRIC TUNNEL): hold full depth at the far end (entry still eases to surface). Re-canary.
  Stage C (RELOCATE + DROP WARP): move ZenCavern onto the deep floor; palette/visibility by position;
    remove the #158 warp + its state.
  Stage D (RETURN + POLISH): drive-back-up + the exit-ramp decision; tune the feel.
  KEEP #158's WARP as the shipping fallback (feature-flag the drive-down) until A+B are green.

## Open calls
  1. Cavern size -> model: vast disc (a1, seam, higher risk) vs modest flared chamber (a2, no seam).
  2. Return: drive all the way back up, a shorter exit ramp, or keep a portal?
  3. Keep the warp as a fallback/flag during development? (Strongly recommend yes.)
  4. Basin shape (a1): dead-flat disc (canary-friendly) vs gently bowled (prettier, riskier) - start flat.
  5. Is a long drive-down (2600u) right, or should the drive-down tunnel be shorter?

## VERIFIED vs INFERRED
VERIFIED: the depth/membership/anchor formulas, the unified-floor call sites, the corridor invariant +
  values, the canary offsets/bounds, the warp + cavern + state wiring, that today's cavern is decoration
  on flat heightAt (no surface).
INFERRED: that a cross-anchored deep floor + full coverage CAN be pop-free (follows the #148/#149 lesson
  but UNPROVEN until Stage A's canary runs - the gamble); that a1 models a vast room better than a2;
  scope/risk sizes; that positional state (Q5) is cleaner than the warp flag.

The one-line risk read: this re-opens the exact code that took four PRs to stabilize and adds a NEW
drivable surface + a NEW seam on top - so prove the cross-anchored, fully-covered seam under an
extended canary on a SHORT slice FIRST, keep the warp until it is green, and STOP if it can't be made
pop-free.

## STAGE A RESULT (this PR)
GREEN - the seam is pop-free. The basin is a sunken disc at the tunnel's deep centre, cross-anchored
to heightAt(tunnel CENTRE) - tunnelDepth*scale, kept entirely inside the tube's deep core (basinRim <
easeStart*halfL) so it only ever abuts the tube where the tube is at full depth -> Y-equal by
construction. Flag-gated (ZEN_DRIVEDOWN.enabled, OFF in production -> the #158 warp + the normal tunnel
surface are byte-identical). Extended canary: seam dY = 0.000, seam-zone toggles = 0, seam maxStep =
0.026, whole lateral pass maxStep = 0.47 (< 0.6); axial off-centre descent (flag on) un-regressed.
Ready for Stage B.
