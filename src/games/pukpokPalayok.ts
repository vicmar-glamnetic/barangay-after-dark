import * as THREE from 'three';
import { BaseGame, type EndRow } from './baseGame';
import type { HubLayout } from './types';

/*
 * PUKPOK PALAYOK (hit the clay pot), solo or score battle.
 *
 * You are blindfolded, spun around, and let loose a few meters from a clay
 * pot hanging from a bamboo frame. Walk (no running) toward it using the
 * kids' shouts ("Kaliwa! Kanan! Diretso!") and the candies rattling inside
 * the pot (positional audio: wear headphones), then swing your stick.
 * 3 swings and 25 seconds per pot, 3 pots.
 * Break it: 30 + 2 per second left + 5 per swing left. Candy everywhere.
 */

const POT = new THREE.Vector3(-2.5, 1.5, 15.5);
const FRAME_HALF = 1.9;
const ROUNDS = 3;
const TIME = 25;
const SWINGS = 3;
const REACH = 1.35;
const CANDY_COUNT = 48;

type Phase = 'spin' | 'play' | 'swinging' | 'reveal' | 'done';

export class PukpokPalayok extends BaseGame {
  readonly id = 'pukpokPalayok';
  readonly name = 'Pukpok Palayok';
  readonly implemented = true;
  readonly where = 'sa pagitan ng plaza at court';
  readonly layout: HubLayout = {
    spot: new THREE.Vector3(-2.5, 0, 12.4),
    labelPos: new THREE.Vector3(-2.5, 3.5, 15.5),
    accent: '#fee440',
    kids: [
      { x: -4.9, z: 13.4, mode: 'cheer', faceX: POT.x, faceZ: POT.z },
      { x: -0.2, z: 13.6, mode: 'wave', faceX: POT.x, faceZ: POT.z },
      { x: -3.0, z: 18.2, mode: 'idle', faceX: POT.x, faceZ: POT.z },
    ],
  };

  private pot!: THREE.Group;
  private candy!: THREE.InstancedMesh;
  private candyPos: THREE.Vector3[] = [];
  private candyVel: THREE.Vector3[] = [];
  private candyLive = false;

  private phase: Phase = 'done';
  private round = 0;
  private score = 0;
  private broken = 0;
  private time = TIME;
  private swings = SWINGS;
  private timer = 0;
  private spinFrom = 0;
  private spinTo = 0;
  private hintT = 0;
  private lastHint = '';
  private rattleT = 0;

