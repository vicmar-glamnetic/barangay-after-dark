import { L } from '../core/i18n';
import * as THREE from 'three';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import { RAPIER } from '../core/physics';
import type { GameData } from '../net/session';
import { TSINELAS, slipperColors, tsinelasGeometry, tsinelasMaterial } from '../player/tsinelas';
import type { Kid, KidMode } from '../world/npcs';
import { canTexture } from '../world/textures';
import { BaseGame, type EndRow } from './baseGame';
import type { HubLayout } from './types';

/*
 * TUMBANG PRESO ("knock down the prisoner"), solo or multiplayer.
 *
 * A can stands in a chalk circle guarded by the taya. Everyone throws their
 * tsinelas from behind the line. If the can falls, the taya must fetch it and
 * set it back up. Run out, grab your slipper and get back behind the line.
 * While the can is standing, the taya may tag anyone past the line who has
 * already grabbed their slipper (on their way back). Someone still going for
 * their slipper cannot be tagged.
 *
 * 3 rounds. Knockdown +10 (once per player per round), safe return +5,
 * return while the can is still down +5 bonus.
 *
 * MULTIPLAYER (2+ players): one PLAYER is the taya instead of the AI kid.
 * The taya cannot cross the throw line. When the can falls they walk to it
 * (picks it up), carry it back into the circle (it stands up by itself), and
 * while the can stands they tag anyone past the line who already picked up
 * their slipper, just by touching them.
 * Whoever gets tagged is the taya next round. Taya: +10 per tag, +2 per reset.
 *
 * Network: the host owns the can, every slipper and the taya (physics + AI)
 * and broadcasts a snapshot at 15 Hz. Clients only send 'throw'.
 */

const HOME = new THREE.Vector3(-21, 0, 12);
const LINE_X = -14;
const START_X = -11.6;
const SLOT_Z = [12, 10.4, 13.6, 8.8, 15.2, 7.4];
const GUARD = new THREE.Vector3(-20.1, 0, 13.4);
const BOUNDS = { minX: -28.6, maxX: -5.5, minZ: 6.2, maxZ: 23 };
const CAN_R = 0.1;
const CAN_H = 0.3;
const ROUNDS = 3;
const ROUND_TIME = 30;
const TAYA_WALK = 3.1;
const TAYA_CHASE = 4.9;
const TAG_DIST = 0.9;
const GRAVITY = 9.81;
const SNAP_HZ = 15;

type PPhase = 'throw' | 'out' | 'return' | 'safe' | 'tagged' | 'missed' | 'taya';
const PHASES: PPhase[] = ['throw', 'out', 'return', 'safe', 'tagged', 'missed', 'taya'];
type TayaState = 'guard' | 'fetch' | 'carry' | 'setting' | 'chase';
const TAYA_MODES: KidMode[] = ['idle', 'run', 'carry', 'crouch', 'cheer'];

/** Host-side participant state. */
interface Part {
  id: string;
  phase: PPhase;
  holding: boolean;
  slip: RigidBody | null;
  score: number;
  knocks: number;
  retrieves: number;
  tagged: number;
  knockedRound: boolean;
  wentOut: boolean;
  landed: boolean;
  // as the human taya (multiplayer)
  tayaRounds: number;
  tagsMade: number;
  resets: number;
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _dummy = new THREE.Object3D();

export class TumbangPreso extends BaseGame {
  readonly id = 'tumbangPreso';
  readonly name = 'Tumbang Preso';
  readonly implemented = true;
  get where() { return L('sa plaza, malapit sa malaking puno', 'in the plaza by the big tree'); }
  get blurb() { return L('Patumbahin ang lata gamit ang tsinelas', 'Knock down the can with your flip-flop'); }
  get howTo() {
    return [
      L('Ibato ang tsinelas mo mula sa likod ng linya para matumba ang lata.', 'Throw your flip-flop from behind the chalk line and try to knock the can over.'),
      L('Takbo, kunin ang tsinelas mo, at bumalik sa likod ng linya.', 'Run out, grab your flip-flop, and get back behind the line.'),
      L('Habang nakatayo ang lata, pwede kang tayain ng taya kapag hawak mo na ang tsinelas.', 'While the can is standing, the guard (the "taya") can tag you once you are holding your flip-flop.'),
      L('Habang nakahiga ang lata, ligtas ka. Bilisan!', 'While the can is down, you are safe. Hurry!'),
    ];
  }
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

  // ---- visuals (everyone)
  private canMesh!: THREE.Mesh;
  private slipGeo!: THREE.BufferGeometry;
  private slipMeshes = new Map<string, THREE.Mesh>();
  private slipShadows = new Map<string, () => void>();
  private arc!: THREE.InstancedMesh;
  private arcMarker!: THREE.Mesh;
  private taya!: Kid;

