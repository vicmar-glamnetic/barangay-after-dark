import * as THREE from 'three';
import { Kid } from '../world/npcs';
import { BaseGame } from './baseGame';
import type { HubLayout } from './types';

/*
 * PATINTERO
 *
 * The chalk grid on the covered court (drawn in world/textures.ts courtTexture):
 * 5 lines across the court and one long center line. One tagger guards each
 * cross line and can only slide along it; the "patotot" guards the center line
 * and slides along that. Run from the start side to the far end and back
 * without getting tagged and without stepping outside the grid.
 *
 * 3 lives, 90 seconds. Score: +5 per new line crossed, +20 for finishing,
 * +10 per life left, +1 per second left.
 */

/** World-space grid (court center is x=10, z=16; floor at y=0.1). */
export const GRID = { minX: 5, maxX: 15, minZ: 13.2, maxZ: 18.8, midZ: 16 };
const LINES_X = [5, 7.5, 10, 12.5, 15];
const START_X = 3.5;
const FAR_X = 16.5;
const FLOOR_Y = 0.1;
const LIVES = 3;
const TIME = 90;
const TAG_REACH = 0.7; // arms out
const LINE_HIT = 0.5; // how close to a line (in x) the player must be to get tagged there

type Phase = 'ready' | 'run' | 'tagged' | 'done';
type Leg = 'out' | 'back';

interface Tagger {
  kid: Kid;
  /** Index into LINES_X, or -1 for the center-line tagger. */
  line: number;
  /** Position along its line: z for cross lines, x for the center line. */
  pos: number;
  /** Lagged target (gives the player a chance to feint). */
  aim: number;
  seed: number;
}

export class Patintero extends BaseGame {
  readonly id = 'patintero';
  readonly name = 'Patintero';
  readonly implemented = true;
  readonly where = 'sa covered court';
  readonly layout: HubLayout = {
    spot: new THREE.Vector3(5.2, 0, 9.6),
    labelPos: new THREE.Vector3(8.5, 3.3, 13),
    accent: '#4cc9f0',
    kids: [
      { x: 6.5, z: 13.3, mode: 'idle' },
      { x: 9, z: 16, mode: 'wave' },
      { x: 11.5, z: 13.3, mode: 'idle' },
      { x: 13.2, z: 16.2, mode: 'cheer' },
    ],
  };

  private lines!: THREE.Group;
  private extras: Kid[] = [];
  private taggers: Tagger[] = [];

  private phase: Phase = 'done';
  private leg: Leg = 'out';
  private progress = 0; // lines crossed in this leg
  private best: Record<Leg, number> = { out: 0, back: 0 }; // for scoring each line once
  private lives = LIVES;
  private time = TIME;
  private score = 0;
  private readyT = 0;
  private taggedT = 0;
  private speedUp = 1;
  private lastP = new THREE.Vector3();
  private pVel = new THREE.Vector3();

