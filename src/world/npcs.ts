import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { labelTexture, radialTexture } from './textures';
import type { BlobShadows } from './shadows';

export type KidMode = 'idle' | 'wave' | 'cheer' | 'run' | 'carry' | 'crouch' | 'count' | 'still' | 'guard';

export interface KidLook {
  shirt: number;
  shorts: number;
  skin: number;
  hair: number;
  girl: boolean;
  slipper: number;
}

const SHIRTS = [0xe63946, 0xf4a261, 0x2a9d8f, 0xe9c46a, 0x457b9d, 0xf1faee, 0x9b5de5, 0x00bbf9, 0xfb5607, 0x8ac926];
const SHORTS = [0x264653, 0x1d3557, 0x6c584c, 0x3a3a3a, 0x5e548e, 0x2b2d42];
const SKINS = [0xc68642, 0xb5764a, 0xd29a6a, 0x9e6440, 0xe0ac7e];
const SLIPPERS = [0x1f6fb2, 0xe63946, 0x2a9d8f, 0xffb703, 0x111111];

let seedCounter = 7;
const rnd = () => {
  seedCounter = (seedCounter * 9301 + 49297) % 233280;
  return seedCounter / 233280;
};
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];

export function randomLook(): KidLook {
  return { shirt: pick(SHIRTS), shorts: pick(SHORTS), skin: pick(SKINS), hair: 0x161210, girl: rnd() < 0.45, slipper: pick(SLIPPERS) };
}

/** Merge several colored primitives into one geometry with a vertex color attribute. */
function painted(parts: [THREE.BufferGeometry, number][]): THREE.BufferGeometry {
  const gs = parts.map(([g, hex]) => {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const n of Object.keys(ng.attributes)) if (n !== 'position' && n !== 'normal') ng.deleteAttribute(n);
    const c = new THREE.Color(hex);
    const cols = new Float32Array(ng.getAttribute('position').count * 3);
    for (let i = 0; i < cols.length; i += 3) cols.set([c.r, c.g, c.b], i);
    ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return ng;
  });
  const m = mergeGeometries(gs, false)!;
  m.computeBoundingSphere();
  return m;
}

const kidMat = new THREE.MeshLambertMaterial({ vertexColors: true });

/**
 * Stylized low-poly kid (~1.25 m). Five meshes: body (torso+head+hair merged),
 * two arms and two legs, each pivoting at the joint.
 */
export class Kid {
  readonly root = new THREE.Group();
  readonly armL = new THREE.Group();
  readonly armR = new THREE.Group();
  readonly legL = new THREE.Group();
  readonly legR = new THREE.Group();
  private body: THREE.Mesh;
  mode: KidMode = 'idle';
  /** Horizontal speed (m/s); drives the run cycle. */
  speed = 0;
  phase = Math.random() * 10;
  private removeShadow?: () => void;

