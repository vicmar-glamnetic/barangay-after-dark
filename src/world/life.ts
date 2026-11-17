import * as THREE from 'three';
import { L } from '../core/i18n';
import type { AudioSys } from '../core/audio';
import { Kid, type KidLook } from './npcs';
import type { BlobShadows } from './shadows';
import { FONT } from './textures';

/*
 * Barangay life: the people and animals that make the hub feel lived in.
 *  - Chismisan: three titas around a plastic table, gossiping in speech
 *    bubbles when you walk near (Filipino or English)
 *  - A tanod on duty at the outpost by the arch
 *  - Askal (stray dogs) asleep by the store bench and the waiting shed
 *  - Chickens pecking around the bamboo coop
 * Purely decorative: no physics, no game logic.
 */

const CHISMIS = new THREE.Vector3(-15.5, 0, -6.35);
const BUBBLE_RANGE = 13;

const GOSSIP: [string, string][] = [
  ['Uy, nakita mo ba ang bagong kotse nila?', 'Did you see their brand-new car?'],
  ['Kaloka! Nag-away na naman daw sila kagabi.', 'Unbelievable! They fought again last night.'],
  ['Ang mahal na ng bigas, ano?', 'Rice is so expensive now, isn’t it?'],
  ['Sino ba ’yung bagong boyfriend ni Inday?', 'Who’s Inday’s new boyfriend, anyway?'],
  ['Talaga? Sinong nagsabi sa ’yo?', 'Really? Who told you that?'],
  ['Sshh! Andiyan na siya, andiyan na!', 'Shh! Here she comes, here she comes!'],
  ['Hay naku, ’yung anak ni Kumare...', 'Oh my, Kumare’s kid again...'],
  ['Pumayat ka yata? Ano’ng sikreto mo?', 'You lost weight? What’s your secret?'],
  ['May utang pa ’yon kay Aling Nena, ha.', 'He still owes Aling Nena money, you know.'],
  ['Kanino ka boboto sa liga, kay Totoy?', 'Who are you cheering for in the liga, Totoy?'],
  ['Ang ingay ng videoke kagabi, ’di ako nakatulog!', 'That videoke kept me up all night!'],
  ['Hindi ako tsismosa, ha. Nagkukwento lang.', 'I’m not a gossip, okay. I’m just sharing.'],
];

interface Tita {
  kid: Kid;
  bubble: THREE.Sprite;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  line: number;
}

interface Chicken {
  root: THREE.Group;
  head: THREE.Group;
  home: THREE.Vector3;
  target: THREE.Vector3;
  wait: number;
  peck: number;
}

const TITA_LOOKS: KidLook[] = [
  { shirt: 0xf28482, shorts: 0x4a4e69, skin: 0xd29a6a, hair: 0x241a12, girl: true, slipper: 0xe63946, hairStyle: 2 },
  { shirt: 0x90be6d, shorts: 0x6c584c, skin: 0xb5764a, hair: 0x161210, girl: true, slipper: 0x1f6fb2, hairStyle: 1 },
  { shirt: 0xc77dff, shorts: 0x2b2d42, skin: 0xc68642, hair: 0x3a2a1a, girl: true, slipper: 0xffb703, hairStyle: 0 },
];

export class BarangayLife {
  private titas: Tita[] = [];
  private tanod: Kid;
  private dogs: { root: THREE.Group; body: THREE.Mesh; phase: number }[] = [];
  private chickens: Chicken[] = [];
  private talkT = 1.5;
  private talker = 0;
  private near = false;