  protected onAttach(): void {
    // Glowing chalk overlay so the grid reads clearly at night (only during play).
    this.lines = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.55, depthWrite: false, fog: false });
    const h = GRID.maxZ - GRID.minZ;
    for (const x of LINES_X) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.09, h).rotateX(-Math.PI / 2), mat);
      m.position.set(x, FLOOR_Y + 0.012, (GRID.minZ + GRID.maxZ) / 2);
      this.lines.add(m);
    }
    const w = GRID.maxX - GRID.minX;
    for (const z of [GRID.minZ, GRID.midZ, GRID.maxZ]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.09).rotateX(-Math.PI / 2), mat);
      m.position.set((GRID.minX + GRID.maxX) / 2, FLOOR_Y + 0.012, z);
      this.lines.add(m);
    }
    this.lines.visible = false;
    this.ctx.scene.add(this.lines);
  }

  start(): void {
    const { scene, blobs, hud, touch } = this.ctx;
    // 4 hub kids + 2 extra = 5 line taggers + 1 center tagger
    for (let i = 0; i < 2; i++) {
      const k = new Kid();
      scene.add(k.root);
      k.addShadow(blobs);
      this.extras.push(k);
    }
    const kids = [...this.group.kids, ...this.extras];
    this.taggers = kids.map((kid, i) => {
      const line = i < LINES_X.length ? i : -1;
      const pos = line >= 0 ? GRID.midZ + (i % 2 ? 1 : -1) : 10;
      return { kid, line, pos, aim: pos, seed: i * 1.7 };
    });
    this.lines.visible = true;
    this.lives = LIVES;
    this.time = TIME;
    this.score = 0;
    this.best = { out: 0, back: 0 };
    this.speedUp = 1;
    this.leg = 'out';
    touch.setActionLabel('Takbo');
    hud.setCrosshair(true);
    this.respawn();
    hud.toast('Patintero!', 'small', 1200);
  }

  stop(): void {
    for (const k of this.extras) k.dispose();
    this.extras = [];
    this.taggers = [];
    this.lines.visible = false;
    this.ctx.player.moveEnabled = true;
    this.ctx.hud.clearGameWidgets();
    this.phase = 'done';
  }

  /** Put the player at the start of the current leg and give a short "ready" beat. */
  private respawn(): void {
    const { player, hud } = this.ctx;
    const x = this.leg === 'out' ? START_X : FAR_X;
    player.teleport(x, FLOOR_Y, GRID.midZ + 1.4, this.leg === 'out' ? -Math.PI / 2 : Math.PI / 2, -0.12);
    player.moveEnabled = false;
    this.lastP.copy(player.position);
    this.progress = 0;
    this.phase = 'ready';
    this.readyT = 1.2;
    hud.setObjective(this.leg === 'out' ? 'Tumawid hanggang dulo! Iwasan ang mga taya.' : 'Balik na sa simula!');
    for (const t of this.taggers) {
      t.pos = t.line >= 0 ? GRID.midZ + Math.sin(t.seed) * 1.5 : 10;
      t.aim = t.pos;
    }
  }

  update(dt: number, t: number): void {
    const { player, hud } = this.ctx;
    if (this.phase === 'done') return;
    const p = player.position;
    this.pVel.subVectors(p, this.lastP).divideScalar(Math.max(dt, 1e-3));
    this.lastP.copy(p);

    this.updateTaggers(dt, t);
    this.updateHud();

    if (this.phase === 'ready') {
      this.readyT -= dt;
      if (this.readyT <= 0) {
        this.phase = 'run';
        player.moveEnabled = true;
        hud.toast('Takbo!', 'good', 700);
      }
      return;
    }
    if (this.phase === 'tagged') {
      this.taggedT -= dt;
      if (this.taggedT <= 0) {
        if (this.lives <= 0) this.end(false);
        else this.respawn();
      }
      return;
    }

    // --- running
    this.time -= dt;
    if (this.time <= 0) {
      this.time = 0;
      hud.toast('Ubos ang oras!', 'bad', 1400);
      this.end(false);
      return;
    }

    // stepping outside the grid while inside its length = out
    const inLength = p.x > GRID.minX - 0.2 && p.x < GRID.maxX + 0.2;
    if (inLength && (p.z < GRID.minZ - 0.3 || p.z > GRID.maxZ + 0.3)) {
      this.loseLife('Labas ka!');
      return;
    }

    // line crossings
    if (this.progress < LINES_X.length) {
      const lx = this.leg === 'out' ? LINES_X[this.progress] : LINES_X[LINES_X.length - 1 - this.progress];
      const crossed = this.leg === 'out' ? p.x > lx + 0.35 : p.x < lx - 0.35;
      if (crossed) {
        this.progress++;
        if (this.progress > this.best[this.leg]) {
          this.best[this.leg] = this.progress;
          this.score += 5;
          this.ctx.audio.play('tick');
        }
      }
    }

    // reached the end of a leg
    if (this.progress >= LINES_X.length) {
      if (this.leg === 'out' && p.x > FAR_X - 0.8) {
        this.leg = 'back';
        this.progress = 0;
        this.speedUp = 1.18;
        hud.toast('Balik na!', 'good', 1100);
        hud.setObjective('Balik na sa simula! Mas mabilis na sila.');
        this.ctx.audio.play('cheer');
      } else if (this.leg === 'back' && p.x < START_X + 0.8) {
        this.end(true);
        return;
      }
    }

    // tags: a tagger can only tag you while you are ON its line (street rules)
    for (const tg of this.taggers) {
      const hit =
        tg.line >= 0
          ? Math.abs(p.x - LINES_X[tg.line]) < LINE_HIT && Math.abs(p.z - tg.pos) < TAG_REACH + 0.2
          : Math.abs(p.z - GRID.midZ) < LINE_HIT && Math.abs(p.x - tg.pos) < TAG_REACH + 0.2;
      if (hit) {
        this.loseLife('Taya ka!');
        return;
      }
    }
  }

  private updateTaggers(dt: number, t: number): void {
    const p = this.ctx.player.position;
    const running = this.phase === 'run';
    for (const tg of this.taggers) {
      const k = tg.kid;
      let target: number;
      let speed: number;
      if (tg.line >= 0) {
        // Cross-line tagger: follows the player's z when the player is near its line.
        const lx = LINES_X[tg.line];
        const near = running && Math.abs(p.x - lx) < 4.5;
        const predicted = p.z + this.pVel.z * 0.25;
        target = near ? predicted : GRID.midZ + Math.sin(t * 0.8 + tg.seed) * 1.8;
        tg.aim += (target - tg.aim) * Math.min(1, dt * 2.6); // reaction lag
        speed = (near ? 2.8 : 1.6) * this.speedUp;
        tg.pos = moveToward(tg.pos, tg.aim, speed * dt);
        tg.pos = THREE.MathUtils.clamp(tg.pos, GRID.minZ + 0.2, GRID.maxZ - 0.2);
        k.root.position.set(lx, FLOOR_Y, tg.pos);
        k.face(this.leg === 'out' ? lx - 5 : lx + 5, tg.pos);
        if (running && Math.abs(p.x - lx) < LINE_HIT + 0.6) k.face(p.x, p.z, dt);
      } else {
        // Center-line tagger (patotot): follows the player's x when they come near the center line.
        const near = running && Math.abs(p.z - GRID.midZ) < 1.6;
        target = near ? p.x + this.pVel.x * 0.2 : 10 + Math.sin(t * 0.6) * 3.5;
        tg.aim += (target - tg.aim) * Math.min(1, dt * 1.8);
        speed = (near ? 2.2 : 1.4) * this.speedUp;
        tg.pos = moveToward(tg.pos, tg.aim, speed * dt);
        tg.pos = THREE.MathUtils.clamp(tg.pos, GRID.minX, GRID.maxX);
        k.root.position.set(tg.pos, FLOOR_Y, GRID.midZ);
        k.face(p.x, p.z, dt);
      }
      const moved = Math.abs(tg.aim - tg.pos) > 0.05;
      k.mode = 'guard';
      k.speed = moved ? speed : 0;
    }
  }

  private loseLife(msg: string): void {
    const { hud, audio, player } = this.ctx;
    this.lives--;
    this.phase = 'tagged';
    this.taggedT = 1.4;
    player.moveEnabled = false;
    audio.play('tag');
    hud.toast(this.lives > 0 ? `${msg} -1 buhay` : msg, 'bad', 1300);
    this.updateHud();
  }

  private updateHud(): void {
    const hearts = '♥'.repeat(Math.max(0, this.lives)) + '♡'.repeat(Math.max(0, LIVES - this.lives));
    this.ctx.hud.setStat(`${hearts}   ${this.leg === 'out' ? 'Papunta' : 'Pabalik'} ${this.progress}/${LINES_X.length}   Puntos: ${this.score}`);
    this.ctx.hud.setTimer(String(Math.ceil(this.time)));
  }

  private end(won: boolean): void {
    this.phase = 'done';
    const { player, hud } = this.ctx;
    player.moveEnabled = false;
    if (won) {
      this.score += 20 + this.lives * 10 + Math.floor(this.time);
      hud.toast('Nakabalik ka!', 'good', 1400);
      this.group.kids.forEach((k) => (k.mode = 'cheer'));
    }
    hud.setObjective('');
    const lines = this.best.out + this.best.back;
    this.ctx.finish({
      gameName: this.name,
      score: this.score,
      scoreLabel: 'puntos',
      points: this.score,
      won,
      lines: [
        `Linyang natawid: ${lines}/${LINES_X.length * 2}`,
        `Buhay na natira: ${Math.max(0, this.lives)}/${LIVES}`,
        won ? `Oras na natira: ${Math.floor(this.time)}s` : 'Kaya mo yan, ulitin mo!',
      ],
      shareText: won
        ? `Nakatawid ako pabalik sa Patintero, ${this.score} puntos sa Barangay After Dark!`
        : `Naka-${lines} linya ako sa Patintero sa Barangay After Dark!`,
    });
  }
}

function moveToward(a: number, b: number, max: number): number {
  const d = b - a;
  return Math.abs(d) <= max ? b : a + Math.sign(d) * max;
}