  constructor(readonly look: KidLook = randomLook()) {
    const L = look;
    const parts: [THREE.BufferGeometry, number][] = [
      [new THREE.BoxGeometry(0.36, 0.42, 0.22).translate(0, 0.76, 0), L.shirt],
      [new THREE.BoxGeometry(0.1, 0.06, 0.1).translate(0, 1.0, 0), L.skin],
      [new THREE.SphereGeometry(0.17, 9, 7).translate(0, 1.14, 0), L.skin],
      [new THREE.SphereGeometry(0.18, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(0, 1.16, -0.01), L.hair],
      [new THREE.BoxGeometry(0.045, 0.05, 0.02).translate(-0.06, 1.16, 0.162), 0x111111],
      [new THREE.BoxGeometry(0.045, 0.05, 0.02).translate(0.06, 1.16, 0.162), 0x111111],
      [new THREE.BoxGeometry(0.08, 0.02, 0.02).translate(0, 1.07, 0.163), 0x7a2e2e],
      [new THREE.BoxGeometry(0.37, 0.08, 0.23).translate(0, 0.58, 0), L.shorts],
    ];
    if (L.girl) {
      parts.push([new THREE.BoxGeometry(0.32, 0.3, 0.1).translate(0, 1.05, -0.12), L.hair]);
      parts.push([new THREE.SphereGeometry(0.06, 6, 4).translate(0, 1.22, -0.17), 0xff4f9a]);
    }
    this.body = new THREE.Mesh(painted(parts), kidMat);
    this.root.add(this.body);

    const armGeo = painted([
      [new THREE.BoxGeometry(0.12, 0.15, 0.13).translate(0, -0.07, 0), L.shirt],
      [new THREE.BoxGeometry(0.09, 0.32, 0.09).translate(0, -0.29, 0), L.skin],
    ]);
    const legGeo = painted([
      [new THREE.BoxGeometry(0.15, 0.2, 0.16).translate(0, -0.1, 0), L.shorts],
      [new THREE.BoxGeometry(0.11, 0.33, 0.11).translate(0, -0.36, 0), L.skin],
      [new THREE.BoxGeometry(0.13, 0.03, 0.23).translate(0, -0.535, 0.03), L.slipper],
    ]);
    for (const [g, x] of [[this.armL, 0.235], [this.armR, -0.235]] as [THREE.Group, number][]) {
      g.position.set(x, 0.95, 0);
      g.add(new THREE.Mesh(armGeo, kidMat));
      this.root.add(g);
    }
    for (const [g, x] of [[this.legL, 0.09], [this.legR, -0.09]] as [THREE.Group, number][]) {
      g.position.set(x, 0.55, 0);
      g.add(new THREE.Mesh(legGeo, kidMat));
      this.root.add(g);
    }
  }

  addShadow(blobs: BlobShadows): void {
    this.removeShadow?.();
    this.removeShadow = blobs.add(this.root, 0.75);
  }

  dispose(): void {
    this.removeShadow?.();
    this.root.removeFromParent();
  }

  /** Turn to face a world point on the XZ plane. Smooth when dt is given. */
  face(x: number, z: number, dt = 0): void {
    const target = Math.atan2(x - this.root.position.x, z - this.root.position.z);
    if (!dt) {
      this.root.rotation.y = target;
      return;
    }
    let d = target - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * Math.min(1, dt * 10);
  }

  update(dt: number, t: number): void {
    const b = this.body;
    let bob = 0;
    let armL = 0, armR = 0, armLz = 0, armRz = 0, legL = 0, legR = 0, lean = 0;
    const p = t * 2 + this.phase;
    switch (this.mode) {
      case 'idle':
        bob = Math.sin(p * 1.5) * 0.015;
        armL = Math.sin(p) * 0.08;
        armR = -Math.sin(p) * 0.08;
        armLz = 0.08;
        armRz = -0.08;
        break;
      case 'wave':
        bob = Math.sin(p * 2) * 0.02;
        armRz = -2.6 + Math.sin(t * 9 + this.phase) * 0.35;
        armLz = 0.1;
        break;
      case 'cheer': {
        const j = Math.abs(Math.sin(t * 6 + this.phase));
        bob = j * 0.12;
        armLz = 2.5 + Math.sin(t * 12) * 0.2;
        armRz = -2.5 - Math.sin(t * 12) * 0.2;
        break;
      }
      case 'run': {
        this.phase += dt * (4 + this.speed * 2.2);
        const s = Math.sin(this.phase);
        const amp = Math.min(1, this.speed / 4) * 0.9;
        legL = s * amp;
        legR = -s * amp;
        armL = -s * amp * 0.9;
        armR = s * amp * 0.9;
        bob = Math.abs(Math.cos(this.phase)) * 0.06 * Math.min(1, this.speed / 3);
        lean = Math.min(0.25, this.speed * 0.04);
        break;
      }
      case 'carry': {
        this.phase += dt * (4 + this.speed * 2);
        const s = Math.sin(this.phase);
        legL = s * 0.5;
        legR = -s * 0.5;
        armL = armR = -1.2;
        break;
      }
      case 'crouch':
        bob = -0.18;
        legL = legR = -0.6;
        armL = armR = -0.9;
        lean = 0.35;
        break;
      case 'count':
        // face covered, counting against a wall
        armL = armR = -2.2;
        armLz = -0.35;
        armRz = 0.35;
        bob = Math.sin(p) * 0.01;
        lean = 0.15;
        break;
      case 'guard': {
        // Patintero tagger: arms stretched out, legs shuffling when moving
        this.phase += dt * (3 + this.speed * 2.5);
        const s = Math.sin(this.phase) * Math.min(1, this.speed / 3) * 0.5;
        armLz = 1.35;
        armRz = -1.35;
        legL = s;
        legR = -s;
        bob = -0.04 + Math.abs(Math.cos(this.phase)) * 0.03 * Math.min(1, this.speed);
        lean = 0.12;
        break;
      }
      case 'still':
        break;
    }
    b.position.y = bob;
    b.rotation.x = lean;
    this.armL.position.y = this.armR.position.y = 0.95 + bob;
    const k = Math.min(1, dt * 14);
    this.armL.rotation.x += (armL - this.armL.rotation.x) * k;
    this.armR.rotation.x += (armR - this.armR.rotation.x) * k;
    this.armL.rotation.z += (armLz - this.armL.rotation.z) * k;
    this.armR.rotation.z += (armRz - this.armR.rotation.z) * k;
    this.legL.rotation.x += (legL - this.legL.rotation.x) * k;
    this.legR.rotation.x += (legR - this.legR.rotation.x) * k;
  }
}

export interface KidPlacement {
  x: number;
  z: number;
  /** Face this point; defaults to the group spot. */
  faceX?: number;
  faceZ?: number;
  mode?: KidMode;
  y?: number;
}

const ringTex = radialTexture('rgba(255,255,255,0)', 'rgba(255,255,255,0)', 128, [
  [0.72, 'rgba(255,255,255,0)'],
  [0.86, 'rgba(255,255,255,0.9)'],
  [0.95, 'rgba(255,255,255,0)'],
]);

/**
 * A group of kids at a game spot, with a floating label and a pulsing ground
 * ring that marks where to stand to interact.
 */
export class NpcGroup {
  readonly kids: Kid[] = [];
  readonly label: THREE.Sprite;
  private labelTex: THREE.CanvasTexture;
  private ring: THREE.Mesh;
  private home: KidPlacement[];