  // ---- client view state (everyone, filled from snapshots)
  private running = false;
  private myPhase: PPhase = 'throw';
  /** Multiplayer: who is the human taya this round (null = AI kid). */
  private tayaId: string | null = null;
  /** 0 can up, 1 can down, 2 being carried by the taya. */
  private canState = 0;
  private tayaWarnT = 0;
  private myHolding = false;
  private myScore = 0;
  private round = 0;
  private timeLeft = ROUND_TIME;
  private board: [string, number][] = [];
  private canTarget = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private tayaTarget = { x: GUARD.x, z: GUARD.z, rot: 0, mode: 0 };
  private slipTargets = new Map<string, { p: THREE.Vector3; q: THREE.Quaternion }>();
  private aiming = false;
  private power = 0;
  private powerDir = 1;
  private warnCooldown = 0;
  private cheerTimer = 0;

  // ---- host state
  private parts = new Map<string, Part>();
  private canBody: RigidBody | null = null;
  private canUp = true;
  private roundT = 0;
  private overT = 0;
  private hostPhase: 'play' | 'over' | 'done' = 'done';
  private tayaState: TayaState = 'guard';
  private tayaReact = 0;
  private settingT = 0;
  private snapT = 0;
  private lastToucher: string | null = null;
  private humanTaya = false;
  private carrying = false;
  private nextTaya: string | null = null;

