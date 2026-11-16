import * as THREE from 'three';
import type { Collider, KinematicCharacterController, RigidBody } from '@dimforge/rapier3d-compat';
import { RAPIER, type Physics } from '../core/physics';

const RADIUS = 0.26;
const HALF_H = 0.36; // capsule ~1.24 m tall, kid sized
const CENTER_Y = HALF_H + RADIUS;

/**
 * A ground-bound NPC mover that uses the same Rapier character controller as
 * the player. It slides along the real static colliders, so it can never end
 * up inside a crate, wall or house. Autostep is off: it stays on the ground
 * (for Langit-Lupa, "lupa" only).
 *
 * The collider is a SENSOR: players walk through it and it only collides with
 * fixed (static) geometry, never with players or other bots.
 */
export class GroundBot {
  private body: RigidBody;
  private collider: Collider;
  private cc: KinematicCharacterController;
  private velY = 0;
  /** Feet position, valid after each physics step (call sync()). */
  readonly position = new THREE.Vector3();
  /** Distance actually moved by the last move() (for stuck detection). */
  moved = 0;

  constructor(private phys: Physics, x: number, z: number) {
    const w = phys.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, CENTER_Y, z));
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(HALF_H, RADIUS).setSensor(true), this.body);
    this.cc = w.createCharacterController(0.02);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.enableSnapToGround(0.3);
    this.cc.setMaxSlopeClimbAngle((35 * Math.PI) / 180);
    this.cc.setSlideEnabled(true);
    this.position.set(x, 0, z);
  }

  teleport(x: number, z: number): void {
    this.body.setTranslation({ x, y: CENTER_Y, z }, true);
    this.body.setNextKinematicTranslation({ x, y: CENTER_Y, z });
    this.position.set(x, 0, z);
    this.velY = 0;
  }

  /** Request a horizontal move this frame; resolved against static colliders. */
  move(dx: number, dz: number, dt: number): void {
    this.velY = Math.max(-12, this.velY - 20 * dt);
    const desired = { x: dx, y: this.velY * dt, z: dz };
    this.cc.computeColliderMovement(
      this.collider,
      desired,
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    const mv = this.cc.computedMovement();
    if (this.cc.computedGrounded()) this.velY = -1;
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
    this.moved = Math.hypot(mv.x, mv.z);
  }

  /** After the physics step: read the resolved position. */
  sync(): void {
    const t = this.body.translation();
    this.position.set(t.x, t.y - CENTER_Y, t.z);
  }

  dispose(): void {
    this.phys.world.removeCharacterController(this.cc);
    this.phys.world.removeRigidBody(this.body);
  }
}
