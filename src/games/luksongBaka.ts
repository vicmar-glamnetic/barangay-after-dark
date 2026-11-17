import { L } from '../core/i18n';
import * as THREE from 'three';
import { BaseGame, type EndRow } from './baseGame';
import type { HubLayout } from './types';

/*
 * LUKSONG BAKA (leapfrog), solo or score battle. Endless.
 *
 * A kid bends over as the "baka". Sprint down the lane and press Jump (or
 * Action) inside the chalk takeoff zone to vault over. You need enough speed
 * (the meter shows it) and the right spot: too early, too close or too slow
 * and you crash into the baka (-1 life).
 * Every level the baka stands taller, you need more speed, and the zone
 * shrinks. Past level 5 the zone keeps shrinking. 3 lives.
 * Score: 10 x level per clear, +5 for a perfect takeoff.
 */

const B = new THREE.Vector3(-15.5, 0, 19.5); // the baka
const START_X = -8.3;
const YAW = Math.PI / 2; // facing -X (toward the baka)
const LIVES = 3;
/** [near, far] takeoff distance before the baka, per level 1..5 */
const ZONES: [number, number][] = [[0.5, 1.8], [0.6, 1.6], [0.7, 1.5], [0.75, 1.4], [0.8, 1.3]];
const MIN_SPEED = [3.0, 3.9, 4.6, 5.2, 5.7];
const HEIGHT = [0.66, 0.73, 0.8, 0.88, 0.96];
const RUN_MAX = 6.4;

type Phase = 'ready' | 'run' | 'vault' | 'crash' | 'done';

export class LuksongBaka extends BaseGame {
  readonly id = 'luksongBaka';
  readonly name = 'Luksong Baka';
  readonly implemented = true;
  get where() { return L('sa plaza, sa tabi ng poste', 'in the plaza by the lamp post'); }
  get blurb() { return L('Lundagan ang "baka" na pataas nang pataas', 'Leapfrog over a kid who keeps standing taller'); }
  get howTo() {
    return [
      L('Ang "baka" ay batang nakayuko. Bawat level, tumataas siya.', 'The "baka" (cow) is a kid bending over. Every level they stand a little taller.'),
      L('Tumakbo nang mabilis, tapos tumalon kapag nasa berdeng guhit ka.', 'Sprint at full speed, then jump when you reach the green mark on the ground.'),
      L('Masyadong maaga o malapit, o kulang sa bilis, at babangga ka.', 'Jump too early, too close, or too slow and you crash into the baka.'),
    ];
  }
  readonly layout: HubLayout = {
    spot: new THREE.Vector3(-8.6, 0, 19.5),
    labelPos: new THREE.Vector3(-12.2, 2.9, 19.5),
    accent: '#90be6d',
    kids: [
      { x: B.x, z: B.z, mode: 'baka', faceX: B.x, faceZ: 30 },
      { x: -17.6, z: 18.2, mode: 'cheer', faceX: -12, faceZ: 19.5 },
      { x: -12.2, z: 21.4, mode: 'wave', faceX: -12, faceZ: 19.5 },
    ],
  };

  private zone!: THREE.Mesh;
  private phase: Phase = 'done';
  private level = 1;
  private lives = LIVES;
  private score = 0;
  private perfects = 0;
  private timer = 0;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private apex = 1;

