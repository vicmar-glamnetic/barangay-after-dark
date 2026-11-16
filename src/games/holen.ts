import * as THREE from 'three';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import { RAPIER } from '../core/physics';
import { BaseGame, type EndRow } from './baseGame';
import type { HubLayout } from './types';

/*
 * HOLEN (marbles), solo or score battle.
 *
 * Seven marbles sit in a chalk circle. Crouch at the line, aim with your view,
 * hold to set power and release to flick your shooter. Every marble knocked
 * out of the circle is yours (+10). If your shooter stops outside the circle,
 * your next shot is from where it stopped (closer is easier). 5 shots.
 * Clear the circle for +20 and +10 per shot left.
 */

const C = new THREE.Vector3(8.6, 0, -17.2);
const R = 1.0;
const LINE = new THREE.Vector3(C.x, 0, C.z + 1.85);
const SHOTS = 5;
const TARGET_R = 0.035;
const SHOOTER_R = 0.045;
const COLORS = [0xff4d6d, 0x4cc9f0, 0xffd166, 0x06d6a0, 0x9b5de5, 0xf15bb5, 0xfee440];

type Phase = 'aim' | 'rolling' | 'done';

interface Marble {
  body: RigidBody;
  mesh: THREE.Mesh;
  out: boolean;
  /** Body already removed from the physics world. */
  gone?: boolean;
}

const _v = new THREE.Vector3();
const _dummy = new THREE.Object3D();

export class Holen extends BaseGame {
  readonly id = 'holen';
  readonly name = 'Holen';
  readonly implemented = true;
  readonly where = 'sa likod ng sari-sari store';
  readonly layout: HubLayout = {
    spot: new THREE.Vector3(8.6, 0, -15.0),
    labelPos: new THREE.Vector3(8.6, 2.6, -17.2),
    accent: '#00f5d4',
    kids: [
      { x: 7.0, z: -18.7, mode: 'crouch', faceX: C.x, faceZ: C.z },
      { x: 10.2, z: -18.6, mode: 'crouch', faceX: C.x, faceZ: C.z },
      { x: 11.1, z: -16.0, mode: 'wave', faceX: C.x, faceZ: C.z },
    ],
  };

  private targets: Marble[] = [];
  private shooter: Marble | null = null;
  private aimDots!: THREE.InstancedMesh;
  private phase: Phase = 'done';
  private shots = SHOTS;
  private score = 0;
  private outCount = 0;
  private power = 0;
  private powerDir = 1;
  private aiming = false;
  private rollT = 0;
  private shootFrom = LINE.clone();
  private clinkT = 0;

