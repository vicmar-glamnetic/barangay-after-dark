import * as THREE from 'three';
import { L } from '../core/i18n';
import { el, onTap } from '../ui/dom';
import { BaseGame, type EndRow } from './baseGame';
import type { HubLayout } from './types';

/*
 * SUNGKA, the Filipino shell board game, against Lola Pacing (AI).
 * Solo, or a score battle where everyone plays their own Lola.
 *
 * Board: 7 small pits each + a big "bahay" (house) each, 7 shells per pit.
 * Indices: 0-6 your pits (left to right), 7 your house, 8-14 Lola's pits,
 * 15 Lola's house. Shells travel 0 -> 6 -> 7 -> 8 -> 14 -> (skip 15) -> 0.
 *
 * Rules (traditional relay sowing):
 *  - pick a non-empty pit on your side and drop one shell into each next pit
 *    (your house included, the opponent's house skipped)
 *  - last shell in your house: you go again
 *  - last shell in a non-empty pit: scoop them all up and keep sowing
 *  - last shell in an empty pit on your side: capture it plus the pit
 *    across into your house
 *  - last shell in an empty pit on their side: your turn ends
 * When the player to move has no shells, the other side keeps what is left.
 * Score = shells in your house (98 in all). More than Lola wins.
 */

const PITS = 7;
const START = 7;
const MINE = 7; // my house index
const THEIRS = 15; // Lola's house index
const STEP_MS = 75; // sowing speed
const MAX_STEPS = 600; // guard against endless relay loops

const SPOT = new THREE.Vector3(-2.2, 0, -3.75);
const TABLE = new THREE.Vector3(-2.2, 0, -4.8);

type Who = 'me' | 'lola';

/** Pure board state (shared by the real game and the AI's look-ahead). */
class Board {
  p: number[];
  constructor(p?: number[]) {
    this.p = p ? p.slice() : [...Array(PITS).fill(START), 0, ...Array(PITS).fill(START), 0];
  }
  clone(): Board {
    return new Board(this.p);
  }
  side(who: Who): number[] {
    return who === 'me' ? [0, 1, 2, 3, 4, 5, 6] : [8, 9, 10, 11, 12, 13, 14];
  }
  house(who: Who): number {
    return who === 'me' ? MINE : THEIRS;
  }
  legal(who: Who): number[] {
    return this.side(who).filter((i) => this.p[i] > 0);
  }
  /**
   * Play a move one shell at a time. Yields the pit that just got a shell.
   * Returns 'again' (extra turn) or 'done'.
   */
  *sow(who: Who, from: number): Generator<number, 'again' | 'done'> {
    const skip = who === 'me' ? THEIRS : MINE;
    let hand = this.p[from];
    this.p[from] = 0;
    let i = from;
    let steps = 0;
    for (;;) {
      while (hand > 0) {
        i = (i + 1) % 16;
        if (i === skip) continue;
        this.p[i]++;
        hand--;
        steps++;
        yield i;
      }
      if (i === this.house(who)) return 'again';
      if (this.p[i] > 1 && steps < MAX_STEPS) {
        // relay: scoop the pit and keep going
        hand = this.p[i];
        this.p[i] = 0;
        continue;
      }
      // landed in an empty pit
      if (this.side(who).includes(i)) {
        const across = 14 - i;
        if (this.p[across] > 0) {
          this.p[this.house(who)] += this.p[across] + this.p[i];
          this.p[across] = 0;
          this.p[i] = 0;
          yield this.house(who);
        }
      }
      return 'done';
    }
  }
  /** Run a move to the end (AI look-ahead). */
  playOut(who: Who, from: number): 'again' | 'done' {
    const g = this.sow(who, from);
    for (;;) {
      const r = g.next();
      if (r.done) return r.value;
    }
  }
  /** Sweep the leftovers when someone cannot move. */
  finish(): void {
    for (const who of ['me', 'lola'] as Who[]) {
      for (const i of this.side(who)) {
        this.p[this.house(who)] += this.p[i];
        this.p[i] = 0;
      }
    }
  }
}

