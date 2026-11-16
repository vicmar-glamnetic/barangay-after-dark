import * as THREE from 'three';
import { BaseGame, type EndRow } from './baseGame';
import type { HubLayout } from './types';

/*
 * PIKO (hopscotch), solo or score battle.
 *
 * The chalk grid: 1 2 3 [4|5] 6 [7|8] then LANGIT (the half circle).
 * Each turn:
 *   1. Toss your pamato into the target square (hold to set power, aim with
 *      your view). Landing on a line or in the wrong square costs a life.
 *   2. Hop the course on one foot, skipping the pamato's square. Every hop is
 *      timed with a balance meter: press when the marker is in the green.
 *      Pressing outside the green, or wobbling too long, and you fall.
 *   3. At langit you turn around. On the way back you bend down to pick the
 *      pamato up from the square before it (same meter), then hop out.
 * Clear squares 1 to 8 to win. 3 lives. +10 per square, +10 per life left.
 */

const X0 = 17.4; // grid start (front edge of square 1)
const ZC = -16.3; // grid center line
const CELL = 0.8;
const LIVES = 3;
const START = new THREE.Vector3(X0 - 0.9, 0, ZC);
const FACE_FWD = -Math.PI / 2; // looking along +X
const PITCH = -0.62;

interface Cell {
  n: number; // 1..8, 9 = langit
  row: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Build the grid cells in world space. */
function buildCells(): Cell[] {
  const cells: Cell[] = [];
  const single = (n: number, row: number) => cells.push({ n, row, x0: X0 + row * CELL, x1: X0 + (row + 1) * CELL, z0: ZC - 0.4, z1: ZC + 0.4 });
  const double = (l: number, r: number, row: number) => {
    cells.push({ n: l, row, x0: X0 + row * CELL, x1: X0 + (row + 1) * CELL, z0: ZC - 0.82, z1: ZC - 0.02 });
    cells.push({ n: r, row, x0: X0 + row * CELL, x1: X0 + (row + 1) * CELL, z0: ZC + 0.02, z1: ZC + 0.82 });
  };
  single(1, 0);
  single(2, 1);
  single(3, 2);
  double(4, 5, 3);
  single(6, 4);
  double(7, 8, 5);
  cells.push({ n: 9, row: 6, x0: X0 + 6 * CELL, x1: X0 + 6 * CELL + 1.0, z0: ZC - 0.6, z1: ZC + 0.6 });
  return cells;
}
const CELLS = buildCells();
const rowCells = (row: number) => CELLS.filter((c) => c.row === row);
const center = (c: Cell) => new THREE.Vector3((c.x0 + c.x1) / 2, 0, (c.z0 + c.z1) / 2);

type Phase = 'aim' | 'toss' | 'stand' | 'hop' | 'turn' | 'fall' | 'done';

interface Stop {
  pos: THREE.Vector3;
  /** Pick the pamato up at this stop before hopping on. */
  pickup: boolean;
  /** Turn around after landing here (langit). */
  turn: boolean;
}

const _dummy = new THREE.Object3D();

export class Piko extends BaseGame {
  readonly id = 'piko';
  readonly name = 'Piko';
  readonly implemented = true;
  readonly where = 'sa bakuran sa likod ng pink na bahay';
  readonly layout: HubLayout = {
    spot: new THREE.Vector3(16.3, 0, -16.3),
    labelPos: new THREE.Vector3(20.3, 2.7, -16.3),
    accent: '#f15bb5',
    kids: [
      { x: 19.0, z: -15.0, mode: 'cheer', faceX: 20, faceZ: -16.3 },
      { x: 23.9, z: -17.6, mode: 'idle', faceX: 20, faceZ: -16.3 },
      { x: 24.1, z: -15.3, mode: 'wave', faceX: 20, faceZ: -16.3 },
    ],
  };

  private pamato!: THREE.Mesh;
  private arc!: THREE.InstancedMesh;
  private marker!: THREE.Mesh;

