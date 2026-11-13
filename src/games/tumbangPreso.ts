import * as THREE from 'three';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import { RAPIER } from '../core/physics';
import { TSINELAS, tsinelasGeometry, tsinelasMaterial } from '../player/tsinelas';
import type { Kid } from '../world/npcs';
import { canTexture } from '../world/textures';
import { BaseGame } from './baseGame';
import type { HubLayout } from './types';

/*
 * TUMBANG PRESO ("knock down the prisoner")
 *
 * A can stands in a chalk circle guarded by the taya (it). From behind the
 * throw line you throw your tsinelas to knock the can over. Then run out,
 * grab your slipper and get back behind the line. While the can is down the
 * taya must fetch it and set it back up; once it is standing again the taya
 * can tag anyone who is past the line.
 *
 * 3 rounds. Scoring: knockdown +10, safe return +5, return before the can is
 * back up +5 bonus. Tagged = no return points that round.
 */

const HOME = new THREE.Vector3(-21, 0, 12); // can circle
const LINE_X = -14; // throw line (player side is x > LINE_X)
const START = new THREE.Vector3(-11.6, 0, 12);
const GUARD = new THREE.Vector3(-20.1, 0, 13.4);
const BOUNDS = { minX: -28.6, maxX: -5.5, minZ: 6.2, maxZ: 23 };
const CAN_R = 0.1;
const CAN_H = 0.3;
const ROUNDS = 3;
const ROUND_TIME = 25;
const TAYA_WALK = 3.1;
const TAYA_CHASE = 4.9;
const TAG_DIST = 0.9;
const GRAVITY = 9.81;

type Phase = 'throw' | 'out' | 'return' | 'over' | 'done';
type TayaState = 'guard' | 'fetch' | 'carry' | 'setting' | 'chase';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _dummy = new THREE.Object3D();

export class TumbangPreso extends BaseGame {
  readonly id = 'tumbangPreso';
  readonly name = 'Tumbang Preso';
  readonly implemented = true;
  readonly where = 'sa plaza, malapit sa malaking puno';
  readonly layout: HubLayout = {
    spot: new THREE.Vector3(-12, 0, 12),
    labelPos: new THREE.Vector3(-14.5, 2.9, 12),
    accent: '#ffd166',
    kids: [
      { x: GUARD.x, z: GUARD.z, faceX: -12, faceZ: 12, mode: 'idle' }, // the taya
      { x: -12.8, z: 9.4, mode: 'wave' },
      { x: -13.1, z: 14.8, mode: 'idle' },
      { x: -11.0, z: 15.3, mode: 'idle', faceX: -21, faceZ: 12 },
    ],
  };

  // persistent visuals
  private canMesh!: THREE.Mesh;
  private slipMesh!: THREE.Mesh;
  private arc!: THREE.InstancedMesh;
  private arcMarker!: THREE.Mesh;

  // physics (created per session)
  private canBody: RigidBody | null = null;
  private slipBody: RigidBody | null = null;
  private removeSlipShadow: (() => void) | null = null;

  // state
  private phase: Phase = 'done';
  private round = 0;
  private score = 0;
  private knocks = 0;
  private retrieves = 0;
  private tagged = 0;
  private canUp = true;
  private knockedThisRound = false;
  private wentOut = false;
  private aiming = false;
  private power = 0;
  private powerDir = 1;
  private roundTimer = 0;
  private overTimer = 0;
  private warnCooldown = 0;
  private landed = false;
  private touchedCan = false;
  private cheerTimer = 0;

  private taya!: Kid;
  private tayaState: TayaState = 'guard';
  private tayaReact = 0;
  private settingTimer = 0;