  protected onAttach(): void {
    const { scene } = this.ctx;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(R - 0.03, R + 0.03, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xa8a294 }),
    );
    ring.position.set(C.x, 0.022, C.z);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.06).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xa8a294 }));
    line.position.set(LINE.x, 0.022, LINE.z - 0.2);
    scene.add(ring, line);
    this.aimDots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.012, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85, depthWrite: false, fog: false }),
      16,
    );
    this.aimDots.frustumCulled = false;
    this.aimDots.visible = false;
    scene.add(this.aimDots);
  }

  private makeMarble(x: number, z: number, r: number, color: number, density: number): Marble {
    const { physics, scene } = this.ctx;
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, r + 0.002, z).setLinearDamping(0.45).setAngularDamping(0.3).setCcdEnabled(true),
    );
    physics.world.createCollider(RAPIER.ColliderDesc.ball(r).setDensity(density).setFriction(0.25).setRestitution(0.7), body);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 12, 8),
      new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 }),
    );
    scene.add(mesh);
    return { body, mesh, out: false };
  }

  private removeMarble(m: Marble): void {
    if (!m.gone) this.ctx.physics.world.removeRigidBody(m.body);
    m.gone = true;
    m.mesh.removeFromParent();
  }

  // ================================================================== lifecycle

  start(): void {
    const { player, hud, touch } = this.ctx;
    this.battleReset();
    this.shots = SHOTS;
    this.score = 0;
    this.outCount = 0;
    this.targets = [];
    // a plus sign of 7, slightly random each game
    const rnd = this.rng(5);
    const spots: [number, number][] = [[0, 0], [0.32, 0], [-0.32, 0], [0, 0.32], [0, -0.32], [0.55, 0.15], [-0.5, -0.2]];
    spots.forEach(([x, z], i) => this.targets.push(this.makeMarble(C.x + x + (rnd() - 0.5) * 0.08, C.z + z + (rnd() - 0.5) * 0.08, TARGET_R, COLORS[i], 2500)));
    this.shootFrom.copy(LINE);
    player.moveEnabled = false;
    player.eyeOffset = -0.95; // crouch
    touch.setActionLabel('Tira');
    touch.setJumpVisible(false);
    hud.setCrosshair(true);
    this.aimAt();
    hud.toast('Holen!', 'small', 1000);
  }

  stop(): void {
    const { player, hud, touch } = this.ctx;
    for (const m of this.targets) this.removeMarble(m);
    this.targets = [];
    if (this.shooter) this.removeMarble(this.shooter);
    this.shooter = null;
    this.aimDots.visible = false;
    this.phase = 'done';
    player.eyeOffset = 0;
    player.moveEnabled = true;
    player.lookEnabled = true;
    touch.setActionLabel('Bato');
    touch.setJumpVisible(true);
    hud.clearGameWidgets();
  }

  /** Crouch at the shooting spot facing the circle. */
  private aimAt(): void {
    const { player, hud, isTouch } = this.ctx;
    const p = this.shootFrom;
    const yaw = Math.atan2(-(C.x - p.x), -(C.z - p.z));
    player.teleport(p.x, 0, p.z, yaw, -0.55);
    player.lookEnabled = true;
    this.phase = 'aim';
    this.aiming = false;
    hud.setObjective(isTouch() ? 'I-drag para tumutok. Pindutin nang matagal ang Tira, bitawan para tumira.' : 'Tumutok gamit ang mouse. Pindutin nang matagal ang click, bitawan para tumira.');
  }

  // ================================================================== frame

  update(dt: number): void {
    const { input, hud, player, audio } = this.ctx;
    this.syncMeshes();
    if (this.phase === 'done') {
      this.battleCheck();
      return;
    }

    if (this.phase === 'aim') {
      // keep the crouched view low and aimed downward
      player.pitch = THREE.MathUtils.clamp(player.pitch, -0.9, -0.2);
      if (input.down('action')) {
        if (!this.aiming) {
          this.aiming = true;
          this.power = 0;
          this.powerDir = 1;
        }
        this.power += (this.powerDir * dt) / 1.0;
        if (this.power >= 1) {
          this.power = 1;
          this.powerDir = -1;
        } else if (this.power <= 0) {
          this.power = 0;
          this.powerDir = 1;
        }
        hud.setPower(this.power);
        this.drawAim();
      } else if (this.aiming) {
        this.shoot();
      }
    } else if (this.phase === 'rolling') {
      this.rollT += dt;
      this.clinkT -= dt;
      // clinks when marbles touch
      if (this.clinkT <= 0 && this.shooter) {
        const sp = this.shooter.body.translation();
        for (const m of this.targets) {
          if (m.out) continue;
          const t = m.body.translation();
          if (Math.hypot(t.x - sp.x, t.z - sp.z) < TARGET_R + SHOOTER_R + 0.01) {
            audio.play('marble', { pos: _v.set(t.x, t.y, t.z) });
            this.clinkT = 0.12;
            break;
          }
        }
      }
      const all = [...this.targets.filter((m) => !m.out), ...(this.shooter ? [this.shooter] : [])];
      const moving = all.some((m) => {
        const v = m.body.linvel();
        return Math.hypot(v.x, v.z) > 0.03;
      });
      if (!moving || this.rollT > 6) this.settle();
    }
    hud.setStat(`Tira: ${this.shots}   Labas: ${this.outCount}/${this.targets.length}   Puntos: ${this.score}   ${this.battleText()}`);
    this.battleCheck();
  }

  private syncMeshes(): void {
    for (const m of [...this.targets, ...(this.shooter ? [this.shooter] : [])]) {
      if (m.gone) continue;
      const t = m.body.translation(), r = m.body.rotation();
      m.mesh.position.set(t.x, t.y, t.z);
      m.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  private aimDir(out: THREE.Vector3): THREE.Vector3 {
    this.ctx.camera.getWorldDirection(out);
    out.y = 0;
    return out.normalize();
  }

  private drawAim(): void {
    const d = this.aimDir(new THREE.Vector3());
    const p = this.ctx.player.position;
    const len = 0.4 + this.power * 1.8;
    for (let i = 0; i < 16; i++) {
      const k = 0.3 + (i / 15) * len;
      _dummy.position.set(p.x + d.x * k, 0.02, p.z + d.z * k);
      _dummy.updateMatrix();
      this.aimDots.setMatrixAt(i, _dummy.matrix);
    }
    this.aimDots.instanceMatrix.needsUpdate = true;
    this.aimDots.visible = true;
  }

  private shoot(): void {
    const { player, hud, audio } = this.ctx;
    this.aiming = false;
    hud.setPower(null);
    this.aimDots.visible = false;
    const d = this.aimDir(new THREE.Vector3());
    const p = player.position;
    if (this.shooter) this.removeMarble(this.shooter);
    this.shooter = this.makeMarble(p.x + d.x * 0.3, p.z + d.z * 0.3, SHOOTER_R, 0xf1faee, 3200);
    const speed = 0.8 + this.power * 3.4;
    this.shooter.body.setLinvel({ x: d.x * speed, y: 0, z: d.z * speed }, true);
    audio.play('marble');
    this.shots--;
    this.rollT = 0;
    this.phase = 'rolling';
    player.lookEnabled = false;
  }

  /** Count marbles knocked out, then set up the next shot. */
  private settle(): void {
    const { hud, audio } = this.ctx;
    let gained = 0;
    for (const m of this.targets) {
      if (m.out) continue;
      const t = m.body.translation();
      if (Math.hypot(t.x - C.x, t.z - C.z) > R + TARGET_R) {
        m.out = true;
        gained++;
        this.removeMarble(m);
      }
    }
    if (gained) {
      this.outCount += gained;
      this.score += gained * 10;
      hud.toast(gained > 1 ? `${gained} sabay! +${gained * 10}` : '+10', 'good', 900);
      audio.play(gained > 1 ? 'cheer' : 'pickup');
      if (gained > 1) this.group.kids.forEach((k) => (k.mode = 'cheer'));
    } else hud.toast('Wala...', 'small', 700);
    this.battleReport(this.score, false);

    const left = this.targets.length - this.outCount;
    if (left === 0) {
      this.score += 20 + this.shots * 10;
      hud.toast('Ubos ang holen! Panalo!', 'good', 1500);
      return this.endRun(true);
    }
    if (this.shots <= 0) return this.endRun(false);

    // next shot from where the shooter stopped (if it stopped outside the circle and nearby)
    const s = this.shooter?.body.translation();
    const dist = s ? Math.hypot(s.x - C.x, s.z - C.z) : 0;
    if (s && dist > R + 0.15 && dist < 3.2) this.shootFrom.set(s.x, 0, s.z);
    else this.shootFrom.copy(LINE);
    if (this.shooter) this.removeMarble(this.shooter);
    this.shooter = null;
    this.aimAt();
  }

  private endRun(won: boolean): void {
    this.phase = 'done';
    this.ctx.player.lookEnabled = false;
    this.ctx.hud.setObjective(this.multiplayer ? 'Tapos ka na. Hinihintay ang iba...' : '');
    this.battleReport(this.score, true, won, [`Nailabas: ${this.outCount}/${this.targets.length}`, `Tirang natira: ${this.shots}`]);
  }

  protected finishMine(mine: EndRow, won: boolean, ranking: string[]): void {
    const out = mine.lines[0]?.match(/\d+/)?.[0] ?? '0';
    this.ctx.finish({
      gameName: this.name,
      score: mine.score,
      scoreLabel: 'puntos',
      points: mine.score,
      won,
      lines: [...mine.lines, ...ranking],
      shareText: `Naka-${out} holen ako palabas ng bilog, ${mine.score} puntos sa Hari ng Kanto!`,
    });
  }
}