  constructor(
    private scene: THREE.Scene,
    readonly spot: THREE.Vector3,
    placements: KidPlacement[],
    labelPos: THREE.Vector3,
    blobs: BlobShadows,
    groundAt: (x: number, z: number) => number,
  ) {
    this.home = placements;
    for (const pl of placements) {
      const k = new Kid();
      k.root.position.set(pl.x, pl.y ?? groundAt(pl.x, pl.z), pl.z);
      k.face(pl.faceX ?? spot.x, pl.faceZ ?? spot.z);
      k.mode = pl.mode ?? 'idle';
      scene.add(k.root);
      k.addShadow(blobs);
      this.kids.push(k);
    }
    const { tex, aspect } = labelTexture('...', '...', '#ffd166');
    this.labelTex = tex;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, transparent: true }));
    this.label.scale.set(1.15 * aspect, 1.15, 1);
    this.label.position.copy(labelPos);
    this.label.renderOrder = 5;
    scene.add(this.label);

    this.ring = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 3.6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: ringTex, color: 0xffd166, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    );
    this.ring.position.set(spot.x, groundAt(spot.x, spot.z) + 0.04, spot.z);
    scene.add(this.ring);
  }

  setLabel(title: string, sub: string, accent: string): void {
    labelTexture(title, sub, accent, this.labelTex);
    (this.ring.material as THREE.MeshBasicMaterial).color.set(accent);
  }

  /** Hide label + ring while this group's game is running. */
  setHubVisible(v: boolean): void {
    this.label.visible = v;
    this.ring.visible = v;
  }

  /** Put every kid back where they stand in the hub. */
  resetToHome(groundAt: (x: number, z: number) => number): void {
    this.kids.forEach((k, i) => {
      const pl = this.home[i];
      k.root.position.set(pl.x, pl.y ?? groundAt(pl.x, pl.z), pl.z);
      k.face(pl.faceX ?? this.spot.x, pl.faceZ ?? this.spot.z);
      k.mode = pl.mode ?? 'idle';
      k.speed = 0;
      k.root.visible = true;
    });
  }

  update(dt: number, t: number, camPos: THREE.Vector3): void {
    for (const k of this.kids) k.update(dt, t);
    const d = camPos.distanceTo(this.label.position);
    const m = this.label.material as THREE.SpriteMaterial;
    m.opacity = THREE.MathUtils.clamp(1.4 - d / 30, 0, 1);
    this.label.position.y += Math.sin(t * 2 + this.spot.x) * 0.0015;
    const rm = this.ring.material as THREE.MeshBasicMaterial;
    rm.opacity = 0.35 + Math.sin(t * 3) * 0.2;
  }
}