  protected onAttach(): void {
    const { scene, blobs } = this.ctx;
    const chalk = new THREE.MeshBasicMaterial({ color: 0x9b968a });
    const circle = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.52, 36).rotateX(-Math.PI / 2), chalk);
    circle.position.set(HOME.x, 0.025, HOME.z);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 9.6).rotateX(-Math.PI / 2), chalk);
    line.position.set(LINE_X, 0.025, 11.3);
    scene.add(circle, line);

    const label = new THREE.MeshLambertMaterial({ map: canTexture() });
    const metal = new THREE.MeshLambertMaterial({ color: 0xb8bcc4 });
    this.canMesh = new THREE.Mesh(new THREE.CylinderGeometry(CAN_R, CAN_R, CAN_H, 16), [label, metal, metal]);
    this.canMesh.position.set(HOME.x, CAN_H / 2, HOME.z);
    scene.add(this.canMesh);
    blobs.add(this.canMesh, 0.35);
    this.slipGeo = tsinelasGeometry();

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

  // ================================================================== lifecycle

  start(): void {
    const { touch, hud } = this.ctx;
    this.taya = this.group.kids[0];
    const spots: [number, number][] = [[-10.4, 6.8], [-9.6, 16.8], [-8.6, 7.6]];
    this.group.kids.slice(1).forEach((k, i) => {
      const [x, z] = spots[i] ?? [-9, 7];
      k.root.position.set(x, 0, z);
      k.face(HOME.x, HOME.z);
      k.mode = 'idle';
    });
    this.running = true;
    this.myPhase = 'throw';
    this.tayaId = null;
    this.canState = 0;
    this.myHolding = false;
    this.myScore = 0;
    this.round = 0;
    this.board = [];
    this.canTarget.p.set(HOME.x, CAN_H / 2, HOME.z);
    this.canTarget.q.identity();
    touch.setActionLabel(L('Bato', 'Throw'));
    hud.setCrosshair(true);
    hud.setObjective(L('Handa na...', 'Get ready...'));

    if (this.isHost) {
      const { physics } = this.ctx;
      this.canBody = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(HOME.x, CAN_H / 2 + 0.003, HOME.z).setCcdEnabled(true).setLinearDamping(0.2).setAngularDamping(0.6),
      );
      physics.world.createCollider(RAPIER.ColliderDesc.cylinder(CAN_H / 2, CAN_R).setDensity(26).setFriction(0.6).setRestitution(0.25), this.canBody);
      this.parts.clear();
      for (const id of this.roster()) this.parts.set(id, newPart(id));
      this.round = 0;
      // Multiplayer with 2+ players: a player is the taya (rotates by tags).
      const roster = this.roster();
      this.humanTaya = this.multiplayer && roster.length >= 2;
      const wanted = this.opts.taya as string | undefined;
      this.nextTaya = this.humanTaya ? (wanted && roster.includes(wanted) ? wanted : roster[this.seed % roster.length]) : null;
      this.tayaId = null;
      this.carrying = false;
      this.hostBeginRound();
    }
  }

  stop(): void {
    const { physics, hud, hand } = this.ctx;
    this.running = false;
    for (const p of this.parts.values()) if (p.slip) physics.world.removeRigidBody(p.slip);
    this.parts.clear();
    if (this.canBody) physics.world.removeRigidBody(this.canBody);
    this.canBody = null;
    this.hostPhase = 'done';
    for (const id of [...this.slipMeshes.keys()]) this.removeSlipMesh(id);
    this.canMesh.position.set(HOME.x, CAN_H / 2, HOME.z);
    this.canMesh.quaternion.identity();
    this.arc.visible = this.arcMarker.visible = false;
    this.aiming = false;
    hand.setAim(null);
    hand.setHolding(false);
    hud.clearGameWidgets();
  }

  // ================================================================== per frame

  update(dt: number): void {
    if (!this.running) return;
    if (this.isHost) this.hostUpdate(dt);
    this.clientUpdate(dt);
  }

  postPhysics(): void {
    if (!this.running) return;
    if (this.isHost) {
      // host renders straight from the bodies
      if (this.canBody) {
        const t = this.canBody.translation(), r = this.canBody.rotation();
        this.canMesh.position.set(t.x, t.y, t.z);
        this.canMesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
      for (const p of this.parts.values()) {
        if (!p.slip) continue;
        const m = this.ensureSlipMesh(p.id);
        const t = p.slip.translation(), r = p.slip.rotation();
        m.position.set(t.x, t.y, t.z);
        m.quaternion.set(r.x, r.y, r.z, r.w);
      }
      for (const id of [...this.slipMeshes.keys()]) if (!this.parts.get(id)?.slip) this.removeSlipMesh(id);
    }
  }

  // ================================================================== client side

  private clientUpdate(dt: number): void {
    const { input, player, hud, hand, isTouch } = this.ctx;
    this.warnCooldown -= dt;
    if (this.cheerTimer > 0 && (this.cheerTimer -= dt) <= 0) for (const k of this.group.kids.slice(1)) k.mode = 'idle';

    // non-host: smooth the view toward the latest snapshot
    if (!this.isHost) {
      const k = 1 - Math.exp(-dt * 14);
      this.canMesh.position.lerp(this.canTarget.p, k);
      this.canMesh.quaternion.slerp(this.canTarget.q, k);
      for (const [id, tg] of this.slipTargets) {
        const m = this.ensureSlipMesh(id);
        if (m.position.distanceToSquared(tg.p) > 9) m.position.copy(tg.p);
        else m.position.lerp(tg.p, k);
        m.quaternion.slerp(tg.q, k);
      }
      for (const id of [...this.slipMeshes.keys()]) if (!this.slipTargets.has(id)) this.removeSlipMesh(id);
      const ty = this.tayaTarget;
      const kp = this.taya.root.position;
      const before = kp.clone();
      kp.x += (ty.x - kp.x) * k;
      kp.z += (ty.z - kp.z) * k;
      kp.y = 0;
      this.taya.root.rotation.y = ty.rot;
      this.taya.mode = TAYA_MODES[ty.mode] ?? 'idle';
      this.taya.speed = before.distanceTo(kp) / Math.max(dt, 1e-3);
    }

    // hand shows the slipper when the host says we hold it
    if (this.myHolding !== this.handHolding) {
      this.handHolding = this.myHolding;
      if (this.myHolding) hand.setHolding(true);
      else if (!this.thrownAnim) hand.setHolding(false);
      this.thrownAnim = false;
    }

    // aiming + throwing (only while it is our turn to throw)
    const canThrow = this.myPhase === 'throw' && this.myHolding;
    if (canThrow && input.down('action')) {
      if (player.position.x < LINE_X + 0.05) {
        if (this.warnCooldown <= 0) {
          hud.toast(L('Sa likod ng linya!', 'Behind the line!'), 'bad', 900);
          this.warnCooldown = 1.2;
        }
      } else {
        if (!this.aiming) {
          this.aiming = true;
          this.power = 0;
          this.powerDir = 1;
        }
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
    if (this.aiming && (!input.down('action') || !canThrow)) {
      if (canThrow) this.sendThrow();
      this.aiming = false;
      hand.setAim(null);
      hud.setPower(null);
      this.arc.visible = this.arcMarker.visible = false;
    }

    // HUD
    const obj: Record<PPhase, string> = {
      throw: isTouch()
        ? L('Pindutin nang matagal ang Bato, bitawan para ibato!', 'Hold Throw to power up, release to throw!')
        : L('Pindutin nang matagal ang click, bitawan para ibato!', 'Hold the mouse button to power up, release to throw!'),
      out: L('Kunin ang tsinelas mo, tapos bumalik sa likod ng linya!', 'Grab your flip-flop, then get back behind the line!'),
      return: L('Bumalik sa likod ng linya!', 'Get back behind the line!'),
      safe: this.multiplayer ? L('Ligtas ka! Hintayin ang iba.', "You're safe! Wait for the others.") : L('Ligtas ka!', "You're safe!"),
      tagged: L('Na-taya ka. Hintayin ang susunod na round.', 'You got tagged. Wait for the next round.'),
      missed: L('Hintayin ang susunod na round.', 'Wait for the next round.'),
      taya:
        this.canState === 1
          ? L('Natumba ang lata! Puntahan mo para kunin.', 'The can is down! Go pick it up.')
          : this.canState === 2
            ? L('Ibalik ang lata sa bilog!', 'Put the can back in the circle!')
            : L('Ikaw ang TAYA! Habang nakatayo ang lata, tayain ang may hawak nang tsinelas.', "You're the TAYA (guard)! While the can stands, tag anyone holding their flip-flop."),
    };
    // the taya may not cross the throw line
    if (this.myPhase === 'taya' && player.position.x > LINE_X - 0.25) {
      player.teleport(LINE_X - 0.3, player.position.y, player.position.z, player.yaw, player.pitch);
      this.tayaWarnT -= dt;
      if (this.tayaWarnT <= 0) {
        hud.toast(L('Bawal lumampas sa linya ang taya!', "The taya can't cross the line!"), 'bad', 900);
        this.tayaWarnT = 1.5;
      }
    }
    hud.setObjective(this.round ? obj[this.myPhase] : L('Handa na...', 'Get ready...'));
    let stat = `Round ${Math.max(1, this.round)}/${ROUNDS}   ${L('Puntos', 'Score')}: ${this.myScore}`;
    if (this.multiplayer && this.board.length > 1) stat += '   ' + this.board.slice(0, 4).map(([id, s]) => `${this.nameOf(id)} ${s}`).join(' · ');
    hud.setStat(stat);
    hud.setTimer(this.round && this.myPhase !== 'throw' ? String(Math.max(0, Math.ceil(this.timeLeft))) : null);
  }

  private handHolding = false;
  private thrownAnim = false;

  /** Launch origin + velocity from our camera, shared by the arc preview and the throw. */
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
    for (let i = 4; i < 60 && n < this.arc.count; i++) {
      const t = i * 0.04;
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

  private sendThrow(): void {
    const o = new THREE.Vector3(), v = new THREE.Vector3();
    this.launch(o, v);
    const q = this.ctx.camera.quaternion;
    this.toHost({ k: 'throw', o: [o.x, o.y, o.z], v: [v.x, v.y, v.z], q: [q.x, q.y, q.z, q.w] });
    // respond instantly on our side; the host confirms through the snapshot
    this.ctx.hand.setHolding(false);
    this.ctx.hand.throwAnim();
    this.ctx.audio.play('throw');
    this.myHolding = false;
    this.handHolding = false;
    this.thrownAnim = true;
  }

  protected onClientMsg(d: GameData): void {
    switch (d.k) {
      case 'round': {
        this.round = Number(d.n);
        this.tayaId = (d.t as string | null) ?? null;
        this.canState = 0;
        // a human taya replaces the AI kid
        this.taya.root.visible = !this.tayaId;
        const { player, hud, touch } = this.ctx;
        if (this.tayaId === this.selfId) {
          player.teleport(GUARD.x + 1.5, 0, GUARD.z - 1.4, -Math.PI / 2, -0.1);
          this.myPhase = 'taya';
          this.myHolding = false;
          this.ctx.hand.setHolding(false);
          touch.setActionLabel(L('Taya', 'Tag'));
          hud.toast(L(`Round ${this.round}: Ikaw ang TAYA!`, `Round ${this.round}: You're the TAYA!`), 'bad', 1600);
        } else {
          // thrower slots skip the taya so everyone stays spread out
          const throwers = this.roster().filter((id) => id !== this.tayaId);
          const slot = Math.max(0, throwers.indexOf(this.selfId));
          player.teleport(START_X, 0, SLOT_Z[slot % SLOT_Z.length], Math.PI / 2, -0.06);
          this.myPhase = 'throw';
          this.myHolding = true;
          touch.setActionLabel(L('Bato', 'Throw'));
          hud.toast(this.tayaId ? L(`Round ${this.round}: si ${this.nameOf(this.tayaId)} ang taya`, `Round ${this.round}: ${this.nameOf(this.tayaId)} is the taya`) : `Round ${this.round}`, 'small', 1400);
        }
        break;
      }
      case 's': {
        const me = (d.p as Record<string, [number, number, number]>)[this.selfId];
        if (me) {
          this.myPhase = PHASES[me[0]];
          this.myScore = me[1];
          if (!this.thrownAnim || me[2] === 1) this.myHolding = me[2] === 1;
        }
        this.board = Object.entries(d.p as Record<string, [number, number, number]>)
          .map(([id, v]) => [id, v[1]] as [string, number])
          .sort((a, b) => b[1] - a[1]);
        this.timeLeft = Number(d.tm);
        this.canState = Number(d.cs ?? 0);
        if (this.isHost) return; // the host renders from its own bodies
        const c = d.c as number[];
        this.canTarget.p.set(c[0], c[1], c[2]);
        this.canTarget.q.set(c[3], c[4], c[5], c[6]);
        const ty = d.ty as number[];
        this.tayaTarget = { x: ty[0], z: ty[1], rot: ty[2], mode: ty[3] };
        this.slipTargets.clear();
        for (const [id, s] of Object.entries(d.sl as Record<string, number[]>)) {
          this.slipTargets.set(id, { p: new THREE.Vector3(s[0], s[1], s[2]), q: new THREE.Quaternion(s[3], s[4], s[5], s[6]) });
        }
        break;
      }
      case 'cheer':
        for (const k of this.group.kids.slice(1)) k.mode = 'cheer';
        this.cheerTimer = 1.8;
        break;
    }
  }

  private ensureSlipMesh(id: string): THREE.Mesh {
    let m = this.slipMeshes.get(id);
    if (!m) {
      // my own slipper in my chosen colors; everyone else's in the default blue
      m = new THREE.Mesh(id === this.selfId ? tsinelasGeometry(slipperColors.strap, slipperColors.top) : this.slipGeo, tsinelasMaterial);
      this.ctx.scene.add(m);
      this.slipMeshes.set(id, m);
      this.slipShadows.set(id, this.ctx.blobs.add(m, 0.4));
    }
    return m;
  }

  private removeSlipMesh(id: string): void {
    this.slipMeshes.get(id)?.removeFromParent();
    this.slipMeshes.delete(id);
    this.slipShadows.get(id)?.();
    this.slipShadows.delete(id);
  }

  // ================================================================== host side

  protected onHostMsg(from: string, d: GameData): void {
    if (d.k !== 'throw') return;
    const p = this.parts.get(from);
    if (!p || p.phase !== 'throw' || !p.holding || this.hostPhase !== 'play') return;
    const pos = this.posOf(from);
    if (!pos || pos.x < LINE_X - 0.5) return;
    const o = d.o as number[], v = d.v as number[], q = d.q as number[];
    const spin = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 6);
    const rb = this.ctx.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(o[0], o[1], o[2])
        .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] })
        .setLinvel(v[0], v[1], v[2])
        .setAngvel({ x: 0, y: spin, z: 0 })
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(0.4),
    );
    this.ctx.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(TSINELAS.width / 2, TSINELAS.thickness / 2, TSINELAS.length / 2).setDensity(330).setFriction(0.9).setRestitution(0.2),
      rb,
    );
    p.slip = rb;
    p.holding = false;
    p.phase = 'out';
    p.landed = false;
    if (from !== this.selfId) this.sfx('throw', _v.set(o[0], o[1], o[2]));
  }

  private hostBeginRound(): void {
    this.round++;
    this.hostPhase = 'play';
    this.roundT = 0;
    this.canUp = true;
    this.tayaState = 'guard';
    this.tayaReact = 0;
    this.lastToucher = null;
    this.resetCan();
    this.carrying = false;
    if (this.humanTaya) {
      const ids = [...this.parts.keys()];
      const pick = this.nextTaya && this.parts.has(this.nextTaya) ? this.nextTaya : this.tayaId && this.parts.has(this.tayaId) ? this.tayaId : ids[0];
      this.tayaId = pick ?? null;
      this.nextTaya = null;
      if (ids.length < 2) {
        this.humanTaya = false; // everyone else left: the AI kid takes over
        this.tayaId = null;
      }
    }
    for (const p of this.parts.values()) {
      if (p.slip) this.ctx.physics.world.removeRigidBody(p.slip);
      p.slip = null;
      const isTaya = p.id === this.tayaId;
      p.phase = isTaya ? 'taya' : 'throw';
      p.holding = !isTaya;
      p.knockedRound = false;
      p.wentOut = false;
      if (isTaya) p.tayaRounds++;
    }
    this.taya.root.position.set(GUARD.x, 0, GUARD.z);
    this.taya.mode = 'idle';
    this.toAll({ k: 'round', n: this.round, t: this.tayaId });
  }

  private hostUpdate(dt: number): void {
    // drop players who left the lobby
    const ids = new Set(this.roster());
    for (const [id, p] of this.parts) {
      if (ids.has(id)) continue;
      if (p.slip) this.ctx.physics.world.removeRigidBody(p.slip);
      this.parts.delete(id);
    }

    if (this.humanTaya && this.tayaId && !this.parts.has(this.tayaId) && this.hostPhase === 'play') {
      this.toast(null, L('Umalis ang taya. Bagong round!', 'The taya left. New round!'), 'bad', 1400);
      this.tayaId = null;
      this.hostPhase = 'over';
      this.overT = 1.5;
    }

    if (this.hostPhase === 'over') {
      this.overT -= dt;
      if (!this.humanTaya) this.hostTaya(dt);
      if (this.overT <= 0) {
        if (this.round >= ROUNDS) this.hostEnd();
        else this.hostBeginRound();
      }
    } else if (this.hostPhase === 'play') {
      this.roundT += dt;
      this.hostCan();
      this.hostSlippers();
      if (this.humanTaya) this.hostHumanTaya();
      else this.hostTaya(dt);
      const allDone = [...this.parts.values()].every((p) => p.phase === 'safe' || p.phase === 'tagged' || p.phase === 'missed' || p.phase === 'taya');
      if (allDone || this.roundT > ROUND_TIME) {
        if (!allDone) this.toast(null, L('Ubos ang oras!', "Time's up!"), 'bad', 1300);
        for (const p of this.parts.values()) if (p.phase === 'throw' || p.phase === 'out' || p.phase === 'return') p.phase = 'missed';
        this.hostPhase = 'over';
        this.overT = 2.4;
        if (this.tayaState === 'chase') this.tayaState = 'guard';
      }
    }

    // snapshot
    this.snapT -= dt;
    if (this.snapT <= 0) {
      this.snapT = 1 / SNAP_HZ;
      this.sendSnap();
    }
  }

  private sendSnap(): void {
    const c = this.canMesh;
    const p: Record<string, [number, number, number]> = {};
    const sl: Record<string, number[]> = {};
    for (const part of this.parts.values()) {
      p[part.id] = [PHASES.indexOf(part.phase), part.score, part.holding ? 1 : 0];
      if (part.slip) {
        const t = part.slip.translation(), r = part.slip.rotation();
        sl[part.id] = [t.x, t.y, t.z, r.x, r.y, r.z, r.w].map(r3);
      }
    }
    const k = this.taya.root;
    this.toAll({
      k: 's',
      c: [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w].map(r3),
      ty: [r3(k.position.x), r3(k.position.z), r3(k.rotation.y), Math.max(0, TAYA_MODES.indexOf(this.taya.mode))],
      sl,
      p,
      tm: r3(ROUND_TIME - this.roundT),
      cs: this.canUp ? 0 : this.carrying ? 2 : 1,
    });
  }

  /** Feet yaw of a participant (for carrying the can in front of them). */
  private yawOf(id: string): number {
    if (id === this.selfId) return this.ctx.player.yaw;
    return this.net?.poses.get(id)?.yaw ?? 0;
  }

  /** Multiplayer: the taya is a player. Pick up / carry / reset the can, and tag. */
  private hostHumanTaya(): void {
    const id = this.tayaId;
    const can = this.canBody;
    if (!id || !can) return;
    const tp = this.posOf(id);
    const me = this.parts.get(id);
    if (!tp || !me) return;
    if (!this.canUp) {
      if (!this.carrying) {
        const t = can.translation();
        if (Math.hypot(t.x - tp.x, t.z - tp.z) < 0.95) {
          can.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
          this.carrying = true;
          this.toast(id, L('Hawak mo ang lata! Ibalik sa bilog.', 'Got the can! Put it back in the circle.'), 'small', 1100);
        }
      } else {
        const yaw = this.yawOf(id);
        can.setNextKinematicTranslation({ x: tp.x - Math.sin(yaw) * 0.4, y: tp.y + 0.75, z: tp.z - Math.cos(yaw) * 0.4 });
        can.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
        if (Math.hypot(HOME.x - tp.x, HOME.z - tp.z) < 0.85) {
          this.resetCan();
          this.canUp = true;
          this.carrying = false;
          this.lastToucher = null;
          me.score += 2;
          me.resets++;
          this.toast(null, L('Nakatayo na ang lata! Takbo!', 'The can is back up! Run!'), 'bad', 1100);
          this.sfx('clang', HOME);
        }
      }
      return;
    }
    // can is standing: touch anyone past the line who already grabbed their slipper
    for (const p of this.parts.values()) {
      if (p.id === id || p.phase !== 'return') continue;
      const pos = this.posOf(p.id);
      if (!pos || pos.x >= LINE_X) continue;
      if (Math.hypot(pos.x - tp.x, pos.z - tp.z) < 1.0) {
        p.phase = 'tagged';
        p.holding = false;
        p.tagged++;
        me.score += 10;
        me.tagsMade++;
        this.nextTaya = p.id;
        this.toast(p.id, L('Taya ka! Ikaw ang susunod na taya.', "Tagged! You're the next taya."), 'bad', 1600);
        this.toast(id, L(`Nataya mo si ${this.net?.nameOf(p.id) ?? 'siya'}! +10`, `You tagged ${this.net?.nameOf(p.id) ?? 'them'}! +10`), 'good', 1300);
        this.sfx('tag');
      }
    }
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

  private hostCan(): void {
    const b = this.canBody;
    if (!b) return;
    const t = b.translation(), r = b.rotation();

    // remember whose slipper touched the can last (for knock credit + clang)
    for (const p of this.parts.values()) {
      if (!p.slip) continue;
      const s = p.slip.translation();
      if (Math.hypot(s.x - t.x, s.y - t.y, s.z - t.z) < 0.32 && this.lastToucher !== p.id) {
        this.lastToucher = p.id;
        this.sfx('clang', _v.set(t.x, t.y, t.z));
      }
    }

    if (this.canUp && this.tayaState !== 'carry' && this.tayaState !== 'setting') {
      _up.set(0, 1, 0).applyQuaternion(_q.set(r.x, r.y, r.z, r.w));
      const moved = Math.hypot(t.x - HOME.x, t.z - HOME.z);
      if (_up.y < 0.7 || moved > 0.35) {
        this.canUp = false;
        const who = this.lastToucher ? this.parts.get(this.lastToucher) : null;
        if (who && !who.knockedRound && (who.phase === 'out' || who.phase === 'return')) {
          who.knockedRound = true;
          who.knocks++;
          who.score += 10;
          this.toast(who.id, L('Tumba! +10', 'Knocked down! +10'), 'good', 1200);
          if (this.multiplayer) this.toast(null, L(`Tumba ni ${this.net!.nameOf(who.id)}!`, `${this.net!.nameOf(who.id)} knocked it down!`), 'small', 1000);
          this.sfx('cheer');
          this.toAll({ k: 'cheer' });
        }
        this.tayaState = 'fetch';
        this.tayaReact = 0.35;
      }
    }

    if (b.bodyType() === RAPIER.RigidBodyType.Dynamic && (t.x < BOUNDS.minX || t.x > LINE_X + 4 || t.z < BOUNDS.minZ || t.z > BOUNDS.maxZ)) {
      b.setTranslation({ x: THREE.MathUtils.clamp(t.x, BOUNDS.minX + 0.5, LINE_X + 3.5), y: 0.2, z: THREE.MathUtils.clamp(t.z, BOUNDS.minZ + 0.5, BOUNDS.maxZ - 0.5) }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  private hostSlippers(): void {
    for (const p of this.parts.values()) {
      const pos = this.posOf(p.id);
      if (pos && pos.x < LINE_X && (p.phase === 'out' || p.phase === 'return')) p.wentOut = true;

      if (p.slip) {
        const t = p.slip.translation();
        const v = p.slip.linvel();
        const speed = Math.hypot(v.x, v.y, v.z);
        if (!p.landed && t.y < 0.2) {
          p.landed = true;
          this.sfx('slap', _v.set(t.x, t.y, t.z));
        }
        if (t.x < BOUNDS.minX || t.x > BOUNDS.maxX || t.z < BOUNDS.minZ || t.z > BOUNDS.maxZ || t.y < -1) {
          p.slip.setTranslation({ x: THREE.MathUtils.clamp(t.x, BOUNDS.minX + 0.6, BOUNDS.maxX - 0.6), y: 0.3, z: THREE.MathUtils.clamp(t.z, BOUNDS.minZ + 0.6, BOUNDS.maxZ - 0.6) }, true);
          p.slip.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
        if (p.phase === 'out' && pos && speed < 2.5 && t.y < 1.2 && Math.hypot(t.x - pos.x, t.z - pos.z) < 1.35) {
          this.ctx.physics.world.removeRigidBody(p.slip);
          p.slip = null;
          p.holding = true;
          p.phase = 'return';
          this.toast(p.id, L('Nakuha!', 'Got it!'), 'small', 700);
          this.toAll({ k: 'sfx', name: 'pickup', pos: null, to: p.id });
        }
      }

      if (p.phase === 'return' && pos && pos.x > LINE_X + 0.3) {
        p.phase = 'safe';
        if (!p.knockedRound && !p.wentOut) {
          this.toast(p.id, L('Sayang! Walang tumba.', 'Too bad! The can stayed up.'), 'small', 1300);
        } else {
          p.retrieves++;
          const pts = this.canUp ? 5 : 10;
          p.score += pts;
          this.toast(p.id, pts > 5 ? L(`Bilis! +${pts}`, `Speedy! +${pts}`) : `Safe! +${pts}`, 'good', 1300);
        }
      }
    }
  }

  /** Nearest participant past the line who already grabbed their slipper. */
  private chaseTarget(): Part | null {
    const kp = this.taya.root.position;
    let best: Part | null = null;
    let bestD = Infinity;
    for (const p of this.parts.values()) {
      if (p.phase !== 'return') continue;
      const pos = this.posOf(p.id);
      if (!pos || pos.x >= LINE_X) continue;
      const d = Math.hypot(pos.x - kp.x, pos.z - kp.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private hostTaya(dt: number): void {
    const k = this.taya;
    const kp = k.root.position;
    const can = this.canBody;
    const play = this.hostPhase === 'play';

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
        if (this.canUp && play && this.chaseTarget()) {
          this.tayaState = 'chase';
          this.tayaReact = 0.25;
          return;
        }
        target = GUARD;
        speed = TAYA_WALK * 0.8;
        break;
      case 'chase': {
        const prey = play ? this.chaseTarget() : null;
        if (!prey) {
          this.tayaState = 'guard';
          return;
        }
        const pos = this.posOf(prey.id)!;
        target = _v.set(pos.x, 0, pos.z);
        speed = TAYA_CHASE;
        if (Math.hypot(pos.x - kp.x, pos.z - kp.z) < TAG_DIST) {
          prey.phase = 'tagged';
          prey.holding = false;
          prey.tagged++;
          this.toast(prey.id, L('Taya ka!', 'Tagged!'), 'bad', 1500);
          if (this.multiplayer) this.toast(null, L(`Na-taya si ${this.net!.nameOf(prey.id)}!`, `${this.net!.nameOf(prey.id)} got tagged!`), 'small', 1000);
          this.sfx('tag');
          k.mode = 'cheer';
          this.tayaReact = 0.8;
          return;
        }
        break;
      }
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
          this.settingT = 0.7;
        }
        break;
      }
      case 'setting':
        k.mode = 'crouch';
        k.face(HOME.x, HOME.z, dt);
        this.settingT -= dt;
        if (this.settingT <= 0) {
          this.resetCan();
          this.canUp = true;
          this.lastToucher = null;
          if (play && this.chaseTarget()) {
            this.toast(null, L('Nakatayo na ang lata! Takbo!', 'The can is back up! Run!'), 'bad', 1100);
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
      }
    }
    kp.x = THREE.MathUtils.clamp(Math.min(kp.x, LINE_X - 0.25), BOUNDS.minX, BOUNDS.maxX);
    kp.z = THREE.MathUtils.clamp(kp.z, BOUNDS.minZ, BOUNDS.maxZ);
    kp.y = 0;
  }

  private hostEnd(): void {
    this.hostPhase = 'done';
    this.sendSnap();
    const rows: EndRow[] = [...this.parts.values()].map((p) => ({
      id: p.id,
      score: p.score,
      won: p.score >= 20,
      lines: [
        L(`Tumba: ${p.knocks}/${ROUNDS}`, `Knockdowns: ${p.knocks}/${ROUNDS}`),
        L(`Nakabalik nang ligtas: ${p.retrieves}/${ROUNDS}`, `Safe returns: ${p.retrieves}/${ROUNDS}`),
        p.tagged ? L(`Na-taya: ${p.tagged}`, `Times tagged: ${p.tagged}`) : UNTOUCHED(),
        ...(p.tayaRounds ? [L(`Bilang taya: ${p.tagsMade} nataya, ${p.resets} itinayo`, `As taya: ${p.tagsMade} tagged, ${p.resets} can resets`)] : []),
      ],
    }));
    this.endWith(rows);
  }

  nextOpts(): Record<string, unknown> {
    return { taya: this.nextTaya ?? this.tayaId };
  }

  protected finishMine(mine: EndRow, won: boolean, ranking: string[]): void {
    this.running = false;
    this.ctx.hud.setObjective('');
    this.ctx.hud.setTimer(null);
    const knocks = mine.lines[0]?.match(/\d+/)?.[0] ?? '0';
    this.ctx.finish({
      gameName: this.name,
      score: mine.score,
      scoreLabel: L('puntos', 'points'),
      points: mine.score,
      won,
      lines: [...mine.lines, ...ranking],
      shareText: L(`Naka-${knocks} tumba at ${mine.score} puntos ako sa Tumbang Preso sa Hari ng Kanto!`, `I knocked the can down ${knocks} times and scored ${mine.score} in Tumbang Preso on Hari ng Kanto!`),
      // the host may play in the other language: accept both spellings
      feats: mine.lines.some((l) => l === 'Hindi ka na-taya!' || l === 'Never tagged!') ? ['untouched'] : [],
    });
  }
}

function newPart(id: string): Part {
  return { id, phase: 'throw', holding: true, slip: null, score: 0, knocks: 0, retrieves: 0, tagged: 0, knockedRound: false, wentOut: false, landed: false, tayaRounds: 0, tagsMade: 0, resets: 0 };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const UNTOUCHED = () => L('Hindi ka na-taya!', 'Never tagged!');
