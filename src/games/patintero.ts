import * as THREE from 'three';
import type { GameData } from '../net/session';
import { Kid } from '../world/npcs';
import { BaseGame, type EndRow } from './baseGame';
import type { HubLayout } from './types';

/*
 * PATINTERO, solo or multiplayer.
 *
 * The chalk grid on the covered court: 5 lines across and one long center
 * line. One tagger guards each cross line and can only slide along it; the
 * "patotot" guards the center line. Run to the far end and back without
 * getting tagged and without stepping outside the grid.
 *
 * Street rule: a tagger can only tag you while you are ON its line.
 * 3 lives each, 90 seconds shared. Score: +5 per new line, +20 for finishing,
 * +10 per life left, +1 per second left when you finish.
 *
 * Network: the host runs the taggers (they chase the nearest runner) and
 * judges every runner from their reported position. Clients just run.
 */

export const GRID = { minX: 5, maxX: 15, minZ: 13.2, maxZ: 18.8, midZ: 16 };
const LINES_X = [5, 7.5, 10, 12.5, 15];
const START_X = 3.5;
const FAR_X = 16.5;
const FLOOR_Y = 0.1;
const LIVES = 3;
const TIME = 90;
const TAG_REACH = 0.7;
const LINE_HIT = 0.5;
const SLOT_Z = [17.4, 14.6, 18.4, 13.6, 16.9, 15.1];
const SNAP_HZ = 15;

type RState = 'ready' | 'run' | 'tagged' | 'won' | 'out';
const RSTATES: RState[] = ['ready', 'run', 'tagged', 'won', 'out'];
type Leg = 'out' | 'back';

interface Runner {
  id: string;
  state: RState;
  timer: number;
  leg: Leg;
  progress: number;
  best: Record<Leg, number>;
  lives: number;
  score: number;
  last: THREE.Vector3;
  vel: THREE.Vector3;
  timeLeft: number;
}

interface Tagger {
  kid: Kid;
  line: number; // index into LINES_X, -1 = center line
  pos: number;
  aim: number;
  seed: number;
  target: number; // client-side smoothing target
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
  private running = false;

  // client view
  private me = { state: 'ready' as RState, leg: 'out' as Leg, progress: 0, lives: LIVES, score: 0 };
  private time = TIME;
  private board: [string, number][] = [];

  // host
  private runners = new Map<string, Runner>();
  private hostTime = TIME;
  private speedUp = 1;
  private snapT = 0;
  private hostDone = false;

