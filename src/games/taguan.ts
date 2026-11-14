import * as THREE from 'three';
import { RAPIER } from '../core/physics';
import { Kid } from '../world/npcs';
import { BaseGame } from './baseGame';
import type { HubLayout } from './types';

/*
 * TAGUAN (Hide and Seek)
 *
 * You are the seeker. Face the wall and count to ten while the screen is dark,
 * then find the 4 hidden kids within 90 seconds. Hidden kids giggle and
 * shuffle now and then; the sounds are positional, so they get louder and
 * pan toward the kid as you get close. A kid is found when you are close,
 * looking at them, and nothing solid is in between.
 *
 * Score: +25 per kid found, +1 per second left when all 4 are found.
 */

/** Spots where a kid can crouch. Checked against the map layout in world/barangay.ts. */
export const HIDING_SPOTS: [number, number][] = [
  [-4.7, -16.3], // behind the water drums
  [0.3, -18.0], // behind the crate, by the back house
  [3.1, -15.1], // behind the potted plant
  [10.0, -12.0], // gap between the store and the pink house
  [18.85, -11.5], // gap between the pink house and the videoke house
  [-11.85, -12.5], // narrow alley by the yellow house
  [-19.4, -11.5], // alley between the two west houses
  [-13.5, -17.3], // behind the sampayan
  [-2.2, -6.9], // behind the waiting shed
  [-6.5, 3.25], // behind the red jeepney
  [17.5, -3.3], // behind the blue jeepney
  [-28.6, -10.5], // between the corner house and the fence
  [10.4, -15.8], // behind the plant at the pink house
  [-25.9, 24.0], // behind the acacia trunk
];

const BASE = new THREE.Vector3(2.4, 0, -11.2); // the counting wall (sari-sari side wall)
const HIDERS = 4;
const TIME = 90;
const FIND_DIST = 2.3;
const COUNT = ['Isa...', 'Dalawa...', 'Tatlo...', 'Apat...', 'Lima...', 'Anim...', 'Pito...', 'Walo...', 'Siyam...', 'Sampu!'];

type Phase = 'count' | 'seek' | 'done';