  protected onAttach(): void {
    const { scene } = this.ctx;
    const chalk = new THREE.MeshBasicMaterial({ color: 0x9b968a });
    const startLine = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 2.4).rotateX(-Math.PI / 2), chalk);
    startLine.position.set(START_X + 0.4, 0.025, B.z);
    scene.add(startLine);
    this.zone = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1.4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x90be6d, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.zone.visible = false;
    scene.add(this.zone);
  }

  private params(): { zone: [number, number]; minSpeed: number; idx: number } {
    const idx = Math.min(this.level - 1, 4);
    const extra = Math.max(0, this.level - 5) * 0.05;
    let [near, far] = ZONES[idx];
    near = Math.min(near + extra, 1.0);
    far = Math.max(far - extra, near + 0.25);
    return { zone: [near, far], minSpeed: MIN_SPEED[idx], idx };
  }

  start(): void {
    const { hud, touch } = this.ctx;
    this.battleReset();
    this.level = 1;
    this.lives = LIVES;
    this.score = 0;
    this.perfects = 0;
    touch.setActionLabel(L('Lundag', 'Jump'));
    hud.setCrosshair(true);
    this.ctx.player.jumpEnabled = false;
    this.zone.visible = true;
    this.group.kids.slice(1).forEach((k) => (k.mode = 'cheer'));
    this.ready();
  }

  stop(): void {
    const { player, hud } = this.ctx;
    this.phase = 'done';
    this.zone.visible = false;
    player.jumpEnabled = true;
    player.moveEnabled = true;
    player.lookEnabled = true;
    hud.clearGameWidgets();
  }

  private ready(): void {
    const { player, hud, isTouch } = this.ctx;
    const { zone, idx } = this.params();
    const baka = this.group.kids[0];
    baka.root.position.set(B.x, 0, B.z);
    baka.face(B.x, 30);
    baka.mode = 'baka';
    baka.bakaLevel = idx;
    this.zone.scale.x = zone[1] - zone[0];
    this.zone.position.set(B.x + (zone[0] + zone[1]) / 2, 0.026, B.z);
    player.teleport(START_X, 0, B.z, YAW, -0.12);
    player.moveEnabled = false;
    player.lookEnabled = true;
    this.phase = 'ready';
    this.timer = 1.0;
    hud.toast(`Level ${this.level}`, 'small', 900);
    hud.setObjective(isTouch() ? L('Itulak nang todo ang joystick, tapos Lundag sa berdeng guhit!', 'Push the joystick all the way, then tap Jump at the green mark!') : L('Shift para tumakbo, tapos Space o click sa berdeng guhit!', 'Hold Shift to sprint, then Space or click at the green mark!'));
  }

  update(dt: number): void {
    const { input, player, hud, audio } = this.ctx;
    if (this.phase === 'done') {
      this.battleCheck();
      return;
    }
    const { zone, minSpeed, idx } = this.params();

    switch (this.phase) {
      case 'ready':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.phase = 'run';
          player.moveEnabled = true;
        }
        break;
      case 'run': {
        const d = player.position.x - B.x; // distance before the baka
        hud.setMeter(Math.min(1, player.speed / RUN_MAX), minSpeed / RUN_MAX, 1, `${L('Bilis', 'Speed')}  ${player.speed.toFixed(1)} / ${minSpeed.toFixed(1)}`);
        if (input.pressed('jump') || input.pressed('action') || input.tapPressed) {
          if (d > zone[1] + 0.05) this.crash(L('Masyadong maaga!', 'Too early!'));
          else if (d < zone[0] - 0.05) this.crash(L('Masyadong malapit!', 'Too close!'));
          else if (player.speed < minSpeed) this.crash(L('Kulang sa bilis! Tumakbo ka.', 'Not fast enough! Sprint first.'));
          else this.vault(d, zone, minSpeed, idx);
        } else if (d < 0.35) this.crash(L('Nabangga mo ang baka!', 'You bumped into the baka!'));
        else if (Math.abs(player.position.z - B.z) > 3 || player.position.x > START_X + 3) {
          // wandered off the lane: put them back without a penalty
          player.teleport(START_X, 0, B.z, YAW, -0.12);
        }
        break;
      }
      case 'vault': {
        this.timer = Math.min(1, this.timer + dt / 0.55);
        const k = this.timer;
        const p = new THREE.Vector3().lerpVectors(this.from, this.to, k);
        p.y = Math.sin(k * Math.PI) * this.apex;
        player.teleport(p.x, p.y, p.z, YAW, -0.35 + k * 0.3);
        if (k >= 1) {
          audio.play('step', { vol: 1.5 });
          this.level++;
          this.battleReport(this.score, false);
          this.ready();
        }
        break;
      }
      case 'crash':
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.lives <= 0) this.endRun();
          else this.ready();
        }
        break;
    }
    hud.setStat(`Level ${this.level}   ${'♥'.repeat(this.lives)}${'♡'.repeat(LIVES - this.lives)}   ${L('Puntos', 'Score')}: ${this.score}   ${this.battleText()}`);
    this.battleCheck();
  }

  private vault(d: number, zone: [number, number], minSpeed: number, idx: number): void {
    const { player, hud, audio } = this.ctx;
    const mid = (zone[0] + zone[1]) / 2;
    const perfect = Math.abs(d - mid) < 0.15 && player.speed >= minSpeed + 0.4;
    const pts = 10 * this.level + (perfect ? 5 : 0);
    this.score += pts;
    if (perfect) this.perfects++;
    hud.toast(perfect ? L(`Perpekto! +${pts}`, `Perfect! +${pts}`) : L(`Lusot! +${pts}`, `Cleared! +${pts}`), 'good', 900);
    audio.play(perfect ? 'perfect' : 'whiff');
    audio.play('cheer');
    hud.setMeter(null);
    this.from.set(player.position.x, 0, player.position.z);
    this.to.set(B.x - 1.4, 0, B.z + (player.position.z - B.z) * 0.5);
    this.apex = HEIGHT[idx] + 0.55;
    this.timer = 0;
    this.phase = 'vault';
    player.moveEnabled = false;
    this.group.kids.slice(1).forEach((k) => (k.mode = 'cheer'));
  }

  private crash(msg: string): void {
    const { player, hud, audio } = this.ctx;
    this.lives--;
    hud.toast(this.lives > 0 ? `${msg} ${L('-1 buhay', '-1 life')}` : msg, 'bad', 1300);
    hud.setMeter(null);
    audio.play('thud');
    // bounce back off the baka
    player.teleport(Math.max(player.position.x, B.x + 0.9), 0, player.position.z, YAW, 0.25);
    player.moveEnabled = false;
    this.phase = 'crash';
    this.timer = 1.3;
    this.battleReport(this.score, false);
  }

  private endRun(): void {
    this.phase = 'done';
    this.ctx.hud.setMeter(null);
    this.ctx.hud.setObjective(this.multiplayer ? L('Tapos ka na. Hinihintay ang iba...', "You're done. Waiting for the others...") : '');
    const cleared = this.level - 1;
    this.battleReport(this.score, true, cleared >= 5, [L(`Pinakamataas na level: ${cleared}`, `Highest level: ${cleared}`), L(`Perpekto: ${this.perfects}`, `Perfect jumps: ${this.perfects}`)]);
  }

  protected finishMine(mine: EndRow, won: boolean, ranking: string[]): void {
    this.ctx.player.moveEnabled = false;
    const lvl = mine.lines[0]?.match(/\d+/)?.[0] ?? '0';
    this.ctx.finish({
      gameName: this.name,
      score: mine.score,
      scoreLabel: L('puntos', 'points'),
      points: mine.score,
      won,
      lines: [...mine.lines, ...ranking],
      shareText: L(`Nakalundag ako hanggang level ${lvl} sa Luksong Baka, ${mine.score} puntos sa Hari ng Kanto!`, `I leapfrogged up to level ${lvl} in Luksong Baka, ${mine.score} points on Hari ng Kanto!`),
    });
  }
}