  protected onAttach(): void {
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

  // ================================================================== lifecycle

  start(): void {
    const { scene, blobs, hud, touch } = this.ctx;
    for (let i = 0; i < 2; i++) {
      const k = new Kid();
      scene.add(k.root);
      k.addShadow(blobs);
      this.extras.push(k);
    }
    const kids = [...this.group.kids, ...this.extras];
    this.taggers = kids.map((kid, i) => {
      const line = i < LINES_X.length ? i : -1;
      const pos = line >= 0 ? GRID.midZ + Math.sin(i * 1.7) * 1.5 : 10;
      return { kid, line, pos, aim: pos, seed: i * 1.7, target: pos };
    });
    this.placeTaggers();
    this.lines.visible = true;
    this.running = true;
    this.me = { state: 'ready', leg: 'out', progress: 0, lives: LIVES, score: 0 };
    this.time = TIME;
    this.board = [];
    touch.setActionLabel('Takbo');
    hud.setCrosshair(true);
    hud.toast('Patintero!', 'small', 1200);
    this.spawnSelf('out');

    if (this.isHost) {
      this.runners.clear();
      for (const id of this.roster()) this.runners.set(id, newRunner(id, this.posOf(id)));
      this.hostTime = TIME;
      this.speedUp = 1;
      this.hostDone = false;
    }
  }

  stop(): void {
    for (const k of this.extras) k.dispose();
    this.extras = [];
    this.taggers = [];
    this.lines.visible = false;
    this.running = false;
    this.runners.clear();
    this.ctx.player.moveEnabled = true;
    this.ctx.hud.clearGameWidgets();
  }

  private spawnSelf(leg: Leg): void {
    const slot = this.slotOf(this.selfId);
    this.ctx.player.teleport(leg === 'out' ? START_X : FAR_X, FLOOR_Y, SLOT_Z[slot % SLOT_Z.length], leg === 'out' ? -Math.PI / 2 : Math.PI / 2, -0.12);
    this.ctx.player.moveEnabled = false;
  }

  // ================================================================== per frame

  update(dt: number, t: number): void {
    if (!this.running) return;
    if (this.isHost) this.hostUpdate(dt, t);
    else {
      // smooth taggers toward the host's positions
      const k = 1 - Math.exp(-dt * 12);
      for (const tg of this.taggers) {
        const before = tg.pos;
        tg.pos += (tg.target - tg.pos) * k;
        tg.kid.speed = Math.abs(tg.pos - before) / Math.max(dt, 1e-3);
      }
      this.placeTaggers();
    }
    this.updateHud();
  }

  private placeTaggers(): void {
    const p = this.ctx.player.position;
    for (const tg of this.taggers) {
      const k = tg.kid;
      if (tg.line >= 0) {
        const lx = LINES_X[tg.line];
        k.root.position.set(lx, FLOOR_Y, tg.pos);
        if (Math.abs(p.x - lx) < 3) k.face(p.x, p.z);
        else k.face(lx - 5, tg.pos);
      } else {
        k.root.position.set(tg.pos, FLOOR_Y, GRID.midZ);
        k.face(p.x, p.z);
      }
      k.mode = 'guard';
    }
  }

  private updateHud(): void {
    const { hud } = this.ctx;
    const m = this.me;
    const hearts = '♥'.repeat(Math.max(0, m.lives)) + '♡'.repeat(Math.max(0, LIVES - m.lives));
    let stat = `${hearts}   ${m.leg === 'out' ? 'Papunta' : 'Pabalik'} ${m.progress}/${LINES_X.length}   Puntos: ${m.score}`;
    if (this.multiplayer && this.board.length > 1) stat += '   ' + this.board.slice(0, 4).map(([id, s]) => `${this.nameOf(id)} ${s}`).join(' · ');
    hud.setStat(stat);
    hud.setTimer(String(Math.max(0, Math.ceil(this.time))));
    const obj: Record<RState, string> = {
      ready: 'Handa...',
      run: m.leg === 'out' ? 'Tumawid hanggang dulo! Iwasan ang mga taya.' : 'Balik na sa simula!',
      tagged: 'Taya ka!',
      won: this.multiplayer ? 'Nakabalik ka! Hintayin ang iba.' : 'Nakabalik ka!',
      out: this.multiplayer ? 'Ubos na ang buhay mo. Panoorin ang iba.' : 'Ubos na ang buhay mo.',
    };
    hud.setObjective(obj[m.state]);
  }

  // ================================================================== client messages

  protected onClientMsg(d: GameData): void {
    switch (d.k) {
      case 's': {
        this.time = Number(d.tm);
        const tg = d.tg as number[];
        if (!this.isHost) tg.forEach((v, i) => this.taggers[i] && (this.taggers[i].target = v));
        const rows = d.r as Record<string, [number, number, number, number, number]>;
        const mine = rows[this.selfId];
        if (mine) {
          const [lives, leg, progress, score, st] = mine;
          this.me = { lives, leg: leg ? 'back' : 'out', progress, score, state: RSTATES[st] };
        }
        this.board = Object.entries(rows).map(([id, v]) => [id, v[3]] as [string, number]).sort((a, b) => b[1] - a[1]);
        break;
      }
      case 'spawn':
        if (d.to === this.selfId) this.spawnSelf(d.leg as Leg);
        break;
      case 'go':
        if (d.to === this.selfId) {
          this.ctx.player.moveEnabled = true;
          this.ctx.hud.toast('Takbo!', 'good', 700);
        }
        break;
      case 'freeze':
        if (d.to === this.selfId) this.ctx.player.moveEnabled = false;
        break;
      case 'leg':
        if (d.to === this.selfId) {
          this.ctx.hud.toast('Balik na!', 'good', 1100);
          this.ctx.audio.play('cheer');
        }
        break;
    }
  }

  // ================================================================== host

  private hostUpdate(dt: number, t: number): void {
    const ids = new Set(this.roster());
    for (const id of [...this.runners.keys()]) if (!ids.has(id)) this.runners.delete(id);

    if (!this.hostDone) {
      this.hostTime -= dt;
      for (const r of this.runners.values()) this.hostRunner(r, dt);
      const allDone = [...this.runners.values()].every((r) => r.state === 'won' || r.state === 'out');
      if (allDone || this.hostTime <= 0) {
        if (!allDone) this.toast(null, 'Ubos ang oras!', 'bad', 1400);
        this.hostEnd();
      }
    }
    this.hostTaggers(dt, t);
    this.placeTaggers();

    this.snapT -= dt;
    if (this.snapT <= 0) {
      this.snapT = 1 / SNAP_HZ;
      const r: Record<string, number[]> = {};
      for (const x of this.runners.values()) r[x.id] = [x.lives, x.leg === 'back' ? 1 : 0, x.progress, x.score, RSTATES.indexOf(x.state)];
      this.toAll({ k: 's', tm: Math.max(0, Math.round(this.hostTime * 10) / 10), tg: this.taggers.map((g) => Math.round(g.pos * 100) / 100), r });
    }
  }

  private hostRunner(r: Runner, dt: number): void {
    const p = this.posOf(r.id);
    if (!p) return;
    r.vel.subVectors(p, r.last).divideScalar(Math.max(dt, 1e-3));
    r.last.copy(p);

    switch (r.state) {
      case 'ready':
        r.timer -= dt;
        if (r.timer <= 0) {
          r.state = 'run';
          this.toAll({ k: 'go', to: r.id });
        }
        return;
      case 'tagged':
        r.timer -= dt;
        if (r.timer <= 0) {
          if (r.lives <= 0) {
            r.state = 'out';
            return;
          }
          r.state = 'ready';
          r.timer = 1.2;
          r.progress = 0;
          this.toAll({ k: 'spawn', to: r.id, leg: r.leg });
        }
        return;
      case 'won':
      case 'out':
        return;
    }

    // running: out of the grid?
    const inLength = p.x > GRID.minX - 0.2 && p.x < GRID.maxX + 0.2;
    if (inLength && (p.z < GRID.minZ - 0.3 || p.z > GRID.maxZ + 0.3)) {
      this.hostLoseLife(r, 'Labas ka!');
      return;
    }
    // crossings
    if (r.progress < LINES_X.length) {
      const lx = r.leg === 'out' ? LINES_X[r.progress] : LINES_X[LINES_X.length - 1 - r.progress];
      if (r.leg === 'out' ? p.x > lx + 0.35 : p.x < lx - 0.35) {
        r.progress++;
        if (r.progress > r.best[r.leg]) {
          r.best[r.leg] = r.progress;
          r.score += 5;
          this.toAll({ k: 'sfx', name: 'tick', pos: null, to: r.id });
        }
      }
    }
    // end of a leg
    if (r.progress >= LINES_X.length) {
      if (r.leg === 'out' && p.x > FAR_X - 0.8) {
        r.leg = 'back';
        r.progress = 0;
        this.toAll({ k: 'leg', to: r.id });
        if (this.multiplayer) this.toast(null, `${this.net!.nameOf(r.id)}: pabalik na!`, 'small', 900);
      } else if (r.leg === 'back' && p.x < START_X + 0.8) {
        r.state = 'won';
        r.timeLeft = Math.max(0, this.hostTime);
        r.score += 20 + r.lives * 10 + Math.floor(r.timeLeft);
        this.toast(r.id, 'Nakabalik ka!', 'good', 1400);
        if (this.multiplayer) this.toast(null, `Nakabalik si ${this.net!.nameOf(r.id)}!`, 'small', 1000);
        this.sfx('cheer');
        this.toAll({ k: 'freeze', to: r.id });
        return;
      }
    }
    // tags (only while on a tagger's line)
    for (const tg of this.taggers) {
      const hit =
        tg.line >= 0
          ? Math.abs(p.x - LINES_X[tg.line]) < LINE_HIT && Math.abs(p.z - tg.pos) < TAG_REACH + 0.2
          : Math.abs(p.z - GRID.midZ) < LINE_HIT && Math.abs(p.x - tg.pos) < TAG_REACH + 0.2;
      if (hit) {
        this.hostLoseLife(r, 'Taya ka!');
        return;
      }
    }
  }

  private hostLoseLife(r: Runner, msg: string): void {
    r.lives--;
    r.state = 'tagged';
    r.timer = 1.4;
    this.toAll({ k: 'freeze', to: r.id });
    this.toast(r.id, r.lives > 0 ? `${msg} -1 buhay` : msg, 'bad', 1300);
    this.toAll({ k: 'sfx', name: 'tag', pos: null, to: r.id });
    if (this.multiplayer) this.toast(null, `${this.net!.nameOf(r.id)}: ${msg}`, 'small', 900);
  }

  /** Taggers chase the nearest running runner close to their line. */
  private hostTaggers(dt: number, t: number): void {
    const active = [...this.runners.values()].filter((r) => r.state === 'run');
    this.speedUp = [...this.runners.values()].some((r) => r.leg === 'back') ? 1.18 : 1;
    for (const tg of this.taggers) {
      let target: number;
      let speed: number;
      if (tg.line >= 0) {
        const lx = LINES_X[tg.line];
        let prey: Runner | null = null;
        let best = 4.5;
        for (const r of active) {
          const d = Math.abs(r.last.x - lx);
          if (d < best) {
            best = d;
            prey = r;
          }
        }
        target = prey ? prey.last.z + prey.vel.z * 0.25 : GRID.midZ + Math.sin(t * 0.8 + tg.seed) * 1.8;
        tg.aim += (target - tg.aim) * Math.min(1, dt * 2.6);
        speed = (prey ? 2.8 : 1.6) * this.speedUp;
        tg.pos = THREE.MathUtils.clamp(moveToward(tg.pos, tg.aim, speed * dt), GRID.minZ + 0.2, GRID.maxZ - 0.2);
      } else {
        let prey: Runner | null = null;
        let best = 1.6;
        for (const r of active) {
          const d = Math.abs(r.last.z - GRID.midZ);
          if (d < best) {
            best = d;
            prey = r;
          }
        }
        target = prey ? prey.last.x + prey.vel.x * 0.2 : 10 + Math.sin(t * 0.6) * 3.5;
        tg.aim += (target - tg.aim) * Math.min(1, dt * 1.8);
        speed = (prey ? 2.2 : 1.4) * this.speedUp;
        tg.pos = THREE.MathUtils.clamp(moveToward(tg.pos, tg.aim, speed * dt), GRID.minX, GRID.maxX);
      }
      tg.kid.speed = Math.abs(tg.aim - tg.pos) > 0.05 ? speed : 0;
    }
  }

  private hostEnd(): void {
    this.hostDone = true;
    const rows: EndRow[] = [...this.runners.values()].map((r) => {
      const lines = r.best.out + r.best.back;
      return {
        id: r.id,
        score: r.score,
        won: r.state === 'won',
        lines: [
          `Linyang natawid: ${lines}/${LINES_X.length * 2}`,
          `Buhay na natira: ${Math.max(0, r.lives)}/${LIVES}`,
          r.state === 'won' ? `Oras na natira: ${Math.floor(r.timeLeft)}s` : 'Kaya mo yan, ulitin mo!',
        ],
      };
    });
    this.endWith(rows);
  }

  protected finishMine(mine: EndRow, won: boolean, ranking: string[]): void {
    this.running = false;
    this.ctx.player.moveEnabled = false;
    this.ctx.hud.setObjective('');
    const crossed = mine.lines[0]?.match(/\d+/)?.[0] ?? '0';
    this.ctx.finish({
      gameName: this.name,
      score: mine.score,
      scoreLabel: 'puntos',
      points: mine.score,
      won,
      lines: [...mine.lines, ...ranking],
      shareText: mine.won
        ? `Nakatawid ako pabalik sa Patintero, ${mine.score} puntos sa Barangay After Dark!`
        : `Naka-${crossed} linya ako sa Patintero sa Barangay After Dark!`,
    });
  }
}

function newRunner(id: string, pos: THREE.Vector3 | null): Runner {
  const last = pos ? pos.clone() : new THREE.Vector3(START_X, FLOOR_Y, GRID.midZ);
  return { id, state: 'ready', timer: 1.4, leg: 'out', progress: 0, best: { out: 0, back: 0 }, lives: LIVES, score: 0, last, vel: new THREE.Vector3(), timeLeft: 0 };
}

function moveToward(a: number, b: number, max: number): number {
  const d = b - a;
  return Math.abs(d) <= max ? b : a + Math.sign(d) * max;
}