  constructor(private scene: THREE.Scene, blobs: BlobShadows, private audio?: AudioSys) {
    // ---- the titas, standing around the chismisan table
    const spots: [number, number][] = [[-16.45, -6.55], [-14.55, -6.65], [-15.4, -5.5]];
    spots.forEach(([x, z], i) => {
      const kid = new Kid(TITA_LOOKS[i]);
      kid.root.scale.setScalar(1.3);
      kid.root.position.set(x, 0, z);
      kid.face(CHISMIS.x, CHISMIS.z);
      kid.mode = i === 1 ? 'wave' : 'idle'; // one is always waving her pamaypay
      scene.add(kid.root);
      kid.addShadow(blobs);
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 160;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      // dimmed (like the game labels) so the night glow/bloom never washes the text out
      const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xb4b4b4, depthWrite: false, fog: false, transparent: true, toneMapped: false }));
      bubble.scale.set(2.0, 0.625, 1);
      bubble.center.set(0.5, 0);
      bubble.position.set(x, 2.25, z);
      bubble.renderOrder = 6;
      bubble.visible = false;
      scene.add(bubble);
      this.titas.push({ kid, bubble, canvas, tex, line: -1 });
    });

    // ---- tanod on duty in front of the outpost
    this.tanod = new Kid({ shirt: 0x1d4e89, shorts: 0x1b1b1f, skin: 0xb5764a, hair: 0x161210, girl: false, slipper: 0x111111, shirtStyle: 2 });
    this.tanod.root.scale.setScalar(1.3);
    this.tanod.root.position.set(26.6, 0, -5.4);
    this.tanod.face(20, -2);
    this.tanod.mode = 'idle';
    scene.add(this.tanod.root);
    this.tanod.addShadow(blobs);

    // ---- askal: sleeping dogs
    for (const [x, z, rot, col] of [[3.0, -6.55, 0.6, 0xb08050], [-4.9, -4.45, -1.2, 0x2b2b2b], [-26.3, -5.7, 2.4, 0xd9c4a0]] as const) {
      const dog = this.makeDog(col);
      dog.root.position.set(x, 0, z);
      dog.root.rotation.y = rot;
      scene.add(dog.root);
      blobs.add(dog.root, 0.55);
      this.dogs.push({ ...dog, phase: x });
    }

    // ---- chickens around the coop
    const home = new THREE.Vector3(-9.6, 0, 23.4);
    for (let i = 0; i < 4; i++) {
      const c = this.makeChicken(i === 0);
      c.root.position.set(home.x + Math.cos(i * 1.7) * 0.9, 0, home.z + Math.sin(i * 1.7) * 0.7);
      scene.add(c.root);
      blobs.add(c.root, 0.22);
      this.chickens.push({ ...c, home, target: c.root.position.clone(), wait: Math.random() * 2, peck: 0 });
    }
  }

  // ================================================================== builders

  private makeDog(color: number): { root: THREE.Group; body: THREE.Mesh } {
    const mat = new THREE.MeshLambertMaterial({ color });
    const dark = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.6) });
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.6), mat);
    body.position.set(0, 0.11, 0);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.2), mat);
    head.position.set(0.04, 0.09, 0.38);
    head.rotation.y = 0.35;
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.1), dark);
    snout.position.set(0.07, 0.07, 0.52);
    const earL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.05), dark);
    earL.position.set(-0.04, 0.18, 0.36);
    const earR = earL.clone();
    earR.position.x = 0.12;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.25), mat);
    tail.position.set(-0.12, 0.05, -0.36);
    tail.rotation.y = -0.8;
    for (const [x, z] of [[0.14, 0.2], [0.14, -0.18]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.07), dark);
      leg.position.set(x + 0.08, 0.03, z);
      root.add(leg);
    }
    root.add(body, head, snout, earL, earR, tail);
    return { root, body };
  }

  private makeChicken(rooster: boolean): { root: THREE.Group; head: THREE.Group } {
    const root = new THREE.Group();
    const feather = new THREE.MeshLambertMaterial({ color: rooster ? 0x8b3a1a : [0xf5f0e6, 0xc8955a, 0x6b4226][Math.floor(Math.random() * 3)] });
    const red = new THREE.MeshLambertMaterial({ color: 0xd62828 });
    const yellow = new THREE.MeshLambertMaterial({ color: 0xf2b134 });
    const s = rooster ? 1.25 : 1;
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11 * s, 0), feather);
    body.scale.set(0.9, 0.85, 1.25);
    body.position.y = 0.17 * s;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.06 * s, 0.16 * s, 5), rooster ? new THREE.MeshLambertMaterial({ color: 0x1b4332 }) : feather);
    tail.position.set(0, 0.25 * s, -0.12 * s);
    tail.rotation.x = -0.6;
    const head = new THREE.Group();
    head.position.set(0, 0.27 * s, 0.1 * s);
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05 * s, 0), feather);
    const comb = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.05 * s, 0.06 * s), red);
    comb.position.set(0, 0.05 * s, 0);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.05, 4).rotateX(Math.PI / 2), yellow);
    beak.position.set(0, -0.005, 0.055 * s);
    head.add(skull, comb, beak);
    for (const x of [-0.035, 0.035]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1 * s, 4), yellow);
      leg.position.set(x, 0.05 * s, 0);
      root.add(leg);
    }
    root.add(body, tail, head);
    return { root, head };
  }

  // ================================================================== per frame

  update(dt: number, t: number, cam: THREE.Vector3): void {
    // titas: animate always (they're in view from the road); talk only when you're near
    for (const ti of this.titas) ti.kid.update(dt, t);
    this.tanod.update(dt, t);
    const near = Math.hypot(cam.x - CHISMIS.x, cam.z - CHISMIS.z) < BUBBLE_RANGE;
    if (near !== this.near) {
      this.near = near;
      if (!near) for (const ti of this.titas) ti.bubble.visible = false;
      this.talkT = 0.4;
    }
    if (near) {
      this.talkT -= dt;
      if (this.talkT <= 0) {
        this.talkT = 3.2 + Math.random() * 1.2;
        for (const ti of this.titas) ti.bubble.visible = false;
        this.talker = (this.talker + 1 + Math.floor(Math.random() * 2)) % this.titas.length;
        const ti = this.titas[this.talker];
        this.say(ti);
        // only voiced when you're really standing with them
        if (Math.hypot(cam.x - CHISMIS.x, cam.z - CHISMIS.z) < 7) this.audio?.speak('tita', GOSSIP[ti.line][0], GOSSIP[ti.line][1], { vol: 0.7 });
      }
    }

    // dogs: slow sleepy breathing
    for (const d of this.dogs) {
      const k = 1 + Math.sin(t * 1.6 + d.phase) * 0.06;
      d.body.scale.set(k, k, 1);
    }

    // chickens: wander a little, stop, peck
    for (const c of this.chickens) {
      const p = c.root.position;
      if (c.wait > 0) {
        c.wait -= dt;
        c.peck += dt * 9;
        c.head.rotation.x = Math.max(0, Math.sin(c.peck)) * 0.9;
        if (c.wait <= 0) {
          c.target.set(c.home.x + (Math.random() - 0.5) * 2.4, 0, c.home.z + (Math.random() - 0.5) * 1.8);
          c.head.rotation.x = 0;
        }
      } else {
        const dx = c.target.x - p.x, dz = c.target.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.05) c.wait = 1 + Math.random() * 3;
        else {
          const step = Math.min(d, dt * 0.55);
          p.x += (dx / d) * step;
          p.z += (dz / d) * step;
          c.root.rotation.y = Math.atan2(dx, dz);
          p.y = Math.abs(Math.sin(t * 16)) * 0.02; // little hops
        }
      }
    }
  }

  /** Draw a new gossip line in a tita's speech bubble. */
  private say(ti: Tita): void {
    let n = Math.floor(Math.random() * GOSSIP.length);
    if (n === ti.line) n = (n + 1) % GOSSIP.length;
    ti.line = n;
    const text = L(GOSSIP[n][0], GOSSIP[n][1]);
    const g = ti.canvas.getContext('2d')!;
    const W = ti.canvas.width, H = ti.canvas.height;
    g.clearRect(0, 0, W, H);
    g.font = `800 33px ${FONT}`;
    // wrap into at most two lines
    const words = text.split(' ');
    const lines: string[] = [''];
    for (const w of words) {
      const tryLine = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w;
      if (g.measureText(tryLine).width > W - 60 && lines[lines.length - 1] && lines.length < 2) lines.push(w);
      else lines[lines.length - 1] = tryLine;
    }
    const bw = Math.min(W - 8, Math.max(...lines.map((l) => g.measureText(l).width)) + 44);
    const bh = lines.length * 38 + 26;
    const x = (W - bw) / 2, y = H - bh - 26;
    g.fillStyle = '#efe6cf'; // paper, not pure white
    g.strokeStyle = '#1a1230';
    g.lineWidth = 4;
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, bw, bh, 22);
    else g.rect(x, y, bw, bh);
    g.moveTo(W / 2 - 14, y + bh);
    g.lineTo(W / 2, H - 4);
    g.lineTo(W / 2 + 14, y + bh);
    g.fill();
    g.stroke();
    g.fillStyle = '#120c24';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, W / 2, y + 13 + 19 + i * 38, W - 40));
    ti.tex.needsUpdate = true;
    ti.bubble.visible = true;
  }

  dispose(): void {
    for (const ti of this.titas) {
      ti.kid.dispose();
      this.scene.remove(ti.bubble);
    }
  }
}
