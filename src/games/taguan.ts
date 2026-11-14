import * as THREE from 'three';
import { RAPIER } from '../core/physics';
import type { GameData } from '../net/session';
import { Kid } from '../world/npcs';
import { BaseGame, type EndRow } from './baseGame';
import type { HubLayout } from './types';

/*
 * TAGUAN (Hide and Seek), solo or multiplayer.
 *
 * One SEEKER counts to ten facing the wall (screen dark), then has 90 seconds
 * to find everyone. Solo: you seek 4 AI kids. Multiplayer: one player seeks,
 * the others HIDE for real, and AI kids fill in so there are at least 4
 * hiders. The seeker rotates every round.
 *
 * Hidden kids giggle now and then (positional audio, louder when close).
 * Hiders' name tags are hidden from the seeker. Hiders crouch when still.
 * Found = close + looking at them + no wall in between.
 *
 * Score: seeker +25 per find (+1 per second left if everyone is found).
 * Hider: 100 if never found, otherwise the seconds survived.
 */

/** Spots where an AI kid can crouch. Checked against the map layout. */
export const HIDING_SPOTS: [number, number][] = [
  [-4.7, -16.3], [0.3, -18.0], [3.1, -15.1], [10.0, -12.0], [18.85, -11.5], [-11.85, -12.5], [-19.4, -11.5],
  [-13.5, -17.3], [-2.2, -6.9], [-6.5, 3.25], [17.5, -3.3], [-28.6, -10.5], [10.4, -15.8], [-25.9, 24.0],
];

const BASE = new THREE.Vector3(2.4, 0, -11.2); // counting wall (sari-sari side wall)
const MIN_HIDERS = 4;
const TIME = 90;
const FIND_DIST = 2.3;
const COUNT = ['Isa...', 'Dalawa...', 'Tatlo...', 'Apat...', 'Lima...', 'Anim...', 'Pito...', 'Walo...', 'Siyam...', 'Sampu!'];

type Phase = 'count' | 'seek' | 'done';

interface AiHider {
  id: string; // 'ai0'...
  kid: Kid;
  found: boolean;
  nextSound: number;
  home: THREE.Vector3;
}

const _f = new THREE.Vector3();
const _d = new THREE.Vector3();

export class Taguan extends BaseGame {
  readonly id = 'taguan';
  readonly name = 'Taguan';
  readonly implemented = true;
  readonly where = 'sa eskinita sa likod ng waiting shed';
  readonly layout: HubLayout = {
    spot: new THREE.Vector3(-0.6, 0, -9.4),
    labelPos: new THREE.Vector3(0.2, 3.3, -11),
    accent: '#c77dff',
    kids: [
      { x: 2.9, z: -11.2, faceX: 10, faceZ: -11.2, mode: 'count' },
      { x: 0.6, z: -11.6, mode: 'wave' },
      { x: -1.9, z: -11.0, mode: 'idle' },
    ],
  };

  private extras: Kid[] = [];
  private ai: AiHider[] = [];
  private seeker = '';
  private humanHiders: string[] = [];
  private found = new Set<string>();
  private phase: Phase = 'done';
  private time = TIME;
  private countI = -1;
  private humanSound = new Map<string, number>();
  private sentFound = new Set<string>();
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  // host
  private hostT = 0;
  private hostPhase: Phase = 'done';
  private hostCountI = -1;
  private foundAt = new Map<string, number>();
  private snapT = 0;

  private get iSeek(): boolean {
    return this.seeker === this.selfId;
  }
  private get countStep(): number {
    return this.multiplayer ? 1.3 : 0.6;
  }
  private get totalHiders(): number {
    return this.ai.length + this.humanHiders.length;
  }

  nextOpts(): Record<string, unknown> {
    const r = this.roster();
    const i = r.indexOf(this.seeker);
    return { seeker: r[(i + 1) % r.length] };
  }

  localAnim(): number | null {
    if (this.phase === 'done' || this.iSeek || this.found.has(this.selfId)) return null;
    return this.ctx.player.speed < 0.3 ? 3 : null; // hiders crouch when still
  }

  // ================================================================== lifecycle

