/**
 * Renders the player car: the shared procedural low-poly synthwave vehicle (see
 * CarMesh) — a tapered hull, raked cabin, four wheels, neon edge lines and a
 * ground-glow blob. Reads VehicleState (pure) and positions the mesh; never
 * mutates state. Geometry is built once.
 *
 * The lateral position is applied to the OUTER group; roll (steer lean) is
 * applied to the inner `chassis`, so the ground-glow blob that sits under the car
 * stays flat on the road and doesn't tilt with the lean.
 *
 * Cosmetics are driven by the selected car (`applyCar`): body (a deep signature
 * tint), neon glow (edges + ground glow) and accent (side strips). There are no
 * headlights — forward light quads regressed to opaque artifacts twice (#13,
 * #42) and were removed.
 */

import * as THREE from 'three';
import type { VehicleState } from '../game/Vehicle';
import { clamp } from '../utils/math';
import { CAR_VIS, type CarDef, type CarDetail } from '../utils/constants';
import { CarMesh } from './CarMesh';

export class VehicleRenderer {
  readonly group: THREE.Group;

  private readonly car: CarMesh;

  /** `detail` selects the silhouette: 'hero' (the full glowing supercar — the player)
   *  or 'simple' (a stripped, cheaper wedge — the rival, or the player on LOW quality). */
  constructor(scene: THREE.Scene, car?: CarDef, detail: CarDetail = 'hero') {
    this.car = new CarMesh(car, detail);
    this.group = this.car.group;
    scene.add(this.group);
  }

  /** Apply a car's cosmetic colours. Cheap — only colours change. */
  applyCar(car: CarDef): void {
    this.car.applyCar(car);
  }

  /** Equip / clear a GLOW cosmetic override (PR2) — overrides the car's neon edge +
   *  ground-glow colour. Sticky across applyCar; null restores the car's own glow.
   *  Purely visual; never touches the sim. */
  setGlow(hex: number | null): void {
    this.car.setGlowOverride(hex);
  }

  /** Switch hero ⇄ simple detail (player LOW-quality fallback / rival). */
  setDetail(detail: CarDetail): void {
    this.car.setDetail(detail);
  }

  /** Re-style as the translucent rival ghost (PR: rival-ghost). Keeps the car's
   *  silhouette; overrides colours + opacity. */
  makeGhost(): void {
    this.car.applyGhostStyle();
  }

  /** Fade the ghost once its recording ends. */
  markEnded(): void {
    this.car.setGhostEnded();
  }

  /** Show / hide (e.g. hide the ghost when not racing one). */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /**
   * Mirror pure state onto the transform. Roll leans the chassis into the steer
   * for feel; the outer group carries the lateral position. `forwardOffset` shifts
   * the car along z (world-units, same mapping as traffic: ahead = -z) — 0 for the
   * player (screen-fixed), and `-(ghostDistance - playerDistance)` for the ghost so
   * it appears ahead/behind on the SAME course by how far apart the two runs are.
   */
  sync(state: VehicleState, forwardOffset = 0): void {
    this.group.position.x = state.lateral;
    this.group.position.z = forwardOffset;

    const chassis = this.car.chassis;
    chassis.rotation.z = clamp(-state.lateralVel / CAR_VIS.rollReference, -1, 1) * CAR_VIS.maxRoll;
  }
}
