/**
 * Renders collectible pickups + the SHIELD protection ring. Three.js layer:
 * READS the pure PowerupState and never mutates it.
 *
 * Each pickup KIND gets its own InstancedMesh (a distinct neon shape/colour),
 * sized to the pool. Active pickups of a kind fill that mesh's instances; unused
 * slots collapse to zero scale. Pickups gently spin + bob for "collect me" juice.
 * The shield ring is a single torus that follows the car while a charge is held,
 * flashing brighter during the post-absorb invulnerability window.
 *
 * Pickup colours are deliberately NOT the orange obstacle hue — they read as
 * GOOD, not threat (see POWERUP_COLORS).
 */

import * as THREE from 'three';
import type { PowerupState } from '../game/Powerups';
import {
  POWERUP_DEFS,
  POWERUP_ORDER,
  POWERUP_VIS,
  POWERUPS,
  type PowerupKind,
  type PowerupShape,
} from '../utils/constants';

/** Build the geometry for a pickup shape token (centred at the origin). */
function geometryFor(shape: PowerupShape): THREE.BufferGeometry {
  const s = POWERUP_VIS.size;
  const tube = s * POWERUP_VIS.tubeFraction;
  switch (shape) {
    case 'ring':
      return new THREE.TorusGeometry(s, tube, 10, 28);
    case 'diamond':
      return new THREE.OctahedronGeometry(s);
    case 'chevron':
      // A 4-sided pyramid pointing up — reads as an upward "boost" chevron.
      return new THREE.ConeGeometry(s, s * POWERUP_VIS.chevronAspect, 4);
    case 'horseshoe':
      // Half a torus — a magnet "U".
      return new THREE.TorusGeometry(s, tube, 10, 24, Math.PI);
  }
}

export class PowerupRenderer {
  /** One InstancedMesh per kind (keyed by kind), each sized to the pool. */
  private readonly meshes: Record<PowerupKind, THREE.InstancedMesh>;
  private readonly dummy = new THREE.Object3D();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly cursor: Record<string, number> = {};

  private readonly shieldRing: THREE.Mesh;
  private readonly shieldMat: THREE.MeshBasicMaterial;

  /** Accumulated render time for spin/bob (visual only — not the sim clock). */
  private t = 0;

  constructor(scene: THREE.Scene) {
    this.meshes = {} as Record<PowerupKind, THREE.InstancedMesh>;
    for (const kind of POWERUP_ORDER) {
      const def = POWERUP_DEFS[kind];
      const geo = geometryFor(def.shape);
      const mat = new THREE.MeshBasicMaterial({ color: def.color });
      const mesh = new THREE.InstancedMesh(geo, mat, POWERUPS.poolSize);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.meshes[kind] = mesh;
    }

    // Shield ring: a flat torus the car sits inside. Hidden until a charge is held.
    this.shieldMat = new THREE.MeshBasicMaterial({
      color: POWERUP_DEFS.shield.color,
      transparent: true,
      opacity: 0,
    });
    this.shieldRing = new THREE.Mesh(
      new THREE.TorusGeometry(POWERUP_VIS.shieldRingRadius, POWERUP_VIS.shieldRingTube, 8, 40),
      this.shieldMat,
    );
    this.shieldRing.rotation.x = Math.PI / 2; // lie flat in the road plane
    this.shieldRing.frustumCulled = false;
    this.shieldRing.visible = false;
    scene.add(this.shieldRing);
  }

  /**
   * Mirror the pure pickup pool + shield state onto the scene. Car at z = 0,
   * ahead is -z (same mapping as the traffic renderer). `dt` advances the
   * visual spin/bob only.
   */
  sync(powerups: PowerupState, playerDistance: number, vehicleLateral: number, dt: number): void {
    this.t += dt;

    // Reset per-kind instance cursors (reused object — no per-frame allocation).
    for (const kind of POWERUP_ORDER) this.cursor[kind] = 0;

    for (const p of powerups.pool) {
      if (!p.active) continue;
      const mesh = this.meshes[p.kind];
      const i = this.cursor[p.kind]++;
      const bob = Math.sin(this.t * POWERUP_VIS.bobRate + p.id) * POWERUP_VIS.bobAmplitude;
      this.dummy.position.set(p.lateral, POWERUP_VIS.meshY + bob, -(p.distance - playerDistance));
      this.dummy.rotation.set(0, this.t * POWERUP_VIS.spinRate + p.id, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
    }

    // Collapse the unused tail of each kind's mesh and flush.
    for (const kind of POWERUP_ORDER) {
      const mesh = this.meshes[kind];
      for (let i = this.cursor[kind]; i < POWERUPS.poolSize; i++) mesh.setMatrixAt(i, this.hidden);
      mesh.instanceMatrix.needsUpdate = true;
    }

    this.syncShieldRing(powerups, vehicleLateral);
  }

  /** Show / pulse the protection ring around the car. */
  private syncShieldRing(powerups: PowerupState, vehicleLateral: number): void {
    const { shield, invulnTimer } = powerups.effects;
    const show = shield || invulnTimer > 0;
    this.shieldRing.visible = show;
    if (!show) {
      this.shieldMat.opacity = 0;
      return;
    }
    this.shieldRing.position.set(vehicleLateral, POWERUP_VIS.shieldRingY, 0);
    // Steady glow while held; a fast bright flash during the i-frame window.
    this.shieldMat.opacity =
      invulnTimer > 0
        ? POWERUP_VIS.shieldRingInvulnOpacity * (0.5 + 0.5 * Math.abs(Math.sin(this.t * POWERUP_VIS.shieldRingFlashRate)))
        : POWERUP_VIS.shieldRingOpacity;
  }
}
