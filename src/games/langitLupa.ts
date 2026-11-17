import { L } from '../core/i18n';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameData } from '../net/session';
import { Kid } from '../world/npcs';
import { GroundBot } from '../world/groundBot';
import { BaseGame, type EndRow } from './baseGame';
import type { HubLayout } from './types';

/*
 * LANGIT-LUPA ("heaven-earth"), solo or multiplayer.
 *
 * Survive 60 seconds. Anything raised is LANGIT (safe): crates, the bench,
 * the low wall, the drums, the kariton. The ground is LUPA. The taya chases
 * anyone on the ground. Street rule: bawal tumambay, you cannot stay on the
 * same langit for more than MAX_PERCH seconds, after that the taya can tag
 * you there too, so you have to keep hopping.
 *
 * Leaving the chalk boundary for more than 2 seconds = out.
 * Score: 2 per second survived, +1 per hop to a new langit, +40 if you last
 * the whole minute. Multiplayer: 2 tayas when 3 or more players.
 *
 * Network: the host runs the tayas and judges everyone from their reported
 * position (feet height decides langit vs lupa).
 */

export const SAFE_HEIGHT = 0.35;
export const MAX_PERCH = 5;
const TIME = 60;
const BOUNDS = { minX: 18.6, maxX: 29.2, minZ: 5.6, maxZ: 16.6 };
const TAG_DIST = 0.95;
const OUT_GRACE = 2;
const SNAP_HZ = 15;

/** Extra platforms this game adds (x, z, w, h, d) for longer hop chains. */
const EXTRA: [number, number, number, number, number][] = [
  [25.2, 15.4, 1.0, 0.8, 1.0],
  [28.4, 8.0, 1.0, 1.2, 1.0],
  [19.4, 15.2, 1.2, 0.6, 1.2],
  [27.9, 14.4, 1.4, 0.5, 0.8],
  [22.2, 15.6, 1.0, 0.7, 1.0],
];
/** Start perches, one per player. */
const STARTS: [number, number][] = [[21, 9], [24, 7.8], [26.1, 13.4], [26.7, 10], [23.5, 12.2], [25.2, 15.4]];
const TAYA_START: [number, number][] = [[19.3, 6.3], [28.8, 16.1]];
const _stalk = new THREE.Vector3();

type PState = 'ready' | 'play' | 'out';
const PSTATES: PState[] = ['ready', 'play', 'out'];

interface Part {
  id: string;
  state: PState;
  survived: number;
  hops: number;
  perchT: number;
  anchor: THREE.Vector3 | null;
  outsideT: number;
  vulnerableWarned: boolean;
}

interface Taya {
  kid: Kid;
  target: THREE.Vector3; // client smoothing target
  speed: number;
  /** When blocked by a crate: side-step direction (+1/-1) and how long to keep it. */
  detour: number;
  detourT: number;
  /** Host only: physics mover that slides along the real crates and walls. */
  bot: GroundBot | null;
  stuckFlip: boolean;
}

export class LangitLupa extends BaseGame {
  readonly id = 'langitLupa';
  readonly name = 'Langit-Lupa';
  readonly implemented = true;
  get where() { return L('sa mga kahon sa tabi ng court', 'on the crates beside the court'); }
  get blurb() { return L('Manatili sa mataas para hindi mahuli', 'Stay up high so the tagger cannot catch you'); }
  get howTo() {
    return [
      L('"Langit" = kahit anong mataas (kahon, bangko). "Lupa" = ang lupa. Ang taya ay nasa lupa lang.', '"Langit" (heaven) is anything raised: crates, benches, curbs. "Lupa" (earth) is the ground, where the tagger roams.'),
      L('Sa langit, ligtas ka, pero bawal tumambay nang matagal. Lumipat bago maubos ang oras.', "Up high you're safe, but you can't camp. Hop to another spot before your timer runs out."),
      L('Tumagal hanggang dulo nang hindi nahuhuli.', 'Survive until time runs out without getting caught.'),
    ];
  }
  readonly layout: HubLayout = {
    spot: new THREE.Vector3(20.6, 0, 7.8),
    labelPos: new THREE.Vector3(23.5, 3.6, 10.5),
    accent: '#ff8c42',
    kids: [
      { x: 22.6, z: 14.2, mode: 'idle' }, // the taya, on the ground
      { x: 21, z: 9, mode: 'cheer' }, // on the stacked crates
      { x: 26.1, z: 13.4, mode: 'wave' }, // on a crate
      { x: 23.5, z: 12.2, mode: 'idle' }, // on the bench
    ],
  };