export class Sungka extends BaseGame {
  readonly id = 'sungka';
  readonly name = 'Sungka';
  readonly implemented = true;
  get where() { return L('sa waiting shed, kasama si Lola Pacing', 'at the waiting shed with Lola Pacing'); }
  get blurb() { return L('Laro ng sigay sa kahoy na bangka', 'A wooden boat board, 98 shells, and a sharp Lola'); }
  get howTo() {
    return [
      L('Pumili ng butas sa iyong hanay (ibaba). Isa-isang ihuhulog ang sigay pakanan, kasama ang bahay mo.', 'Pick a pit on your row (bottom). Its shells are dropped one by one to the right, into your house too.'),
      L('Kapag sa bahay mo bumagsak ang huli: tira ulit! Kapag sa may lamang butas: dampot at tuloy.', 'Last shell in your house: go again! Last shell in a pit with shells: scoop them up and keep going.'),
      L('Kapag sa walang lamang butas mo bumagsak: kunin ang sigay sa tapat na butas ni Lola.', 'Last shell in an empty pit on your side: capture everything in the pit across from it.'),
      L('Mas maraming sigay sa bahay = panalo.', 'Most shells in your house wins.'),
    ];
  }
  readonly layout: HubLayout = {
    spot: SPOT.clone(),
    labelPos: new THREE.Vector3(-2.2, 3.3, -5.2),
    accent: '#c9a227',
    kids: [
      { x: -1.15, z: -5.45, faceX: -2.2, faceZ: -4.8, mode: 'idle' }, // Lola Pacing
      { x: -3.4, z: -4.3, mode: 'cheer', faceX: -2.2, faceZ: -4.8 },
    ],
  };

  private board = new Board();
  private turn: Who = 'me';
  private anim: Generator<number, 'again' | 'done'> | null = null;
  private animWho: Who = 'me';
  private animT = 0;
  private lastPit = -1;
  private thinkT = 0;
  private over = false;
  private captures = 0;
  private extraTurns = 0;

  // DOM
  private panel = el('div.sungka.interactive.hidden');
  private status = el('div.sg-status');
  private pitEls: HTMLButtonElement[] = [];
  private keyFn = (e: KeyboardEvent) => {
    const n = Number(e.key);
    if (n >= 1 && n <= PITS) this.pick(n - 1);
  };

  protected onAttach(): void {
    this.buildProp();
    // board panel: Lola's row on top (14 -> 8), mine below (0 -> 6), houses at the ends
    const mk = (i: number) => {
      const b = el('button.pit', { attrs: { 'aria-label': `pit ${i}` } }) as HTMLButtonElement;
      b.append(el('b'), el('i'));
      if (i < MINE) onTap(b, () => this.pick(i));
      this.pitEls[i] = b;
      return b;
    };
    for (let i = 0; i < 16; i++) mk(i);
    this.pitEls[MINE].classList.add('house', 'mine');
    this.pitEls[THEIRS].classList.add('house');
    const top = el('div.row.top', {}, ...[14, 13, 12, 11, 10, 9, 8].map((i) => this.pitEls[i]));
    const bottom = el('div.row', {}, ...[0, 1, 2, 3, 4, 5, 6].map((i) => this.pitEls[i]));
    const wood = el('div.sg-wood', {}, this.pitEls[THEIRS], el('div.rows', {}, top, bottom), this.pitEls[MINE]);
    this.panel.append(this.status, wood, el('div.sg-names', {}, el('span', { text: 'Lola Pacing' }), el('span.me', { text: '' })));
    this.panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.getElementById('ui')!.append(this.panel);
  }

