import * as THREE from 'three';
import type { Collider, KinematicCharacterController, RigidBody } from '@dimforge/rapier3d-compat';
import { RAPIER, type Physics } from '../core/physics';
import type { Input } from '../core/input';
import type { AudioSys } from '../core/audio';
import type { Settings } from '../core/save';

const RADIUS = 0.3;
const HALF_H = 0.5; // capsule cylinder half height -> total height 1.6
const CENTER_Y = HALF_H + RADIUS; // body center above the feet
const EYE = 1.55; // eye height above the feet

/**
 * First-person controller on a Rapier kinematic character controller:
 * slides along walls, steps up curbs, snaps to the ground, and ignores
 * dynamic bodies (the thrown slipper and the can) so they never trip you.
 */
export class Player {
  readonly body: RigidBody;
  readonly collider: Collider;
  private cc: KinematicCharacterController;

  /** Feet position (updated after each physics step). */
  readonly position = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  grounded = false;
  moveEnabled = true;
  lookEnabled = true;
  /** Horizontal speed this frame, for view bob and footsteps. */
  speed = 0;

  walkSpeed = 3.7;
  runSpeed = 6.4;

  private vel = new THREE.Vector3();
  private velY = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  private stepDist = 0;
  private bobT = 0;
  private bob = 0;

  constructor(private phys: Physics, private camera: THREE.PerspectiveCamera, private input: Input, private settings: Settings, private audio: AudioSys) {
    const w = phys.world;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, CENTER_Y, 0));
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(HALF_H, RADIUS), this.body);
    this.cc = w.createCharacterController(0.02);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.enableAutostep(0.38, 0.15, false);
    this.cc.enableSnapToGround(0.3);
    this.cc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.cc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.cc.setApplyImpulsesToDynamicBodies(false);
  }

  teleport(x: number, y: number, z: number, yaw = this.yaw, pitch = 0): void {
    this.body.setTranslation({ x, y: y + CENTER_Y, z }, true);
    this.body.setNextKinematicTranslation({ x, y: y + CENTER_Y, z });
    this.position.set(x, y, z);
    this.yaw = yaw;
    this.pitch = pitch;
    this.vel.set(0, 0, 0);
    this.velY = 0;
    this.syncCamera();
  }

  /** Camera forward on the ground plane. */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Before physics step: look + compute movement. */
  update(dt: number): void {
    const inp = this.input;

    if (this.lookEnabled) {
      const s = this.settings.sensitivity * (inp.lookFromTouch ? 0.0058 : 0.0022);
      this.yaw -= inp.lookDX * s;
      this.pitch -= inp.lookDY * s * (this.settings.invertY ? -1 : 1);
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
    }

    // Desired horizontal velocity in world space
    const target = new THREE.Vector3();
    if (this.moveEnabled) {
      const speed = inp.run ? this.runSpeed : this.walkSpeed;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // forward = (-sin, -cos), right = (cos, -sin)
      target.set(-sin * inp.moveY + cos * inp.moveX, 0, -cos * inp.moveY - sin * inp.moveX).multiplyScalar(speed);
    }
    const accel = this.grounded ? 14 : 3;
    this.vel.lerp(target, 1 - Math.exp(-accel * dt));

    // Gravity, coyote time and jump buffering for forgiving jumps on touch
    this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt);
    this.jumpBuffer = inp.pressed('jump') && this.moveEnabled ? 0.14 : Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.velY = 6.6;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.grounded = false;
    }
    this.velY -= 20 * dt;
    if (this.grounded && this.velY < 0) this.velY = -1.5;

    const desired = { x: this.vel.x * dt, y: this.velY * dt, z: this.vel.z * dt };
    this.cc.computeColliderMovement(
      this.collider,
      desired,
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    const mv = this.cc.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.cc.computedGrounded();
    if (this.velY > 0 && mv.y < desired.y - 1e-4) this.velY = 0; // bonked head
    if (!wasGrounded && this.grounded && this.velY < -6) this.audio.play('step', { vol: 1.4 });

    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });

    this.speed = dt > 0 ? Math.hypot(mv.x, mv.z) / dt : 0;

    // Footsteps
    if (this.grounded && this.speed > 0.5) {
      this.stepDist += this.speed * dt;
      const stride = inp.run ? 2.1 : 1.6;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        this.audio.play('step');
      }
      this.bobT += dt * (this.speed * 2.3);
    }
    const bobTarget = this.grounded ? Math.sin(this.bobT) * Math.min(1, this.speed / 6) * 0.045 : 0;
    this.bob += (bobTarget - this.bob) * Math.min(1, dt * 12);
  }

  /** After physics step: read the body and place the camera. */
  syncCamera(): void {
    const t = this.body.translation();
    this.position.set(t.x, t.y - CENTER_Y, t.z);
    if (this.position.y < -10) {
      // fell out of the world somehow
      this.teleport(-1.5, 0.2, 7.2, 0, 0);
      return;
    }
    this.camera.position.set(this.position.x, this.position.y + EYE + this.bob, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