  protected onAttach(): void {
    const { scene, blobs } = this.ctx;
    // chalk circle + throw line
    const chalk = new THREE.MeshBasicMaterial({ color: 0x9b968a });
    const circle = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.52, 36).rotateX(-Math.PI / 2), chalk);
    circle.position.set(HOME.x, 0.025, HOME.z);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 9).rotateX(-Math.PI / 2), chalk);
    line.position.set(LINE_X, 0.025, 12);
    scene.add(circle, line);

    const label = new THREE.MeshLambertMaterial({ map: canTexture() });
    const metal = new THREE.MeshLambertMaterial({ color: 0xb8bcc4 });
    this.canMesh = new THREE.Mesh(new THREE.CylinderGeometry(CAN_R, CAN_R, CAN_H, 16), [label, metal, metal]);
    this.canMesh.position.set(HOME.x, CAN_H / 2, HOME.z);
    scene.add(this.canMesh);
    blobs.add(this.canMesh, 0.35);

    this.slipMesh = new THREE.Mesh(tsinelasGeometry(), tsinelasMaterial);
    this.slipMesh.visible = false;
    scene.add(this.slipMesh);

    this.arc = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.035, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, depthWrite: false, fog: false }),
      30,
    );
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.arcMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.22, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85, depthWrite: false, fog: false }),
    );
    this.arcMarker.visible = false;
    scene.add(this.arc, this.arcMarker);
  }

  // ------------------------------------------------------------------ lifecycle

  start(): void {
    const { physics, touch, hud } = this.ctx;
    this.round = 0;
    this.score = this.knocks = this.retrieves = this.tagged = 0;
    this.taya = this.group.kids[0];
    // spectators line up behind the throw line
    const spots: [number, number][] = [[-12.6, 8.6], [-12.4, 15.6], [-10.6, 16.0]];
    this.group.kids.slice(1).forEach((k, i) => {
      const [x, z] = spots[i] ?? [-11, 9];
      k.root.position.set(x, 0, z);
      k.face(HOME.x, HOME.z);
      k.mode = 'idle';
    });

    const rb = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(HOME.x, CAN_H / 2 + 0.003, HOME.z)
        .setCcdEnabled(true)
        .setLinearDamping(0.2)
        .setAngularDamping(0.6),
    );
    physics.world.createCollider(RAPIER.ColliderDesc.cylinder(CAN_H / 2, CAN_R).setDensity(26).setFriction(0.6).setRestitution(0.25), rb);
    this.canBody = rb;

    touch.setActionLabel('Bato');
    hud.setCrosshair(true);
    this.beginRound();
  }

  stop(): void {
    const { physics, hud, hand } = this.ctx;
    this.removeSlipper();
    if (this.canBody) physics.world.removeRigidBody(this.canBody);
    this.canBody = null;
    this.canMesh.position.set(HOME.x, CAN_H / 2, HOME.z);
    this.canMesh.quaternion.identity();
    this.arc.visible = this.arcMarker.visible = false;
    this.aiming = false;
    hand.setAim(null);
    hand.setHolding(false);
    hud.clearGameWidgets();
    this.phase = 'done';
  }

  private beginRound(): void {
    const { player, hand, hud, isTouch } = this.ctx;
    this.round++;
    this.phase = 'throw';
    this.canUp = true;
    this.knockedThisRound = false;
    this.wentOut = false;
    this.aiming = false;
    this.roundTimer = 0;
    this.tayaState = 'guard';
    this.tayaReact = 0;
    this.resetCan();
    this.removeSlipper();
    hand.setHolding(true);
    player.teleport(START.x, 0, START.z, Math.PI / 2, -0.06);
    this.taya.root.position.set(GUARD.x, 0, GUARD.z);
    this.taya.mode = 'idle';
    hud.toast(`Round ${this.round}`, 'small', 1000);
    hud.setObjective(isTouch() ? 'Pindutin nang matagal ang Bato, bitawan para ibato!' : 'Pindutin nang matagal ang click, bitawan para ibato!');
    hud.setTimer(null);
  }

  private resetCan(): void {
    const b = this.canBody;
    if (!b) return;
    b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    b.setTranslation({ x: HOME.x, y: CAN_H / 2 + 0.003, z: HOME.z }, true);
    b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  private removeSlipper(): void {
    if (this.slipBody) this.ctx.physics.world.removeRigidBody(this.slipBody);
    this.slipBody = null;
    this.slipMesh.visible = false;
    this.removeSlipShadow?.();
    this.removeSlipShadow = null;
  }

  private get playerExposed(): boolean {
    return this.ctx.player.position.x < LINE_X;
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    const { input, player, hud, hand } = this.ctx;
    const p = player.position;
    this.warnCooldown -= dt;

    if (this.cheerTimer > 0) {
      this.cheerTimer -= dt;
      if (this.cheerTimer <= 0) for (const k of this.group.kids.slice(1)) k.mode = 'idle';
    }

    if (this.phase === 'over') {
      this.overTimer -= dt;
      this.updateTaya(dt);
      if (this.overTimer <= 0) {
        if (this.round >= ROUNDS) this.end();
        else this.beginRound();
      }
      return;
    }
    if (this.phase === 'done') return;

    // ---- aiming + throwing
    if (this.phase === 'throw') {
      if (input.down('action')) {
        if (p.x < LINE_X + 0.05) {
          if (this.warnCooldown <= 0) {
            hud.toast('Sa likod ng linya!', 'bad', 900);
            this.warnCooldown = 1.2;
          }
        } else {
          if (!this.aiming) {
            this.aiming = true;
            this.power = 0;
            this.powerDir = 1;
          }
          // ping-pong power so the player times the release
          this.power += (this.powerDir * dt) / 0.9;
          if (this.power >= 1) {
            this.power = 1;
            this.powerDir = -1;
          } else if (this.power <= 0) {
            this.power = 0;
            this.powerDir = 1;
          }
          hand.setAim(this.power);
          hud.setPower(this.power);
          this.drawArc();
        }
      }
      if (this.aiming && !input.down('action')) this.throwSlipper();
    } else {
      this.roundTimer += dt;
      hud.setTimer(String(Math.max(0, Math.ceil(ROUND_TIME - this.roundTimer))));
      if (this.playerExposed) this.wentOut = true;
    }

    this.checkCan();

    // ---- slipper: landing, out of bounds, pickup
    const sb = this.slipBody;
    if (sb) {
      const t = sb.translation();
      const v = sb.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (!this.landed && t.y < 0.2) {
        this.landed = true;
        this.ctx.audio.play('slap', { pos: _v.set(t.x, t.y, t.z) });
      }
      if (t.x < BOUNDS.minX || t.x > BOUNDS.maxX || t.z < BOUNDS.minZ || t.z > BOUNDS.maxZ || t.y < -1) {
        sb.setTranslation({ x: THREE.MathUtils.clamp(t.x, BOUNDS.minX + 0.6, BOUNDS.maxX - 0.6), y: 0.3, z: THREE.MathUtils.clamp(t.z, BOUNDS.minZ + 0.6, BOUNDS.maxZ - 0.6) }, true);
        sb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
      if (this.phase === 'out' && speed < 2.5 && t.y < 1.2 && Math.hypot(t.x - p.x, t.z - p.z) < 1.35) {
        this.removeSlipper();
        hand.setHolding(true);
        this.ctx.audio.play('pickup');
        hud.toast('Nakuha!', 'small', 700);
        hud.setObjective('Bumalik sa likod ng linya!');
        this.phase = 'return';
      }
    }

    // ---- back behind the line with the slipper = safe
    if (this.phase === 'return' && p.x > LINE_X + 0.3) this.roundSafe();
    else if (this.roundTimer > ROUND_TIME) this.roundLost('Ubos ang oras!');

    this.updateTaya(dt);
    hud.setStat(`Round ${this.round}/${ROUNDS}   Puntos: ${this.score}`);
  }

  postPhysics(): void {
    if (this.canBody) {
      const t = this.canBody.translation();
      const r = this.canBody.rotation();
      this.canMesh.position.set(t.x, t.y, t.z);
      this.canMesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    if (this.slipBody) {
      const t = this.slipBody.translation();
      const r = this.slipBody.rotation();
      this.slipMesh.position.set(t.x, t.y, t.z);
      this.slipMesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  // ------------------------------------------------------------------ throw

  /** Launch origin + velocity from the camera, shared by the arc preview and the real throw. */
  private launch(origin: THREE.Vector3, vel: THREE.Vector3): void {
    const cam = this.ctx.camera;
    cam.getWorldDirection(vel);
    vel.y += 0.1;
    vel.normalize();
    const right = _v.set(1, 0, 0).applyQuaternion(cam.quaternion);
    origin.copy(cam.position).addScaledVector(vel, 0.4).addScaledVector(right, 0.16);
    origin.y -= 0.15;
    vel.multiplyScalar(5.5 + this.power * 10.5);
  }

  private drawArc(): void {
    const o = new THREE.Vector3(), v = new THREE.Vector3();
    this.launch(o, v);
    let n = 0;
    let hit: THREE.Vector3 | null = null;
    const step = 0.04;
    for (let i = 4; i < 60 && n < this.arc.count; i++) {
      const t = i * step;
      const x = o.x + v.x * t, y = o.y + v.y * t - 0.5 * GRAVITY * t * t, z = o.z + v.z * t;
      if (y < 0.02) {
        hit = new THREE.Vector3(x, 0.03, z);
        break;
      }
      if (i % 2 === 0) {
        _dummy.position.set(x, y, z);
        _dummy.updateMatrix();
        this.arc.setMatrixAt(n++, _dummy.matrix);
      }
    }
    this.arc.count = n;
    this.arc.instanceMatrix.needsUpdate = true;
    this.arc.visible = true;
    this.arcMarker.visible = !!hit;
    if (hit) this.arcMarker.position.copy(hit);
  }

  private throwSlipper(): void {
    const { physics, hand, hud, audio, blobs } = this.ctx;
    this.aiming = false;
    hand.setAim(null);
    hud.setPower(null);
    this.arc.visible = this.arcMarker.visible = false;

    const o = new THREE.Vector3(), v = new THREE.Vector3();
    this.launch(o, v);
    const q = this.ctx.camera.quaternion;
    const spin = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 6);
    const rb = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(o.x, o.y, o.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinvel(v.x, v.y, v.z)
        .setAngvel({ x: 0, y: spin, z: 0 })
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(0.4),
    );
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(TSINELAS.width / 2, TSINELAS.thickness / 2, TSINELAS.length / 2).setDensity(330).setFriction(0.9).setRestitution(0.2),
      rb,
    );
    this.slipBody = rb;
    this.slipMesh.visible = true;
    this.slipMesh.position.copy(o);
    this.removeSlipShadow = blobs.add(this.slipMesh, 0.4);
    this.landed = false;
    this.touchedCan = false;

    hand.setHolding(false);
    hand.throwAnim();
    audio.play('throw');
    this.phase = 'out';
    this.roundTimer = 0;
    hud.setObjective('Kunin ang tsinelas mo, tapos bumalik sa likod ng linya!');
  }

  // ------------------------------------------------------------------ can + taya

  private checkCan(): void {
    const b = this.canBody;
    if (!b) return;
    const t = b.translation();
    const r = b.rotation();

    // clang when the slipper hits the can
    if (this.slipBody && !this.touchedCan) {
      const s = this.slipBody.translation();
      if (Math.hypot(s.x - t.x, s.y - t.y, s.z - t.z) < 0.32) {
        this.touchedCan = true;
        this.ctx.audio.play('clang', { pos: _v.set(t.x, t.y, t.z) });
      }
    }

    if (this.canUp && this.tayaState !== 'carry' && this.tayaState !== 'setting') {
      _up.set(0, 1, 0).applyQuaternion(_q.set(r.x, r.y, r.z, r.w));
      const moved = Math.hypot(t.x - HOME.x, t.z - HOME.z);
      if (_up.y < 0.7 || moved > 0.35) {
        this.canUp = false;
        if (this.phase === 'out' && !this.knockedThisRound) {
          this.knockedThisRound = true;
          this.knocks++;
          this.score += 10;
          this.ctx.hud.toast('Tumba! +10', 'good', 1200);
          if (!this.touchedCan) this.ctx.audio.play('clang', { pos: _v.set(t.x, t.y, t.z) });
          this.ctx.audio.play('cheer');
          for (const k of this.group.kids.slice(1)) k.mode = 'cheer';
          this.cheerTimer = 1.8;
        }
        this.tayaState = 'fetch';
        this.tayaReact = 0.35;
      }
    }

    // keep a rolling can inside the plaza
    if (b.bodyType() === RAPIER.RigidBodyType.Dynamic && (t.x < BOUNDS.minX || t.x > LINE_X + 4 || t.z < BOUNDS.minZ || t.z > BOUNDS.maxZ)) {
      b.setTranslation({ x: THREE.MathUtils.clamp(t.x, BOUNDS.minX + 0.5, LINE_X + 3.5), y: 0.2, z: THREE.MathUtils.clamp(t.z, BOUNDS.minZ + 0.5, BOUNDS.maxZ - 0.5) }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  private updateTaya(dt: number): void {
    const k = this.taya;
    const kp = k.root.position;
    const pl = this.ctx.player.position;
    const can = this.canBody;
    const active = this.phase === 'out' || this.phase === 'return';

    if (this.tayaReact > 0) {
      this.tayaReact -= dt;
      k.mode = 'idle';
      if (can) {
        const t = can.translation();
        k.face(t.x, t.z, dt);
      }
      return;
    }

    let target: THREE.Vector3 | null = null;
    let speed = 0;

    switch (this.tayaState) {
      case 'guard':
        if (this.canUp && active && this.playerExposed) {
          this.tayaState = 'chase';
          this.tayaReact = 0.25;
          return;
        }
        target = GUARD;
        speed = TAYA_WALK * 0.8;
        break;
      case 'chase':
        if (!this.playerExposed || !active) {
          this.tayaState = 'guard';
          return;
        }
        target = _v.set(pl.x, 0, pl.z);
        speed = TAYA_CHASE;
        if (Math.hypot(pl.x - kp.x, pl.z - kp.z) < TAG_DIST) {
          this.roundLost('Taya ka!');
          return;
        }
        break;
      case 'fetch': {
        if (!can) return;
        const t = can.translation();
        target = _v.set(t.x, 0, t.z);
        speed = TAYA_WALK + 0.6;
        if (Math.hypot(t.x - kp.x, t.z - kp.z) < 0.6) {
          can.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
          this.tayaState = 'carry';
        }
        break;
      }
      case 'carry': {
        if (!can) return;
        target = HOME;
        speed = TAYA_WALK;
        const fx = Math.sin(k.root.rotation.y), fz = Math.cos(k.root.rotation.y);
        can.setNextKinematicTranslation({ x: kp.x + fx * 0.3, y: 0.72, z: kp.z + fz * 0.3 });
        can.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
        if (Math.hypot(HOME.x - kp.x, HOME.z - kp.z) < 0.55) {
          this.tayaState = 'setting';
          this.settingTimer = 0.7;
        }
        break;
      }
      case 'setting':
        k.mode = 'crouch';
        k.face(HOME.x, HOME.z, dt);
        this.settingTimer -= dt;
        if (this.settingTimer <= 0) {
          this.resetCan();
          this.canUp = true;
          if (active && this.playerExposed) {
            this.ctx.hud.toast('Nakatayo na ang lata! Takbo!', 'bad', 1100);
            this.tayaState = 'chase';
          } else this.tayaState = 'guard';
        }
        return;
    }

    if (target) {
      const dx = target.x - kp.x, dz = target.z - kp.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.08) {
        const s = Math.min(d, speed * dt);
        kp.x += (dx / d) * s;
        kp.z += (dz / d) * s;
        k.face(target.x, target.z, dt);
        k.mode = this.tayaState === 'carry' ? 'carry' : 'run';
        k.speed = speed;
      } else {
        k.mode = 'idle';
        k.speed = 0;
        k.face(pl.x, pl.z, dt);
      }
    }
    // the taya never crosses the throw line
    kp.x = Math.min(kp.x, LINE_X - 0.25);
    kp.x = THREE.MathUtils.clamp(kp.x, BOUNDS.minX, BOUNDS.maxX);
    kp.z = THREE.MathUtils.clamp(kp.z, BOUNDS.minZ, BOUNDS.maxZ);
    kp.y = 0;
  }

  // ------------------------------------------------------------------ round results

  private roundSafe(): void {
    const { hud, audio } = this.ctx;
    if (!this.knockedThisRound && !this.wentOut) {
      hud.toast('Sayang! Walang tumba.', 'small', 1300);
    } else {
      this.retrieves++;
      let pts = 5;
      if (!this.canUp) pts += 5;
      this.score += pts;
      hud.toast(pts > 5 ? `Bilis! +${pts}` : `Safe! +${pts}`, 'good', 1300);
      audio.play('pickup');
    }
    this.endRound(2.0);
  }

  private roundLost(msg: string): void {
    const { hud, audio, hand } = this.ctx;
    if (msg === 'Taya ka!') {
      this.tagged++;
      audio.play('tag');
      this.taya.mode = 'cheer';
    } else audio.play('lose');
    hud.toast(msg, 'bad', 1500);
    hand.setHolding(false);
    this.endRound(2.4);
  }

  private endRound(delay: number): void {
    this.phase = 'over';
    this.overTimer = delay;
    this.aiming = false;
    this.arc.visible = this.arcMarker.visible = false;
    this.ctx.hud.setPower(null);
    this.ctx.hud.setTimer(null);
    this.ctx.hud.setStat(`Round ${this.round}/${ROUNDS}   Puntos: ${this.score}`);
    if (this.tayaState === 'chase') this.tayaState = 'guard';
  }

  private end(): void {
    this.phase = 'done';
    const won = this.score >= 20;
    this.ctx.hud.setObjective('');
    this.ctx.finish({
      gameName: this.name,
      score: this.score,
      scoreLabel: 'puntos',
      points: this.score,
      won,
      lines: [
        `Tumba: ${this.knocks}/${ROUNDS}`,
        `Nakabalik nang ligtas: ${this.retrieves}/${ROUNDS}`,
        this.tagged ? `Na-taya: ${this.tagged}` : 'Hindi ka na-taya!',
      ],
      shareText: `Naka-${this.knocks} tumba at ${this.score} puntos ako sa Tumbang Preso sa Barangay After Dark!`,
    });
  }
}