  /** The wooden sungka board on a low table in front of the waiting shed. */
  private buildProp(): void {
    const g = new THREE.Group();
    g.position.copy(TABLE);
    const wood = new THREE.MeshLambertMaterial({ color: 0x8a5a36 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x4e3320 });
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.7), dark);
    table.position.y = 0.42;
    g.add(table);
    for (const [x, z] of [[-0.68, -0.3], [0.68, -0.3], [-0.68, 0.3], [0.68, 0.3]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.06), dark);
      leg.position.set(x, 0.21, z);
      g.add(leg);
    }
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.09, 0.42), wood);
    body.position.y = 0.5;
    g.add(body);
    const hole = new THREE.CircleGeometry(0.055, 12).rotateX(-Math.PI / 2);
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x2b1a0e });
    const shell = new THREE.SphereGeometry(0.014, 5, 4);
    const shellMat = new THREE.MeshLambertMaterial({ color: 0xf2e8d5 });
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < PITS; c++) {
        const m = new THREE.Mesh(hole, holeMat);
        m.position.set(-0.45 + c * 0.15, 0.546, (r ? 0.09 : -0.09));
        g.add(m);
        for (let k = 0; k < 4; k++) {
          const s = new THREE.Mesh(shell, shellMat);
          s.position.set(m.position.x + Math.cos(k * 1.7) * 0.025, 0.555, m.position.z + Math.sin(k * 1.7) * 0.025);
          g.add(s);
        }
      }
    for (const x of [-0.58, 0.58]) {
      const h = new THREE.Mesh(new THREE.CircleGeometry(0.075, 14).rotateX(-Math.PI / 2), holeMat);
      h.position.set(x, 0.546, 0);
      g.add(h);
    }
    this.ctx.scene.add(g);
    this.ctx.physics.addBox(TABLE.x, 0.27, TABLE.z, 0.75, 0.27, 0.35);
  }

  // ================================================================== lifecycle

  start(): void {
    const { player, hud, touch } = this.ctx;
    this.battleReset();
    this.board = new Board();
    this.over = false;
    this.anim = null;
    this.lastPit = -1;
    this.captures = 0;
    this.extraTurns = 0;
    // a coin toss decides who starts (seeded, so a score battle is fair)
    this.turn = this.rng(5)() < 0.5 ? 'me' : 'lola';
    this.thinkT = 1.2;
    player.teleport(SPOT.x, 0, SPOT.z + 0.15, 0, -0.62);
    player.moveEnabled = false;
    player.lookEnabled = false;
    hud.setCrosshair(false);
    touch.setActionLabel(L('Sungka', 'Sungka'));
    this.ctx.freePointer(true);
    this.panel.classList.remove('hidden');
    (this.panel.querySelector('.me') as HTMLElement).textContent = L('Ikaw', 'You');
    window.addEventListener('keydown', this.keyFn);
    hud.setObjective(L('Pumili ng butas sa ibabang hanay. (Pindutin din ang 1 hanggang 7)', 'Pick a pit on the bottom row. (Keys 1 to 7 work too)'));
    hud.toast(this.turn === 'me' ? L('Ikaw ang mauuna!', 'You go first!') : L('Si Lola ang mauuna.', 'Lola goes first.'), 'small', 1400);
    this.render();
  }

  stop(): void {
    const { player, hud, touch } = this.ctx;
    this.over = true;
    this.anim = null;
    this.panel.classList.add('hidden');
    window.removeEventListener('keydown', this.keyFn);
    player.moveEnabled = true;
    player.lookEnabled = true;
    hud.setCrosshair(true);
    touch.setActionLabel(L('Bato', 'Throw'));
    this.ctx.freePointer(false);
    hud.clearGameWidgets();
  }

  // ================================================================== play

  private pick(i: number): void {
    if (this.over || this.anim || this.turn !== 'me' || this.board.p[i] <= 0) return;
    this.ctx.audio.play('ui');
    this.startSow('me', i);
  }

  private startSow(who: Who, from: number): void {
    this.anim = this.board.sow(who, from);
    this.animWho = who;
    this.animT = 0;
    this.lastPit = from;
    this.render();
  }

  update(dt: number): void {
    if (this.over) {
      this.battleCheck();
      return;
    }
    const { hud } = this.ctx;
    if (this.anim) {
      this.animT += dt * 1000;
      while (this.anim && this.animT >= STEP_MS) {
        this.animT -= STEP_MS;
        const before = this.board.p[this.animWho === 'me' ? MINE : THEIRS];
        const r = this.anim.next();
        if (!r.done) {
          this.lastPit = r.value;
          const isHouse = r.value === MINE || r.value === THEIRS;
          const after = this.board.p[this.animWho === 'me' ? MINE : THEIRS];
          if (isHouse && after - before > 1) {
            // a capture lands in the house
            this.ctx.audio.play('cheer', { vol: 0.7 });
            if (this.animWho === 'me') {
              this.captures++;
              hud.toast(L(`Huli! +${after - before}`, `Captured! +${after - before}`), 'good', 900);
            } else hud.toast(L(`Nakahuli si Lola! +${after - before}`, `Lola captured ${after - before}!`), 'bad', 900);
          } else this.ctx.audio.play('marble', { vol: 0.45 });
        } else {
          this.anim = null;
          this.endMove(r.value);
        }
        this.render();
      }
    } else if (this.turn === 'lola') {
      this.thinkT -= dt;
      if (this.thinkT <= 0) this.startSow('lola', this.lolaMove());
    }
    hud.setStat(L(
      `Bahay mo: ${this.board.p[MINE]}   Lola: ${this.board.p[THEIRS]}   ${this.battleText()}`,
      `Your house: ${this.board.p[MINE]}   Lola: ${this.board.p[THEIRS]}   ${this.battleText()}`,
    ));
    this.battleCheck();
  }

  private endMove(r: 'again' | 'done'): void {
    const who = this.animWho;
    if (r === 'again') {
      if (who === 'me') {
        this.extraTurns++;
        this.ctx.hud.toast(L('Sa bahay! Tira ulit.', 'In your house! Go again.'), 'good', 900);
      } else this.ctx.hud.toast(L('Tira ulit si Lola.', 'Lola goes again.'), 'small', 900);
    } else this.turn = who === 'me' ? 'lola' : 'me';
    this.thinkT = 0.9 + Math.random() * 0.6;
    // whoever must move now but has nothing: the round is over
    if (!this.board.legal(this.turn).length) {
      this.board.finish();
      this.endGame();
      return;
    }
    this.battleReport(this.board.p[MINE], false);
  }

  /** Lola: greedy with one move of look-ahead, plus a little human error. */
  private lolaMove(): number {
    const moves = this.board.legal('lola');
    let best = moves[0];
    let bestV = -Infinity;
    for (const m of moves) {
      const b = this.board.clone();
      const r = b.playOut('lola', m);
      const v = b.p[THEIRS] - b.p[MINE] + (r === 'again' ? 4 : 0) + Math.random() * 1.5;
      if (v > bestV) {
        bestV = v;
        best = m;
      }
    }
    return Math.random() < 0.18 ? moves[Math.floor(Math.random() * moves.length)] : best;
  }

  private endGame(): void {
    this.over = true;
    const mine = this.board.p[MINE], lola = this.board.p[THEIRS];
    const won = mine > lola;
    this.ctx.hud.toast(won ? L('Talo mo si Lola!', 'You beat Lola!') : mine === lola ? L('Tabla!', "It's a tie!") : L('Panalo si Lola.', 'Lola wins this one.'), won ? 'good' : 'bad', 1600);
    this.ctx.hud.setObjective(this.multiplayer ? L('Tapos ka na. Hinihintay ang iba...', "You're done. Waiting for the others...") : '');
    this.battleReport(mine, true, won, [
      L(`Bahay mo: ${mine}  ·  Lola: ${lola}`, `Your house: ${mine}  ·  Lola: ${lola}`),
      L(`Huli: ${this.captures}  ·  Tira ulit: ${this.extraTurns}`, `Captures: ${this.captures}  ·  Extra turns: ${this.extraTurns}`),
    ]);
    this.render();
  }

  // ================================================================== draw

  private render(): void {
    const p = this.board.p;
    const myTurn = this.turn === 'me' && !this.anim && !this.over;
    for (let i = 0; i < 16; i++) {
      const b = this.pitEls[i];
      (b.firstChild as HTMLElement).textContent = String(p[i]);
      // a few shell dots so it looks like a board, not a spreadsheet
      const dots = Math.min(p[i], i === MINE || i === THEIRS ? 18 : 9);
      (b.lastChild as HTMLElement).textContent = '•'.repeat(dots);
      b.classList.toggle('live', myTurn && i < MINE && p[i] > 0);
      b.classList.toggle('hit', i === this.lastPit && !!this.anim);
      b.disabled = !(myTurn && i < MINE && p[i] > 0);
    }
    this.status.textContent = this.over
      ? L('Tapos ang laro', 'Game over')
      : this.anim
        ? this.animWho === 'me' ? L('Naghuhulog...', 'Sowing...') : L('Si Lola ang tumitira...', 'Lola is sowing...')
        : this.turn === 'me' ? L('Ikaw na! Pumili ng butas.', 'Your turn! Pick a pit.') : L('Nag-iisip si Lola...', 'Lola is thinking...');
    this.status.classList.toggle('mine', myTurn);
  }

  protected finishMine(mine: EndRow, won: boolean, ranking: string[]): void {
    this.ctx.hud.setObjective('');
    this.ctx.finish({
      gameName: this.name,
      score: mine.score,
      scoreLabel: L('sigay sa bahay mo', 'shells in your house'),
      points: mine.score + (mine.won ? 20 : 0),
      won,
      lines: [...mine.lines, ...ranking],
      shareText: mine.won
        ? L(`Tinalo ko si Lola Pacing sa Sungka, ${mine.score} sigay sa Hari ng Kanto!`, `I beat Lola Pacing at Sungka with ${mine.score} shells on Hari ng Kanto!`)
        : L(`${mine.score} sigay ako sa Sungka sa Hari ng Kanto!`, `I banked ${mine.score} shells in Sungka on Hari ng Kanto!`),
    });
  }
}