  start(): void {
    const { scene, blobs, player, hud, touch, overlays, avatars } = this.ctx;
    const roster = this.roster();
    const wanted = this.opts.seeker as string | undefined;
    this.seeker = wanted && roster.includes(wanted) ? wanted : roster[0];
    this.humanHiders = roster.filter((id) => id !== this.seeker);
    const aiCount = Math.max(0, MIN_HIDERS - this.humanHiders.length);

    // AI kids: same spots on every client (shared seed)
    const rnd = this.rng(3);
    const spots = HIDING_SPOTS.map((s) => ({ s, r: rnd() })).sort((a, b) => a.r - b.r).map((o) => o.s);
    while (this.group.kids.length + this.extras.length < aiCount) {
      const k = new Kid();
      scene.add(k.root);
      k.addShadow(blobs);
      this.extras.push(k);
    }
    const kids = [...this.group.kids, ...this.extras];
    kids.forEach((k, i) => (k.root.visible = i < aiCount));
    this.ai = kids.slice(0, aiCount).map((kid, i) => {
      const [x, z] = spots[i];
      kid.root.position.set(x, 0, z);
      kid.face(BASE.x, BASE.z);
      kid.mode = 'crouch';
      return { id: `ai${i}`, kid, found: false, nextSound: 2 + i, home: new THREE.Vector3(BASE.x - 1.2 - i * 0.8, 0, BASE.z + 1.4) };
    });

    this.found.clear();
    this.sentFound.clear();
    this.humanSound.clear();
    this.time = TIME;
    this.countI = -1;
    this.phase = 'count';
    touch.setActionLabel('Hanap');
    hud.setCrosshair(true);

    if (this.iSeek) {
      player.teleport(BASE.x - 1.1, 0, BASE.z, -Math.PI / 2, 0);
      player.moveEnabled = false;
      player.lookEnabled = false;
      overlays.fade(true, '');
      hud.setObjective('Magbilang ka hanggang sampu...');
      avatars.hiddenTags = new Set(this.humanHiders);
    } else {
      const i = this.humanHiders.indexOf(this.selfId);
      player.teleport(BASE.x - 2 - i * 0.8, 0, BASE.z + 2.2, Math.PI, 0);
      player.moveEnabled = true;
      player.lookEnabled = true;
      overlays.fade(false);
      hud.setObjective(`Magtago ka! Si ${this.nameOf(this.seeker)} ang taya.`);
      hud.toast('Takbo! Magtago!', 'good', 1400);
      avatars.hiddenTags = new Set();
    }

    if (this.isHost) {
      this.hostPhase = 'count';
      this.hostT = 0.3;
      this.hostCountI = -1;
      this.foundAt.clear();
    }
  }

  stop(): void {
    for (const k of this.extras) k.dispose();
    this.extras = [];
    this.ai = [];
    this.phase = 'done';
    this.hostPhase = 'done';
    const { player, hud, overlays, avatars } = this.ctx;
    avatars.hiddenTags = new Set();
    player.moveEnabled = true;
    player.lookEnabled = true;
    overlays.fade(false);
    hud.clearGameWidgets();
  }

  // ================================================================== per frame

  update(dt: number): void {
    if (this.phase === 'done' && this.hostPhase === 'done') return;
    if (this.isHost) this.hostUpdate(dt);
    if (this.phase === 'done') return;

    const { player, hud, audio } = this.ctx;

    // found AI kids jog back to base (every client animates this locally)
    for (const h of this.ai) {
      if (!h.found) continue;
      const kp = h.kid.root.position;
      const dx = h.home.x - kp.x, dz = h.home.z - kp.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.1) {
        const s = Math.min(d, 3.2 * dt);
        kp.x += (dx / d) * s;
        kp.z += (dz / d) * s;
        h.kid.face(h.home.x, h.home.z, dt);
        h.kid.mode = 'run';
        h.kid.speed = 3.2;
      } else {
        h.kid.mode = 'wave';
        h.kid.face(player.position.x, player.position.z, dt);
      }
    }

    if (this.phase === 'count') {
      if (!this.iSeek) hud.setBig(this.countI >= 0 ? COUNT[this.countI] : null);
      return;
    }

    // ---- seek phase
    this.time = Math.max(0, this.time - dt);
    hud.setTimer(String(Math.ceil(this.time)));