  private boundary!: THREE.Group;
  private extras: Kid[] = [];
  private tayas: Taya[] = [];
  private running = false;

  // client view
  private time = TIME;
  private me = { state: 'ready' as PState, perchLeft: MAX_PERCH, survived: 0, hops: 0 };
  private board: [string, number, PState][] = [];
  private readyT = 0;

  // host
  private parts = new Map<string, Part>();
  private hostTime = TIME;
  private hostReady = 0;
  private hostDone = false;
  private snapT = 0;

  protected onAttach(): void {
    const { scene, physics } = this.ctx;
    // extra crates (permanent, so they are climbable in the hub too)
    const parts: THREE.BufferGeometry[] = [];
    const tint = (g: THREE.BufferGeometry, hex: number) => {
      const ng = g.toNonIndexed();
      ng.deleteAttribute('uv');
      const c = new THREE.Color(hex);
      const a = new Float32Array(ng.getAttribute('position').count * 3);
      for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
      ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return ng;
    };
    for (const [x, z, w, h, d] of EXTRA) {
      parts.push(tint(new THREE.BoxGeometry(w, h, d).translate(x, h / 2, z), 0x8a5a36));
      parts.push(tint(new THREE.BoxGeometry(w + 0.03, 0.05, d + 0.03).translate(x, h - 0.02, z), 0x4e3320));
      physics.addBox(x, h / 2, z, w / 2, h / 2, d / 2);
    }
    scene.add(new THREE.Mesh(mergeGeometries(parts, false)!, new THREE.MeshLambertMaterial({ vertexColors: true })));
    // chalk boundary (only visible during the game)
    this.boundary = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd6a5, transparent: true, opacity: 0.6, depthWrite: false, fog: false });
    const w = BOUNDS.maxX - BOUNDS.minX, d = BOUNDS.maxZ - BOUNDS.minZ;
    const cx = (BOUNDS.minX + BOUNDS.maxX) / 2, cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
    const edge = (x: number, z: number, ew: number, ed: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ew, ed).rotateX(-Math.PI / 2), mat);
      m.position.set(x, 0.03, z);
      this.boundary.add(m);
    };
    edge(cx, BOUNDS.minZ, w, 0.1);
    edge(cx, BOUNDS.maxZ, w, 0.1);
    edge(BOUNDS.minX, cz, 0.1, d);
    edge(BOUNDS.maxX, cz, 0.1, d);
    this.boundary.visible = false;
    scene.add(this.boundary);
  }

  // ================================================================== lifecycle

  start(): void {
    const { scene, blobs, hud, touch, player } = this.ctx;
    const n = this.roster().length;
    const tayaCount = this.multiplayer && n >= 3 ? 2 : 1;
    const kids = [this.group.kids[0]];
    while (kids.length < tayaCount) {
      const k = new Kid();
      scene.add(k.root);
      k.addShadow(blobs);
      this.extras.push(k);
      kids.push(k);
    }
    this.tayas = kids.map((kid, i) => {
      const [x, z] = TAYA_START[i];
      kid.root.position.set(x, 0, z);
      kid.mode = 'idle';
      return { kid, target: new THREE.Vector3(x, 0, z), speed: 0, detour: 1, detourT: 0, stuckFlip: false, bot: this.isHost ? new GroundBot(this.ctx.physics, x, z) : null };
    });
    // the other hub kids step outside the boundary and cheer
    const spect: [number, number][] = [[18.2, 5.2], [29.4, 5.4], [18.1, 16.9]];
    this.group.kids.slice(1).forEach((k, i) => {
      const [x, z] = spect[i];
      k.root.position.set(x, this.ctx.groundAt(x, z), z);
      k.face(23.5, 11);
      k.mode = 'cheer';
    });

    // start on our own perch
    const [sx, sz] = STARTS[this.slotOf(this.selfId) % STARTS.length];
    player.teleport(sx, this.ctx.physics.groundAt(sx, sz, 3) + 0.05, sz, Math.PI, -0.1);
    player.moveEnabled = false;

    this.boundary.visible = true;
    this.running = true;
    this.time = TIME;
    this.readyT = 2;
    this.me = { state: 'ready', perchLeft: MAX_PERCH, survived: 0, hops: 0 };
    this.board = [];
    touch.setActionLabel(L('Talon', 'Jump'));
    hud.setCrosshair(true);
    hud.setObjective(L('Nasa LANGIT ka. Huwag kang mahuli sa LUPA!', "You're on LANGIT (high ground). Don't get caught on the LUPA (ground)!"));

    if (this.isHost) {
      this.parts.clear();
      for (const id of this.roster()) {
        this.parts.set(id, { id, state: 'ready', survived: 0, hops: 0, perchT: 0, anchor: null, outsideT: 0, vulnerableWarned: false });
      }
      this.hostTime = TIME;
      this.hostReady = 2;
      this.hostDone = false;
    }
  }

  stop(): void {
    for (const t of this.tayas) t.bot?.dispose();
    for (const k of this.extras) k.dispose();
    this.extras = [];
    this.tayas = [];
    this.parts.clear();
    this.boundary.visible = false;
    this.running = false;
    this.ctx.player.moveEnabled = true;
    this.ctx.hud.clearGameWidgets();
  }

  /** Hiders-style anim: none. Langit-Lupa players just run. */
  localAnim(): number | null {
    return null;
  }

  // ================================================================== per frame

  update(dt: number): void {
    if (!this.running) return;
    if (this.isHost) this.hostUpdate(dt);
    else {
      const k = 1 - Math.exp(-dt * 12);
      for (const t of this.tayas) {
        const kp = t.kid.root.position;
        const before = kp.clone();
        kp.lerp(t.target, k);
        const sp = before.distanceTo(kp) / Math.max(dt, 1e-3);
        t.kid.speed = sp;
        t.kid.mode = sp > 0.3 ? 'run' : 'idle';
        if (sp > 0.3) t.kid.face(t.target.x, t.target.z, dt);
      }
    }
    this.clientHud(dt);
  }

  private clientHud(dt: number): void {
    const { hud, player } = this.ctx;
    if (this.me.state === 'ready') {
      this.readyT -= dt;
      hud.setBig(this.readyT > 0 ? String(Math.ceil(this.readyT)) : null);
    } else hud.setBig(null);

    const onLangit = player.position.y > SAFE_HEIGHT;
    let status: string;
    if (this.me.state === 'out') status = this.multiplayer ? L('Huli ka na. Panoorin ang iba.', "You're caught. Watch the others.") : L('Huli ka!', 'Caught!');
    else if (this.me.state === 'ready') status = L('Handa...', 'Ready...');
    else if (!onLangit) status = L('LUPA ka! Umakyat ka sa langit!', "You're on the ground! Climb up high!");
    else if (this.me.perchLeft <= 0) status = L('Bawal tumambay! Lumipat ka!', 'No camping! Move to another spot!');
    else status = L(`LANGIT ka. Lipat bago ${Math.ceil(this.me.perchLeft)}s`, `Safe up high. Move within ${Math.ceil(this.me.perchLeft)}s`);
    hud.setObjective(status);
    let stat = L(`Tagal: ${Math.floor(this.me.survived)}s   Talon: ${this.me.hops}`, `Survived: ${Math.floor(this.me.survived)}s   Hops: ${this.me.hops}`);
    if (this.multiplayer && this.board.length > 1)
      stat += '   ' + this.board.slice(0, 4).map(([id, s, st]) => `${this.nameOf(id)} ${s}${st === 'out' ? 'x' : ''}`).join(' · ');
    hud.setStat(stat);
    hud.setTimer(String(Math.max(0, Math.ceil(this.time))));
  }

  protected onClientMsg(d: GameData): void {
    switch (d.k) {
      case 's': {
        this.time = Number(d.tm);
        const ty = d.ty as number[];
        if (!this.isHost) this.tayas.forEach((t, i) => t.target.set(ty[i * 2] ?? t.target.x, 0, ty[i * 2 + 1] ?? t.target.z));
        const rows = d.p as Record<string, [number, number, number, number]>;
        const mine = rows[this.selfId];
        if (mine) this.me = { state: PSTATES[mine[0]], perchLeft: mine[1], survived: mine[2], hops: mine[3] };
        this.board = Object.entries(rows)
          .map(([id, v]) => [id, Math.floor(v[2]), PSTATES[v[0]]] as [string, number, PState])
          .sort((a, b) => b[1] - a[1]);
        break;
      }
      case 'go':
        this.ctx.player.moveEnabled = true;
        this.ctx.hud.toast(L('Takbo!', 'Go!'), 'good', 800);
        break;
      case 'caught':
        if (d.to === this.selfId) this.ctx.player.moveEnabled = this.multiplayer; // spectate by walking around in multiplayer
        break;
    }
  }

  // ================================================================== host

  private hostUpdate(dt: number): void {
    const ids = new Set(this.roster());
    for (const id of [...this.parts.keys()]) if (!ids.has(id)) this.parts.delete(id);

    if (this.hostReady > 0) {
      this.hostReady -= dt;
      if (this.hostReady <= 0) {
        for (const p of this.parts.values()) p.state = 'play';
        this.toAll({ k: 'go' });
      }
    } else if (!this.hostDone) {
      this.hostTime -= dt;
      for (const p of this.parts.values()) this.hostPart(p, dt);
      this.hostTayas(dt);
      const anyLeft = [...this.parts.values()].some((p) => p.state === 'play');
      if (!anyLeft || this.hostTime <= 0) {
        if (this.hostTime <= 0) this.toast(null, L('Tapos na ang oras!', "Time's up!"), 'good', 1400);
        this.hostEnd();
      }
    }

    this.snapT -= dt;
    if (this.snapT <= 0) this.sendSnap();
  }

  private sendSnap(): void {
    {
      this.snapT = 1 / SNAP_HZ;
      const p: Record<string, number[]> = {};
      for (const x of this.parts.values())
        p[x.id] = [PSTATES.indexOf(x.state), Math.round(Math.max(0, MAX_PERCH - x.perchT) * 10) / 10, Math.round(x.survived * 10) / 10, x.hops];
      const ty: number[] = [];
      for (const t of this.tayas) ty.push(Math.round(t.kid.root.position.x * 100) / 100, Math.round(t.kid.root.position.z * 100) / 100);
      this.toAll({ k: 's', tm: Math.max(0, Math.round(this.hostTime * 10) / 10), ty, p });
    }
  }

  private hostPart(p: Part, dt: number): void {
    if (p.state !== 'play') return;
    const pos = this.posOf(p.id);
    if (!pos) return;
    p.survived += dt;

    // langit tracking: a new perch resets the timer and counts as a hop
    if (pos.y > SAFE_HEIGHT) {
      if (!p.anchor || Math.hypot(pos.x - p.anchor.x, pos.z - p.anchor.z) > 1.1) {
        if (p.anchor) p.hops++;
        p.anchor = pos.clone();
        p.perchT = 0;
        p.vulnerableWarned = false;
      }
      p.perchT += dt;
      if (p.perchT > MAX_PERCH - 1.5 && !p.vulnerableWarned) {
        p.vulnerableWarned = true;
        this.toast(p.id, L('Lipat na! Bawal tumambay!', 'Move! No camping!'), 'bad', 1100);
        this.toAll({ k: 'sfx', name: 'tick', pos: null, to: p.id });
      }
    } else {
      p.anchor = null;
      p.perchT = 0;
    }

    // outside the chalk boundary
    const outside = pos.x < BOUNDS.minX || pos.x > BOUNDS.maxX || pos.z < BOUNDS.minZ || pos.z > BOUNDS.maxZ;
    p.outsideT = outside ? p.outsideT + dt : 0;
    if (outside && p.outsideT > 0 && p.outsideT - dt <= 0) this.toast(p.id, L('Bumalik ka sa loob ng guhit!', 'Get back inside the chalk line!'), 'bad', 1000);
    if (p.outsideT > OUT_GRACE) this.catchPart(p, L('Lumabas ka!', 'Out of bounds!'));
  }

  private vulnerable(p: Part, pos: THREE.Vector3): boolean {
    return pos.y <= SAFE_HEIGHT || p.perchT > MAX_PERCH;
  }

  private catchPart(p: Part, msg: string): void {
    p.state = 'out';
    this.toast(p.id, msg, 'bad', 1500);
    if (this.multiplayer) this.toast(null, L(`Huli si ${this.net!.nameOf(p.id)}!`, `${this.net!.nameOf(p.id)} got caught!`), 'small', 1000);
    this.toAll({ k: 'sfx', name: 'tag', pos: null, to: p.id });
    this.toAll({ k: 'caught', to: p.id });
  }

  private hostTayas(dt: number): void {
    const elapsed = TIME - this.hostTime;
    const chaseSpeed = 4.0 + (elapsed / TIME) * 1.0; // speeds up over the minute
    const claimed = new Set<string>();
    for (const t of this.tayas) {
      const kp = t.kid.root.position;
      // prey: nearest vulnerable player not already chased by the other taya
      let prey: { id: string; pos: THREE.Vector3; p: Part } | null = null;
      let near: THREE.Vector3 | null = null;
      let best = Infinity, bestAny = Infinity;
      for (const p of this.parts.values()) {
        if (p.state !== 'play') continue;
        const pos = this.posOf(p.id);
        if (!pos) continue;
        const d = Math.hypot(pos.x - kp.x, pos.z - kp.z);
        if (d < bestAny) {
          bestAny = d;
          near = pos;
        }
        if (this.vulnerable(p, pos) && !claimed.has(p.id) && d < best) {
          best = d;
          prey = { id: p.id, pos, p };
        }
      }
      let target: THREE.Vector3 | null = null;
      let speed = 2.2;
      if (prey) {
        claimed.add(prey.id);
        target = prey.pos;
        speed = chaseSpeed;
        if (best < TAG_DIST) {
          this.catchPart(prey.p, prey.pos.y <= SAFE_HEIGHT ? L('Huli ka sa lupa!', 'Caught on the ground!') : L('Huli! Tumambay ka kasi.', 'Caught! You stayed up there too long.'));
          t.kid.mode = 'cheer';
          continue;
        }
      } else if (near) {
        // stalk: wait on the ground right beside the nearest perched player
        const sx = kp.x - near.x, sz = kp.z - near.z;
        const sl = Math.hypot(sx, sz) || 1;
        target = _stalk.set(near.x + (sx / sl) * 1.1, 0, near.z + (sz / sl) * 1.1);
        speed = 2.4;
      }
      if (target) {
        const dx = target.x - kp.x, dz = target.z - kp.z;
        const d = Math.hypot(dx, dz);
        const stop = prey ? 0.05 : 0.3;
        if (d > stop) {
          const s = Math.min(d - stop, speed * dt);
          let ux = dx / d, uz = dz / d;
          if (t.detourT > 0) {
            // keep sliding sideways around the obstacle for a moment
            t.detourT -= dt;
            const sx = -uz * t.detour, sz = ux * t.detour;
            ux = ux * 0.35 + sx;
            uz = uz * 0.35 + sz;
            const l = Math.hypot(ux, uz);
            ux /= l;
            uz /= l;
          }
          // physics move: slides along real crates/walls, can never go inside them
          t.bot!.move(ux * s, uz * s, dt);
          if (t.bot!.moved < s * 0.35 && t.detourT <= 0) {
            // blocked against a crate: slide around it, on the side nearer the target
            // (cross product sign says whether the target is to our left or right)
            const side = Math.sign(-dz * (target.x - kp.x) + dx * (target.z - kp.z)) || (Math.random() < 0.5 ? 1 : -1);
            t.detour = t.stuckFlip ? -side : side;
            t.stuckFlip = !t.stuckFlip && t.bot!.moved < s * 0.05;
            t.detourT = 0.7;
          }
          t.kid.face(target.x, target.z, dt);
          t.kid.mode = 'run';
          t.kid.speed = speed;
        } else {
          t.kid.mode = 'idle';
          t.kid.speed = 0;
          t.kid.face(target.x, target.z, dt);
        }
      }
      if (!target || Math.hypot(target.x - kp.x, target.z - kp.z) <= (prey ? 0.05 : 0.3)) t.bot!.move(0, 0, dt);
    }
  }

  /** Host: read the bots' resolved positions after the physics step. */
  postPhysics(): void {
    if (!this.running || !this.isHost) return;
    for (const t of this.tayas) {
      if (!t.bot) continue;
      t.bot.sync();
      const p = t.bot.position;
      // keep the taya near the chalk area (soft leash, it never needs to leave)
      if (p.x < BOUNDS.minX - 0.6 || p.x > BOUNDS.maxX + 0.6 || p.z < BOUNDS.minZ - 0.6 || p.z > BOUNDS.maxZ + 0.6) {
        t.bot.teleport(THREE.MathUtils.clamp(p.x, BOUNDS.minX, BOUNDS.maxX), THREE.MathUtils.clamp(p.z, BOUNDS.minZ, BOUNDS.maxZ));
      }
      t.kid.root.position.copy(t.bot.position);
    }
  }

  private hostEnd(): void {
    this.hostDone = true;
    this.sendSnap();
    const rows: EndRow[] = [...this.parts.values()].map((p) => {
      const full = p.state === 'play';
      const secs = Math.floor(Math.min(TIME, p.survived));
      return {
        id: p.id,
        score: secs * 2 + p.hops + (full ? 40 : 0),
        won: full,
        lines: [L(`Tumagal: ${secs}s / ${TIME}s`, `Survived: ${secs}s / ${TIME}s`), L(`Lipat-langit: ${p.hops}`, `Spot changes: ${p.hops}`), full ? L('Hindi ka nahuli! +40', 'Never caught! +40') : L('Nahuli ka. Ulitin mo!', 'You got caught. Try again!')],
      };
    });
    this.endWith(rows);
  }

  protected finishMine(mine: EndRow, won: boolean, ranking: string[]): void {
    this.running = false;
    this.ctx.player.moveEnabled = false;
    this.ctx.hud.setObjective('');
    this.ctx.hud.setBig(null);
    const secs = mine.lines[0]?.match(/\d+/)?.[0] ?? '0';
    this.ctx.finish({
      gameName: this.name,
      score: mine.score,
      scoreLabel: L('puntos', 'points'),
      points: mine.score,
      won,
      lines: [...mine.lines, ...ranking],
      shareText: mine.won
        ? L(`Hindi ako nahuli sa Langit-Lupa, ${mine.score} puntos sa Hari ng Kanto!`, `Nobody caught me in Langit-Lupa, ${mine.score} points on Hari ng Kanto!`)
        : L(`Tumagal ako nang ${secs}s sa Langit-Lupa sa Hari ng Kanto!`, `I lasted ${secs}s in Langit-Lupa on Hari ng Kanto!`),
    });
  }
}