  protected onAttach(): void {
    const { scene, physics } = this.ctx;
    // bamboo frame: two posts + crossbar (posts have colliders)
    const bamboo = new THREE.MeshLambertMaterial({ color: 0xc8a856 });
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.8, 8), bamboo);
      post.position.set(POT.x + sx * FRAME_HALF, 1.4, POT.z);
      scene.add(post);
      physics.addCylinder(POT.x + sx * FRAME_HALF, 1.4, POT.z, 1.4, 0.08);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, FRAME_HALF * 2 + 0.3, 8).rotateZ(Math.PI / 2), bamboo);
    bar.position.set(POT.x, 2.75, POT.z);
    scene.add(bar);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 2.75 - POT.y - 0.18, 4), new THREE.MeshLambertMaterial({ color: 0x6b5a3a }));
    rope.position.set(POT.x, (2.75 + POT.y + 0.18) / 2, POT.z);
    scene.add(rope);

    // clay pot (lathe) with a painted band
    const pts: THREE.Vector2[] = [];
    const prof: [number, number][] = [[0.02, -0.17], [0.12, -0.15], [0.19, -0.06], [0.2, 0.02], [0.16, 0.11], [0.1, 0.15], [0.11, 0.19], [0.09, 0.2]];
    for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
    this.pot = new THREE.Group();
    const clay = new THREE.Mesh(new THREE.LatheGeometry(pts, 14), new THREE.MeshLambertMaterial({ color: 0xb5562d, side: THREE.DoubleSide }));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.202, 0.2, 0.05, 14, 1, true), new THREE.MeshLambertMaterial({ color: 0xf2c230, emissive: 0x3a2a00 }));
    this.pot.add(clay, band);
    this.pot.position.copy(POT);
    scene.add(this.pot);

    // candy burst: one instanced draw call
    const colors = [0xff4d6d, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xf15bb5, 0xffffff];
    this.candy = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.03, 0.03), new THREE.MeshLambertMaterial(), CANDY_COUNT);
    for (let i = 0; i < CANDY_COUNT; i++) {
      this.candy.setColorAt(i, new THREE.Color(colors[i % colors.length]));
      this.candyPos.push(new THREE.Vector3());
      this.candyVel.push(new THREE.Vector3());
    }
    this.candy.frustumCulled = false;
    this.candy.visible = false;
    scene.add(this.candy);
  }

  // ================================================================== lifecycle

  start(): void {
    const { hud, touch, hand } = this.ctx;
    this.battleReset();
    this.round = 0;
    this.score = 0;
    this.broken = 0;
    touch.setActionLabel('Hampas');
    touch.setJumpVisible(false);
    hud.setCrosshair(false);
    hand.setHolding(false);
    hand.showStick(true);
    this.nextRound();
  }

  stop(): void {
    this.ctx.audio.hush();
    const { player, hud, touch, hand, overlays } = this.ctx;
    this.phase = 'done';
    overlays.blind(false);
    player.canRun = true;
    player.moveEnabled = true;
    player.lookEnabled = true;
    hand.showStick(false);
    touch.setActionLabel('Bato');
    touch.setJumpVisible(true);
    this.pot.visible = true;
    this.candy.visible = false;
    this.candyLive = false;
    hud.clearGameWidgets();
    hud.setCrosshair(true);
  }

  private nextRound(): void {
    const { player, overlays, hud, audio } = this.ctx;
    this.round++;
    this.time = TIME;
    this.swings = SWINGS;
    this.pot.visible = true;
    this.pot.rotation.set(0, 0, 0);
    // drop the player 3.6 to 5 m away, in a direction that stays out of the court and the frame
    const rnd = this.rng(this.round * 13);
    let x = POT.x, z = POT.z - 4;
    for (let i = 0; i < 20; i++) {
      const a = rnd() * Math.PI * 2;
      const d = 3.6 + rnd() * 1.4;
      x = POT.x + Math.cos(a) * d;
      z = POT.z + Math.sin(a) * d;
      if (x < 1.2 && x > -7.5 && Math.abs(z - POT.z) > 0.6) break;
    }
    this.spinFrom = rnd() * Math.PI * 2;
    this.spinTo = this.spinFrom + Math.PI * 2 * 3 + rnd() * Math.PI * 2;
    player.teleport(x, 0, z, this.spinFrom, 0);
    player.moveEnabled = false;
    player.lookEnabled = false;
    player.canRun = false;
    overlays.blind(true);
    overlays.shout(`Palayok ${this.round}/${ROUNDS}: Ikot!`, 1800);
    audio.play('cheer');
    audio.say('Ikot! Ikot! Ikot!', { rate: 1.05 });
    hud.setObjective('Nakapiring ka! Sundan ang sigaw ng mga bata at ang kalansing ng kendi.');
    this.phase = 'spin';
    this.timer = 0;
  }

  // ================================================================== frame

  update(dt: number, t: number): void {
    const { input, player, hud, overlays, audio } = this.ctx;
    this.updateCandy(dt);
    if (this.phase === 'done') {
      this.battleCheck();
      return;
    }
    // the pot sways a little on its rope
    if (this.pot.visible) {
      this.pot.rotation.z = Math.sin(t * 1.3) * 0.06;
      this.pot.rotation.x = Math.sin(t * 0.9) * 0.04;
    }

    switch (this.phase) {
      case 'spin': {
        this.timer = Math.min(1, this.timer + dt / 2.0);
        const k = 1 - Math.pow(1 - this.timer, 2);
        player.teleport(player.position.x, 0, player.position.z, this.spinFrom + (this.spinTo - this.spinFrom) * k, 0);
        if (this.timer >= 1) {
          this.phase = 'play';
          player.moveEnabled = true;
          player.lookEnabled = true;
          this.hintT = 0.4;
          this.rattleT = 0.2;
          overlays.shout('Takbo! Hanapin!', 900);
          audio.say('Takbo! Hanapin!');
        }
        break;
      }
      case 'play': {
        this.time -= dt;
        // positional candy rattle from the pot
        this.rattleT -= dt;
        if (this.rattleT <= 0) {
          audio.play('rattle', { pos: POT, vol: 1.3 });
          this.rattleT = 1.0 + Math.random() * 0.4;
        }
        // the kids shout directions
        this.hintT -= dt;
        if (this.hintT <= 0) {
          const h = this.hint();
          overlays.shout(h, 950);
          audio.play('tick', { vol: 0.4 });
          // the kids yell it out loud; repeat lines get a little more urgent
          audio.say(h, { rate: h === this.lastHint ? 1.3 : 1.15 });
          this.lastHint = h;
          this.hintT = 1.4;
        }
        if (input.pressed('action') || input.tapPressed) this.swing();
        else if (this.time <= 0) this.roundOver(false, 'Ubos ang oras!');
        break;
      }
      case 'swinging':
        this.timer -= dt;
        if (this.timer <= 0) this.resolveSwing();
        break;
      case 'reveal':
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.round >= ROUNDS) this.endRun();
          else this.nextRound();
        }
        break;
    }
    hud.setTimer(this.phase === 'play' || this.phase === 'swinging' ? String(Math.max(0, Math.ceil(this.time))) : null);
    hud.setStat(`Palayok ${this.round}/${ROUNDS}   Hampas: ${this.swings}   Puntos: ${this.score}   ${this.battleText()}`);
    this.battleCheck();
  }

  /** What the kids yell, based on where the pot is relative to your view. */
  private hint(): string {
    const { player } = this.ctx;
    const dx = POT.x - player.position.x, dz = POT.z - player.position.z;
    const dist = Math.hypot(dx, dz);
    const want = Math.atan2(-dx, -dz); // yaw that faces the pot
    let a = want - player.yaw;
    a = Math.atan2(Math.sin(a), Math.cos(a)); // + = pot is to the left
    if (dist < REACH * 0.9 && Math.abs(a) < 0.5) return 'Ngayon na! Hampas!';
    if (Math.abs(a) > 2.4) return 'Talikod ka! Ikot!';
    if (a > 0.35) return dist < 2 ? 'Konting kaliwa!' : 'Kaliwa!';
    if (a < -0.35) return dist < 2 ? 'Konting kanan!' : 'Kanan!';
    if (dist > 6) return 'Malayo ka na! Diretso!';
    return dist < 2.2 ? 'Malapit na! Diretso!' : 'Diretso!';
  }

  private swing(): void {
    this.ctx.hand.swing();
    this.ctx.audio.play('swing');
    this.swings--;
    this.phase = 'swinging';
    this.timer = 0.22; // the stick lands a beat after the press
  }

  private resolveSwing(): void {
    const { player } = this.ctx;
    const dx = POT.x - player.position.x, dz = POT.z - player.position.z;
    const dist = Math.hypot(dx, dz);
    let a = Math.atan2(-dx, -dz) - player.yaw;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    if (dist <= REACH && Math.abs(a) <= 0.65) {
      const pts = 30 + Math.max(0, Math.floor(this.time)) * 2 + this.swings * 5;
      this.score += pts;
      this.broken++;
      this.breakPot();
      this.roundOver(true, `Basag! +${pts}`);
    } else if (this.swings <= 0) this.roundOver(false, 'Mintis! Ubos na ang hampas.');
    else {
      this.ctx.overlays.shout('Mintis!', 700);
      this.ctx.audio.say('Mintis! Ulit!');
      this.phase = 'play';
    }
  }

  private roundOver(hit: boolean, msg: string): void {
    const { overlays, hud, audio, player } = this.ctx;
    overlays.blind(false);
    hud.toast(msg, hit ? 'good' : 'bad', 1500);
    audio.say(hit ? 'Basag! Ang galing!' : msg.startsWith('Ubos ang oras') ? 'Ubos na ang oras!' : 'Sayang! Mintis!', { pitch: 1.6 });
    if (!hit) {
      audio.play('lose');
      // show where it was
      const want = Math.atan2(-(POT.x - player.position.x), -(POT.z - player.position.z));
      player.teleport(player.position.x, 0, player.position.z, want, 0.05);
    }
    this.group.kids.forEach((k) => (k.mode = hit ? 'cheer' : 'wave'));
    player.moveEnabled = false;
    player.lookEnabled = false;
    this.phase = 'reveal';
    this.timer = 2.2;
    this.battleReport(this.score, false);
  }

  private breakPot(): void {
    const { audio } = this.ctx;
    audio.play('smash', { pos: POT });
    audio.play('cheer');
    this.pot.visible = false;
    for (let i = 0; i < CANDY_COUNT; i++) {
      this.candyPos[i].copy(POT);
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 2.5;
      this.candyVel[i].set(Math.cos(a) * s, 1.5 + Math.random() * 3, Math.sin(a) * s);
    }
    this.candy.visible = true;
    this.candyLive = true;
  }

  /** Simple CPU ballistics for the candy shower; they bounce once and rest. */
  private updateCandy(dt: number): void {
    if (!this.candyLive) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    let moving = false;
    for (let i = 0; i < CANDY_COUNT; i++) {
      const p = this.candyPos[i], v = this.candyVel[i];
      if (p.y > 0.016 || v.y > 0) {
        v.y -= 9.8 * dt;
        p.addScaledVector(v, dt);
        if (p.y < 0.015) {
          p.y = 0.015;
          v.y = Math.abs(v.y) > 1 ? -v.y * 0.3 : 0;
          v.x *= 0.5;
          v.z *= 0.5;
        }
        moving = true;
      }
      q.setFromAxisAngle(_axis.set(Math.sin(i), 1, Math.cos(i)).normalize(), p.x * 3 + p.z * 2);
      m.compose(p, q, one);
      this.candy.setMatrixAt(i, m);
    }
    this.candy.instanceMatrix.needsUpdate = true;
    if (!moving) this.candyLive = false;
  }

  private endRun(): void {
    this.phase = 'done';
    this.ctx.hud.setObjective(this.multiplayer ? 'Tapos ka na. Hinihintay ang iba...' : '');
    this.battleReport(this.score, true, this.broken >= 2, [`Nabasag: ${this.broken}/${ROUNDS}`]);
  }

  protected finishMine(mine: EndRow, won: boolean, ranking: string[]): void {
    const n = mine.lines[0]?.match(/\d+/)?.[0] ?? '0';
    this.ctx.finish({
      gameName: this.name,
      score: mine.score,
      scoreLabel: 'puntos',
      points: mine.score,
      won,
      lines: [...mine.lines, ...ranking],
      shareText: `Nakabasag ako ng ${n} palayok nang nakapiring, ${mine.score} puntos sa Hari ng Kanto!`,
    });
  }
}

const _axis = new THREE.Vector3();