    if (!this.iSeek) {
      const me = this.found.has(this.selfId);
      hud.setStat(`${me ? 'Nakita ka na' : 'Hindi ka pa nakikita'}   Nakita: ${this.found.size}/${this.totalHiders}`);
      return;
    }

    // seeker: sounds + detection
    const cam = this.ctx.camera;
    cam.getWorldDirection(_f);
    let nearest = Infinity;
    const targets: { id: string; pos: THREE.Vector3; ai?: AiHider }[] = [];
    for (const h of this.ai) if (!h.found) targets.push({ id: h.id, pos: h.kid.root.position, ai: h });
    for (const id of this.humanHiders) {
      if (this.found.has(id)) continue;
      const pos = this.ctx.avatars.positionOf(id);
      if (pos) targets.push({ id, pos });
    }
    for (const tgt of targets) {
      const dist = Math.hypot(tgt.pos.x - player.position.x, tgt.pos.z - player.position.z);
      nearest = Math.min(nearest, dist);
      // proximity giggles (more often when closer)
      const next = (tgt.ai ? tgt.ai.nextSound : this.humanSound.get(tgt.id) ?? 4) - dt;
      if (next <= 0) {
        if (dist < 26) audio.play(Math.random() < 0.65 ? 'giggle' : 'step', { pos: _d.set(tgt.pos.x, 0.8, tgt.pos.z), vol: 1.1 });
        const again = 1.2 + Math.min(6, dist * 0.22) + Math.random() * 1.5 + (tgt.ai ? 0 : 2.5);
        if (tgt.ai) tgt.ai.nextSound = again;
        else this.humanSound.set(tgt.id, again);
      } else if (tgt.ai) tgt.ai.nextSound = next;
      else this.humanSound.set(tgt.id, next);

      if (dist < FIND_DIST && !this.sentFound.has(tgt.id)) {
        _d.set(tgt.pos.x, tgt.pos.y + 0.55, tgt.pos.z).sub(cam.position);
        const len = _d.length();
        _d.normalize();
        if (_d.dot(_f) > 0.55 && this.clearLine(cam.position, _d, len)) {
          this.sentFound.add(tgt.id);
          this.toHost({ k: 'found', id: tgt.id });
        }
      }
    }
    const warmth = nearest < 4 ? 'Mainit na!' : nearest < 9 ? 'Malapit-lapit...' : nearest < Infinity ? 'Malamig pa.' : '';
    hud.setStat(`Nakita: ${this.found.size}/${this.totalHiders}   ${warmth}`);
  }

  private clearLine(from: THREE.Vector3, dir: THREE.Vector3, len: number): boolean {
    this.ray.origin = { x: from.x, y: from.y, z: from.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    return !this.ctx.physics.world.castRay(this.ray, len - 0.35, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
  }

  // ================================================================== client messages

  protected onClientMsg(d: GameData): void {
    const { hud, overlays, player, audio } = this.ctx;
    switch (d.k) {
      case 'count': {
        this.countI = Number(d.i);
        audio.play('tick');
        if (this.iSeek) overlays.fade(true, COUNT[this.countI]);
        break;
      }
      case 'seek':
        this.phase = 'seek';
        hud.setBig(null);
        if (this.iSeek) {
          overlays.fade(false);
          player.moveEnabled = true;
          player.lookEnabled = true;
          hud.toast('Handa na! Hanap!', 'good', 1300);
          hud.setObjective(`Hanapin ang ${this.totalHiders} na nagtatago! Pakinggan ang mga hagikgik.`);
        } else {
          hud.toast('Hahanap na siya!', 'bad', 1300);
          hud.setObjective('Huwag kang magpakita! Tumahimik ka.');
        }
        break;
      case 's':
        this.time = Number(d.tm);
        break;
      case 'found': {
        const id = String(d.id);
        if (this.found.has(id)) break;
        this.found.add(id);
        this.ctx.avatars.hiddenTags.delete(id);
        const h = this.ai.find((a) => a.id === id);
        if (h) {
          h.found = true;
          h.kid.mode = 'cheer';
          audio.play('giggle', { pos: h.kid.root.position, vol: 1.4 });
        }
        if (this.iSeek) {
          audio.play('pickup');
          hud.toast(`Nakita kita! ${this.found.size}/${this.totalHiders}`, 'good', 1200);
        } else if (id === this.selfId) {
          hud.toast('Nakita ka!', 'bad', 1500);
          hud.setObjective('Nakita ka na. Panoorin ang iba.');
        } else if (this.multiplayer && !h) hud.toast(`Nakita si ${this.nameOf(id)}!`, 'small', 1000);
        break;
      }
    }
  }

  // ================================================================== host

  protected onHostMsg(from: string, d: GameData): void {
    if (d.k !== 'found' || from !== this.seeker || this.hostPhase !== 'seek') return;
    const id = String(d.id);
    if (this.foundAt.has(id)) return;
    const valid = id.startsWith('ai') ? this.ai.some((a) => a.id === id) : this.humanHiders.includes(id);
    if (!valid) return;
    this.foundAt.set(id, TIME - this.hostT);
    this.toAll({ k: 'found', id });
    if (this.foundAt.size >= this.totalHiders) this.hostEnd();
  }

  private hostUpdate(dt: number): void {
    // seeker left the lobby: end; hider left: drop them
    const roster = this.roster();
    if (!roster.includes(this.seeker) && this.hostPhase !== 'done') {
      this.toast(null, 'Umalis ang taya. Tapos na ang laro.', 'bad', 1500);
      this.hostEnd();
      return;
    }
    this.humanHiders = this.humanHiders.filter((id) => roster.includes(id));

    if (this.hostPhase === 'count') {
      this.hostT -= dt;
      if (this.hostT <= 0) {
        this.hostCountI++;
        if (this.hostCountI < COUNT.length) {
          this.toAll({ k: 'count', i: this.hostCountI });
          this.hostT = this.countStep;
        } else {
          this.hostPhase = 'seek';
          this.hostT = TIME;
          this.toAll({ k: 'seek' });
        }
      }
    } else if (this.hostPhase === 'seek') {
      this.hostT -= dt;
      this.snapT -= dt;
      if (this.snapT <= 0) {
        this.snapT = 0.25;
        this.toAll({ k: 's', tm: Math.max(0, Math.round(this.hostT * 10) / 10) });
      }
      if (this.hostT <= 0) {
        this.toast(null, 'Ubos ang oras!', 'bad', 1400);
        this.hostEnd();
      }
    }
  }

  private hostEnd(): void {
    if (this.hostPhase === 'done') return;
    this.hostPhase = 'done';
    const timeLeft = Math.max(0, Math.floor(this.hostT));
    const all = this.foundAt.size >= this.totalHiders;
    const rows: EndRow[] = [];
    const sk = this.foundAt.size * 25 + (all ? timeLeft : 0);
    rows.push({
      id: this.seeker,
      score: sk,
      won: all,
      lines: ['Ikaw ang taya', `Nakita: ${this.foundAt.size}/${this.totalHiders}`, all ? `Oras na natira: ${timeLeft}s` : 'May nagtatago pa!'],
    });
    for (const id of this.humanHiders) {
      const at = this.foundAt.get(id);
      rows.push({
        id,
        score: at === undefined ? 100 : Math.floor(at),
        won: at === undefined,
        lines: ['Nagtago ka', at === undefined ? 'Hindi ka nakita! +100' : `Nakita ka pagkatapos ng ${Math.floor(at)}s`],
      });
    }
    this.endWith(rows);
  }

  protected finishMine(mine: EndRow, won: boolean, ranking: string[]): void {
    this.phase = 'done';
    this.ctx.hud.setObjective('');
    this.ctx.hud.setBig(null);
    this.ctx.overlays.fade(false);
    const seeker = mine.id === this.seeker;
    this.ctx.finish({
      gameName: this.name,
      score: mine.score,
      scoreLabel: 'puntos',
      points: mine.score,
      won,
      lines: [...mine.lines, ...ranking],
      shareText: seeker
        ? `${this.found.size} ang nahanap ko sa Taguan, ${mine.score} puntos sa Barangay After Dark!`
        : won
          ? 'Hindi ako nahanap sa Taguan sa Barangay After Dark!'
          : `Nakapagtago ako nang ${mine.score}s sa Taguan sa Barangay After Dark!`,
    });
  }
}