interface Hider {
  kid: Kid;
  found: boolean;
  nextSound: number;
  /** After being found: walk back to the base. */
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
      { x: 2.9, z: -11.2, faceX: 10, faceZ: -11.2, mode: 'count' }, // the "it", counting at the wall
      { x: 0.6, z: -11.6, mode: 'wave' },
      { x: -1.9, z: -11.0, mode: 'idle' },
    ],
  };

  private extras: Kid[] = [];
  private hiders: Hider[] = [];
  private phase: Phase = 'done';
  private countT = 0;
  private countI = 0;
  private time = TIME;
  private found = 0;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });

  start(): void {
    const { scene, blobs, player, hud, touch, overlays } = this.ctx;
    while (this.group.kids.length + this.extras.length < HIDERS) {
      const k = new Kid();
      scene.add(k.root);
      k.addShadow(blobs);
      this.extras.push(k);
    }
    const kids = [...this.group.kids, ...this.extras].slice(0, HIDERS);
    // pick distinct random spots
    const spots = HIDING_SPOTS.map((s) => ({ s, r: Math.random() })).sort((a, b) => a.r - b.r).slice(0, HIDERS).map((o) => o.s);
    this.hiders = kids.map((kid, i) => {
      const [x, z] = spots[i];
      kid.root.position.set(x, 0, z);
      kid.face(BASE.x, BASE.z);
      kid.mode = 'crouch';
      kid.root.visible = false; // revealed when counting is over
      return { kid, found: false, nextSound: 2 + Math.random() * 3, home: new THREE.Vector3(BASE.x - 1.2 - i * 0.8, 0, BASE.z + 1.4) };
    });

    player.teleport(BASE.x - 1.1, 0, BASE.z, -Math.PI / 2, 0);
    player.moveEnabled = false;
    player.lookEnabled = false;
    this.phase = 'count';
    this.countT = 0.3;
    this.countI = -1;
    this.time = TIME;
    this.found = 0;
    touch.setActionLabel('Hanap');
    hud.setObjective('Magbilang ka hanggang sampu...');
    hud.setCrosshair(true);
    overlays.fade(true, '');
  }

  stop(): void {
    for (const k of this.extras) k.dispose();
    this.extras = [];
    this.hiders = [];
    this.phase = 'done';
    const { player, hud, overlays } = this.ctx;
    player.moveEnabled = true;
    player.lookEnabled = true;
    overlays.fade(false);
    hud.clearGameWidgets();
  }

  update(dt: number): void {
    const { player, hud, audio, overlays } = this.ctx;
    if (this.phase === 'done') return;

    if (this.phase === 'count') {
      this.countT -= dt;
      if (this.countT <= 0) {
        this.countI++;
        if (this.countI < COUNT.length) {
          overlays.fade(true, COUNT[this.countI]);
          audio.play('tick');
          // scatter sounds while they run off to hide
          if (this.countI < 6 && Math.random() < 0.6) {
            const h = this.hiders[Math.floor(Math.random() * this.hiders.length)];
            audio.play(Math.random() < 0.5 ? 'giggle' : 'step', { pos: h.kid.root.position, vol: 0.8 });
          }
          this.countT = 0.6;
        } else {
          overlays.fade(false);
          for (const h of this.hiders) h.kid.root.visible = true;
          player.moveEnabled = true;
          player.lookEnabled = true;
          this.phase = 'seek';
          hud.toast('Handa na! Hanap!', 'good', 1300);
          hud.setObjective('Hanapin ang 4 na batang nagtatago! Pakinggan ang mga hagikgik.');
        }
      }
      return;
    }

    // --- seeking
    this.time -= dt;
    if (this.time <= 0) {
      this.time = 0;
      hud.toast('Ubos ang oras!', 'bad', 1400);
      this.end();
      return;
    }

    const cam = this.ctx.camera;
    cam.getWorldDirection(_f);
    let nearest = Infinity;
    for (const h of this.hiders) {
      const kp = h.kid.root.position;
      if (h.found) {
        // jog back to base and wait there
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
        continue;
      }
      const dist = Math.hypot(kp.x - player.position.x, kp.z - player.position.z);
      nearest = Math.min(nearest, dist);

      // proximity sounds: more often when closer
      h.nextSound -= dt;
      if (h.nextSound <= 0) {
        if (dist < 26) audio.play(Math.random() < 0.65 ? 'giggle' : 'step', { pos: _d.set(kp.x, 0.8, kp.z), vol: 1.1 });
        h.nextSound = 1.2 + Math.min(6, dist * 0.22) + Math.random() * 1.5;
      }

      // found? close + looking at them + line of sight
      if (dist < FIND_DIST) {
        _d.set(kp.x, 0.55, kp.z).sub(cam.position);
        const len = _d.length();
        _d.normalize();
        if (_d.dot(_f) > 0.55 && this.clearLine(cam.position, _d, len)) this.markFound(h);
      }
    }

    const warmth = nearest < 4 ? 'Mainit na!' : nearest < 9 ? 'Malapit-lapit...' : nearest < Infinity ? 'Malamig pa.' : '';
    hud.setStat(`Nakita: ${this.found}/${HIDERS}   ${warmth}`);
    hud.setTimer(String(Math.ceil(this.time)));
  }

  /** True if no static collider blocks the segment from `from` along `dir` for `len` meters. */
  private clearLine(from: THREE.Vector3, dir: THREE.Vector3, len: number): boolean {
    this.ray.origin = { x: from.x, y: from.y, z: from.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.ctx.physics.world.castRay(this.ray, len - 0.35, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
    return !hit;
  }

  private markFound(h: Hider): void {
    const { hud, audio } = this.ctx;
    h.found = true;
    this.found++;
    h.kid.mode = 'cheer';
    audio.play('giggle', { pos: h.kid.root.position, vol: 1.4 });
    audio.play('pickup');
    hud.toast(this.found < HIDERS ? `Nakita kita! ${this.found}/${HIDERS}` : 'Nahanap mo lahat!', 'good', 1200);
    if (this.found >= HIDERS) this.end();
  }

  private end(): void {
    this.phase = 'done';
    const won = this.found >= HIDERS;
    const timeLeft = Math.floor(this.time);
    const score = this.found * 25 + (won ? timeLeft : 0);
    this.ctx.hud.setObjective('');
    this.ctx.finish({
      gameName: this.name,
      score,
      scoreLabel: 'puntos',
      points: score,
      won,
      lines: [
        `Nakita: ${this.found}/${HIDERS}`,
        won ? `Oras na natira: ${timeLeft}s` : 'May nagtatago pa! Ulitin mo.',
      ],
      shareText: won
        ? `Nahanap ko lahat sa Taguan na may ${timeLeft}s pa, ${score} puntos sa Barangay After Dark!`
        : `Nakita ko ang ${this.found} sa ${HIDERS} na nagtatago sa Barangay After Dark!`,
    });
  }
}