  private phase: Phase = 'done';
  private target = 1;
  private lives = LIVES;
  private score = 0;
  private power = 0;
  private powerDir = 1;
  private aiming = false;
  private tossFrom = new THREE.Vector3();
  private tossTo = new THREE.Vector3();
  private tossT = 0;
  private landedCell: Cell | null = null;
  private stops: Stop[] = [];
  private stopI = 0;
  private hopFrom = new THREE.Vector3();
  private hopT = 0;
  private yaw = FACE_FWD;
  private turnFrom = 0;
  private turnT = 0;
  private sway = 0;
  private swayPhase = 0;
  private standT = 0;
  private hops = 0;
  private fallT = 0;

  protected onAttach(): void {
    const { scene } = this.ctx;
    // the whole chalk grid is one canvas texture on one plane
    const W = 1024, H = 290;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const sx = W / 6.0, sz = H / 1.7; // grid area: x 0..6.0 m from X0-0.1, z -0.85..0.85
    const px = (x: number) => (x - (X0 - 0.1)) * sx;
    const pz = (z: number) => (z - (ZC - 0.85)) * sz;
    g.strokeStyle = 'rgba(255,250,225,0.95)';
    g.fillStyle = 'rgba(255,250,225,0.95)';
    g.lineWidth = 5;
    g.font = `800 ${Math.round(sz * 0.36)}px "Baloo 2", system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const cell of CELLS) {
      if (cell.n === 9) {
        g.beginPath();
        g.moveTo(px(cell.x0), pz(cell.z0));
        g.lineTo(px(cell.x0), pz(cell.z1));
        g.stroke();
        g.beginPath();
        g.ellipse(px(cell.x0), pz(ZC), (cell.x1 - cell.x0) * sx, (cell.z1 - cell.z0) * 0.5 * sz, 0, -Math.PI / 2, Math.PI / 2);
        g.stroke();
        g.fillText('LANGIT', px(cell.x0 + 0.45), pz(ZC));
        continue;
      }
      g.strokeRect(px(cell.x0), pz(cell.z0), (cell.x1 - cell.x0) * sx, (cell.z1 - cell.z0) * sz);
      g.fillText(String(cell.n), px((cell.x0 + cell.x1) / 2), pz((cell.z0 + cell.z1) / 2));
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(6.0, 1.7).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: 0xb9b2a0 }),
    );
    plane.position.set(X0 - 0.1 + 3.0, 0.02, ZC);
    scene.add(plane);

    this.pamato = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.025, 10), new THREE.MeshLambertMaterial({ color: 0xc0392b }));
    this.pamato.visible = false;
    scene.add(this.pamato);
    this.ctx.blobs.add(this.pamato, 0.18);
    this.arc = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.03, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, depthWrite: false, fog: false }),
      24,
    );
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.12, 18).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, depthWrite: false, fog: false }),
    );
    this.marker.visible = false;
    scene.add(this.arc, this.marker);
  }

  // ================================================================== lifecycle

  start(): void {
    const { hud, touch, player } = this.ctx;
    this.battleReset();
    this.target = 1;
    this.lives = LIVES;
    this.score = 0;
    player.moveEnabled = false;
    touch.setActionLabel('Hop');
    touch.setJumpVisible(false);
    hud.setCrosshair(true);
    this.beginTurn();
    hud.toast('Piko!', 'small', 1000);
  }

  stop(): void {
    const { player, hud, touch } = this.ctx;
    this.phase = 'done';
    this.pamato.visible = false;
    this.arc.visible = this.marker.visible = false;
    player.moveEnabled = true;
    player.lookEnabled = true;
    touch.setActionLabel('Bato');
    touch.setJumpVisible(true);
    hud.clearGameWidgets();
  }

  private beginTurn(): void {
    const { player, hud, isTouch } = this.ctx;
    this.phase = 'aim';
    this.aiming = false;
    this.pamato.visible = false;
    this.yaw = FACE_FWD;
    player.lookEnabled = true;
    player.teleport(START.x, 0, START.z, FACE_FWD, -0.45);
    hud.setObjective(
      `Ihagis ang pamato sa ${this.target}! ` + (isTouch() ? 'Pindutin nang matagal ang Hop, bitawan para ihagis.' : 'Pindutin nang matagal ang click, bitawan para ihagis.'),
    );
    hud.setMeter(null);
  }

  // ================================================================== frame

  update(dt: number): void {
    const { input, hud, player } = this.ctx;
    if (this.phase === 'done') {
      this.battleCheck();
      return;
    }
    const press = input.pressed('action') || input.pressed('jump') || input.pressed('interact') || input.tapPressed;

    switch (this.phase) {
      case 'aim': {
        if (input.down('action')) {
          if (!this.aiming) {
            this.aiming = true;
            this.power = 0;
            this.powerDir = 1;
          }
          this.power += (this.powerDir * dt) / 1.1;
          if (this.power >= 1) {
            this.power = 1;
            this.powerDir = -1;
          } else if (this.power <= 0) {
            this.power = 0;
            this.powerDir = 1;
          }
          hud.setPower(this.power);
          this.previewToss();
        } else if (this.aiming) {
          this.aiming = false;
          hud.setPower(null);
          this.arc.visible = this.marker.visible = false;
          this.tossTo.copy(this.landingPoint());
          this.tossFrom.set(player.position.x, 1.0, player.position.z);
          this.tossT = 0;
          this.pamato.visible = true;
          this.ctx.audio.play('throw', { vol: 0.6 });
          this.phase = 'toss';
          player.lookEnabled = false;
        }
        break;
      }
      case 'toss': {
        this.tossT = Math.min(1, this.tossT + dt / 0.6);
        const k = this.tossT;
        this.pamato.position.lerpVectors(this.tossFrom, this.tossTo, k);
        this.pamato.position.y = THREE.MathUtils.lerp(this.tossFrom.y, 0.015, k) + Math.sin(k * Math.PI) * 0.9;
        this.pamato.rotation.x += dt * 9;
        if (k >= 1) {
          this.pamato.rotation.set(0, Math.random() * 3, 0);
          this.ctx.audio.play('slap', { pos: this.tossTo, vol: 0.7 });
          this.judgeToss();
        }
        break;
      }
      case 'stand': {
        const stop = this.stops[this.stopI];
        // balance meter: faster as you go and at higher squares
        const speed = 2.3 + this.hops * 0.1 + this.target * 0.18;
        this.swayPhase += dt * speed;
        this.sway = 0.5 + 0.5 * Math.sin(this.swayPhase);
        const half = Math.max(0.1, 0.17 - this.target * 0.008);
        const pickup = stop?.pickup && this.pamato.visible;
        hud.setMeter(this.sway, 0.5 - half, 0.5 + half, pickup ? 'Pulutin ang pamato!' : this.stopI === -1 ? 'Hop!' : 'Balanse... Hop!');
        this.standT += dt;
        if (this.standT > 3.2) {
          this.fail('Natumba ka!');
          break;
        }
        if (press) {
          if (Math.abs(this.sway - 0.5) > half) {
            this.fail(pickup ? 'Nahulog ka habang pumupulot!' : 'Natapakan mo ang linya!');
            break;
          }
          if (pickup) {
            this.pamato.visible = false;
            this.ctx.audio.play('pickup');
            hud.toast('Napulot!', 'small', 600);
            this.standT = 0;
            this.swayPhase = Math.random() * 6;
            break;
          }
          this.hopTo(this.stopI + 1);
        }
        break;
      }
      case 'hop': {
        this.hopT = Math.min(1, this.hopT + dt / 0.32);
        const to = this.stops[this.stopI].pos;
        const p = new THREE.Vector3().lerpVectors(this.hopFrom, to, this.hopT);
        p.y = Math.sin(this.hopT * Math.PI) * 0.32;
        player.teleport(p.x, p.y, p.z, this.yaw, PITCH);
        if (this.hopT >= 1) this.landed();
        break;
      }
      case 'turn': {
        this.turnT = Math.min(1, this.turnT + dt / 0.5);
        this.yaw = this.turnFrom + Math.PI * (this.turnT * this.turnT * (3 - 2 * this.turnT));
        const p = this.stops[this.stopI].pos;
        player.teleport(p.x, 0, p.z, this.yaw, PITCH);
        if (this.turnT >= 1) this.standAt();
        break;
      }
      case 'fall':
        this.fallT -= dt;
        if (this.fallT <= 0) {
          if (this.lives <= 0) this.endRun(false);
          else this.beginTurn();
        }
        break;
    }
    hud.setStat(`Square ${this.target}/8   ${'♥'.repeat(this.lives)}${'♡'.repeat(LIVES - this.lives)}   Puntos: ${this.score}   ${this.battleText()}`);
    this.battleCheck();
  }

  // ================================================================== toss

  private landingPoint(): THREE.Vector3 {
    const cam = this.ctx.camera;
    const f = new THREE.Vector3();
    cam.getWorldDirection(f);
    f.y = 0;
    f.normalize();
    const dist = 0.6 + this.power * 6.0;
    return new THREE.Vector3(this.ctx.player.position.x + f.x * dist, 0.015, this.ctx.player.position.z + f.z * dist);
  }

  private previewToss(): void {
    const from = new THREE.Vector3(this.ctx.player.position.x, 1.0, this.ctx.player.position.z);
    const to = this.landingPoint();
    let n = 0;
    for (let i = 1; i < 24; i++) {
      const k = i / 24;
      _dummy.position.lerpVectors(from, to, k);
      _dummy.position.y = THREE.MathUtils.lerp(1.0, 0.015, k) + Math.sin(k * Math.PI) * 0.9;
      _dummy.updateMatrix();
      this.arc.setMatrixAt(n++, _dummy.matrix);
    }
    this.arc.count = n;
    this.arc.instanceMatrix.needsUpdate = true;
    this.arc.visible = true;
    this.marker.position.set(to.x, 0.03, to.z);
    this.marker.visible = true;
  }

  private judgeToss(): void {
    const p = this.tossTo;
    const cell = CELLS.find((c) => p.x >= c.x0 && p.x <= c.x1 && p.z >= c.z0 && p.z <= c.z1) ?? null;
    if (!cell) return this.fail('Labas sa kahon ang pamato!');
    const edge = Math.min(p.x - cell.x0, cell.x1 - p.x, p.z - cell.z0, cell.z1 - p.z);
    if (edge < 0.06) return this.fail('Sa linya ang pamato!');
    if (cell.n !== this.target) return this.fail(`Sa ${cell.n === 9 ? 'langit' : cell.n} napunta, hindi sa ${this.target}!`);
    this.landedCell = cell;
    this.ctx.hud.toast('Pasok!', 'good', 700);
    this.buildStops();
    this.ctx.hud.setObjective(`Mag-hop! Laktawan ang ${this.target}. Pindutin kapag nasa berde.`);
    this.stopI = -1;
    this.yaw = FACE_FWD;
    this.ctx.player.teleport(START.x, 0, START.z, FACE_FWD, PITCH);
    this.standAt();
  }

  /** The landing spots for this turn: forward to langit, back, then out. */
  private buildStops(): void {
    const n = this.target;
    const nRow = CELLS.find((c) => c.n === n)!.row;
    const stopFor = (row: number): THREE.Vector3 | null => {
      const cs = rowCells(row);
      if (cs.length === 1) return cs[0].n === n ? null : center(cs[0]);
      const free = cs.filter((c) => c.n !== n);
      if (free.length === 1) return center(free[0]); // one foot in the free square
      return new THREE.Vector3((cs[0].x0 + cs[0].x1) / 2, 0, ZC); // straddle both squares
    };
    const stops: Stop[] = [];
    for (let row = 0; row <= 6; row++) {
      const s = stopFor(row);
      if (s) stops.push({ pos: s, pickup: false, turn: row === 6 });
    }
    for (let row = 5; row >= 0; row--) {
      const s = stopFor(row);
      if (s) stops.push({ pos: s, pickup: row === nRow + 1, turn: false });
    }
    // n's row is the last one before langit? then you pick up from langit itself
    if (nRow === 5) stops.find((s) => s.turn)!.pickup = true;
    stops.push({ pos: START.clone(), pickup: false, turn: false });
    this.stops = stops;
    this.hops = 0;
  }

  // ================================================================== hopping

  private standAt(): void {
    this.phase = 'stand';
    this.standT = 0;
    this.swayPhase = Math.random() * 6;
  }

  private hopTo(i: number): void {
    const p = this.ctx.player.position;
    this.hopFrom.set(p.x, 0, p.z);
    this.stopI = i;
    this.hopT = 0;
    this.phase = 'hop';
    this.ctx.hud.setMeter(null);
    this.ctx.audio.play('step', { vol: 1.2 });
  }

  private landed(): void {
    const { audio } = this.ctx;
    audio.play('step', { vol: 1.5 });
    this.hops++;
    // pick-up rule: the pamato must be off the grid before you pass its square
    const stop = this.stops[this.stopI];
    if (this.stopI === this.stops.length - 1) {
      if (this.pamato.visible) return this.fail('Nakalimutan mo ang pamato!');
      this.squareCleared();
      return;
    }
    if (stop.turn) {
      this.phase = 'turn';
      this.turnT = 0;
      this.turnFrom = this.yaw;
      this.ctx.hud.toast('Langit! Balik na.', 'small', 800);
      return;
    }
    this.standAt();
  }

  private squareCleared(): void {
    const { hud, audio } = this.ctx;
    this.score += 10;
    audio.play('cheer');
    this.group.kids.forEach((k) => (k.mode = 'cheer'));
    if (this.target >= 8) {
      this.score += this.lives * 10;
      hud.toast('Panalo sa Piko!', 'good', 1400);
      this.endRun(true);
      return;
    }
    hud.toast(`Square ${this.target}, tapos!`, 'good', 1000);
    this.target++;
    this.battleReport(this.score, false);
    this.phase = 'fall';
    this.fallT = 0.9;
  }

  private fail(msg: string): void {
    const { hud, audio, player } = this.ctx;
    this.lives--;
    hud.toast(this.lives > 0 ? `${msg} -1 buhay` : msg, 'bad', 1300);
    hud.setMeter(null);
    audio.play('thud');
    this.pamato.visible = this.pamato.visible && this.phase === 'toss';
    this.arc.visible = this.marker.visible = false;
    player.teleport(player.position.x, 0, player.position.z, this.yaw, 0.1);
    this.phase = 'fall';
    this.fallT = 1.4;
    this.battleReport(this.score, false);
  }

  private endRun(won: boolean): void {
    this.phase = 'done';
    this.ctx.hud.setMeter(null);
    this.ctx.hud.setObjective(this.multiplayer ? 'Tapos ka na. Hinihintay ang iba...' : '');
    const cleared = won ? 8 : this.target - 1;
    this.battleReport(this.score, true, won, [`Squares: ${cleared}/8`, `Buhay na natira: ${Math.max(0, this.lives)}/${LIVES}`]);
  }

  protected finishMine(mine: EndRow, won: boolean, ranking: string[]): void {
    this.ctx.hud.setObjective('');
    const sq = mine.lines[0]?.match(/\d+/)?.[0] ?? '0';
    this.ctx.finish({
      gameName: this.name,
      score: mine.score,
      scoreLabel: 'puntos',
      points: mine.score,
      won,
      lines: [...mine.lines, ...ranking],
      shareText: `Naka-${sq} square ako sa Piko, ${mine.score} puntos sa Hari ng Kanto!`,
    });
  }
}
