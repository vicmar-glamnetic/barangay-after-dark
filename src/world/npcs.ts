import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LABEL_ANCHOR_Y, LABEL_H, labelTexture, radialTexture } from './textures';
import type { BlobShadows } from './shadows';

export type KidMode = 'idle' | 'wave' | 'cheer' | 'run' | 'carry' | 'crouch' | 'count' | 'still' | 'guard' | 'baka';

export interface KidLook {
  shirt: number;
  shorts: number;
  skin: number;
  hair: number;
  girl: boolean;
  slipper: number;
  /** Hair style 0-2 and shirt style 0-2 (plain, stripe, jersey number). */
  hairStyle?: number;
  shirtStyle?: number;
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
  return { shirt: pick(SHIRTS), shorts: pick(SHORTS), skin: pick(SKINS), hair: 0x161210, girl: rnd() < 0.45, slipper: pick(SLIPPERS), hairStyle: Math.floor(rnd() * 3), shirtStyle: Math.floor(rnd() * 3) };
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

let faceGeo: THREE.BufferGeometry | null = null;
/** Front cap of a sphere just outside the head, with flat (planar) UVs so a square picture maps straight on. */
function faceGeometry(): THREE.BufferGeometry {
  if (faceGeo) return faceGeo;
  const R = 0.2; // just outside the drawn eyes, cheeks and mouth so they never poke through
  const g = new THREE.SphereGeometry(R, 16, 12, Math.PI / 2 - 1.05, 2.1, Math.PI / 2 - 1.05, 2.1);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const half = 0.16;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / (2 * half), 0.5 + pos.getY(i) / (2 * half));
  uv.needsUpdate = true;
  faceGeo = g;
  return g;
}

let maskTex: THREE.Texture | null = null;
/** Round mask so the square picture shows as a circle. */
function faceMask(): THREE.Texture {
  if (maskTex) return maskTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(32, 32, 31, 0, Math.PI * 2);
  g.fill();
  maskTex = new THREE.CanvasTexture(c);
  return maskTex;
}

/** Hip height: the body bone pivots here. */
const HIP = 0.55;

/** Bone indices in each kid's skeleton. */
const B_ROOT = 0, B_BODY = 1, B_ARM_L = 2, B_ARM_R = 3, B_LEG_L = 4, B_LEG_R = 5;

/** Like painted(), but also tags every vertex with a rigid bone index for skinning. */
function paintedSkinned(parts: [THREE.BufferGeometry, number, number][]): THREE.BufferGeometry {
  const gs = parts.map(([g, hex, bone]) => {
    const ng = painted([[g, hex]]);
    const n = ng.getAttribute('position').count;
    const idx = new Uint16Array(n * 4);
    const w = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      idx[i * 4] = bone;
      w[i * 4] = 1;
    }
    ng.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    ng.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
    return ng;
  });
  return mergeGeometries(gs, false)!;
}

/**
 * Stylized low-poly kid (~1.25 m), drawn as ONE skinned mesh (one draw call)
 * with a tiny rigid skeleton: body (torso+head+hair), two arms and two legs,
 * each bone pivoting at its joint.
 */
export class Kid {
  readonly root = new THREE.Group();
  readonly armL = new THREE.Bone();
  readonly armR = new THREE.Bone();
  readonly legL = new THREE.Bone();
  readonly legR = new THREE.Bone();
  private body = new THREE.Bone();
  mode: KidMode = 'idle';
  // idle fidgets: look around, scratch head, little hop
  private fidget: 'none' | 'look' | 'scratch' | 'hop' = 'none';
  private fidgetT = 2 + Math.random() * 5;
  private fidgetDur = 0;
  private lookDir = 1;
  /** Horizontal speed (m/s); drives the run cycle. */
  speed = 0;
  /** Luksong Baka: 0 (lowest) to 4 (tallest). */
  bakaLevel = 2;
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
    // rosy cheeks
    for (const sx of [-1, 1]) parts.push([new THREE.BoxGeometry(0.035, 0.022, 0.01).translate(sx * 0.1, 1.105, 0.155), 0xe08a7a]);
    const hs = L.hairStyle ?? 0;
    if (L.girl) {
      if (hs === 0) {
        // long hair + clip
        parts.push([new THREE.BoxGeometry(0.32, 0.3, 0.1).translate(0, 1.05, -0.12), L.hair]);
        parts.push([new THREE.SphereGeometry(0.06, 6, 4).translate(0, 1.22, -0.17), 0xff4f9a]);
      } else if (hs === 1) {
        // pigtails with ties
        for (const sx of [-1, 1]) {
          parts.push([new THREE.SphereGeometry(0.075, 7, 5).translate(sx * 0.2, 1.1, -0.04), L.hair]);
          parts.push([new THREE.SphereGeometry(0.03, 5, 4).translate(sx * 0.17, 1.15, -0.03), 0xffd166]);
        }
      } else {
        // ponytail
        parts.push([new THREE.CylinderGeometry(0.05, 0.03, 0.26, 6).translate(0, 1.05, -0.2), L.hair]);
        parts.push([new THREE.SphereGeometry(0.035, 5, 4).translate(0, 1.19, -0.18), 0x06d6a0]);
      }
    } else if (hs === 1) {
      // spiky
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push([new THREE.ConeGeometry(0.045, 0.1, 4).translate(Math.cos(a) * 0.09, 1.31, Math.sin(a) * 0.09 - 0.01), L.hair]);
      }
    } else if (hs === 2) {
      // cap, worn backwards
      parts.push([new THREE.SphereGeometry(0.185, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.42).translate(0, 1.17, -0.01), 0xe63946]);
      parts.push([new THREE.BoxGeometry(0.16, 0.02, 0.12).translate(0, 1.2, -0.2), 0xe63946]);
    }
    const ss = L.shirtStyle ?? 0;
    if (ss === 1) parts.push([new THREE.BoxGeometry(0.365, 0.06, 0.225).translate(0, 0.8, 0), 0xffffff]);
    if (ss === 2) parts.push([new THREE.BoxGeometry(0.12, 0.13, 0.01).translate(0, 0.79, 0.112), 0xffffff]);
    // Skeleton (rest pose): body pivots at the feet (lean), arms at the
    // shoulders, legs at the hips. All parts are baked into one geometry.
    const rootBone = new THREE.Bone();
    rootBone.add(this.body);
    this.body.position.set(0, HIP, 0); // pivot at the hips so the kid can bend over
    this.armL.position.set(0.235, 0.95 - HIP, 0);
    this.armR.position.set(-0.235, 0.95 - HIP, 0);
    this.body.add(this.armL, this.armR);
    this.legL.position.set(0.09, 0.55, 0);
    this.legR.position.set(-0.09, 0.55, 0);
    rootBone.add(this.legL, this.legR);

    const all: [THREE.BufferGeometry, number, number][] = parts.map(([g, c]) => [g, c, B_BODY]);
    for (const [bone, x] of [[B_ARM_L, 0.235], [B_ARM_R, -0.235]]) {
      all.push([new THREE.BoxGeometry(0.12, 0.15, 0.13).translate(x, 0.95 - 0.07, 0), L.shirt, bone]);
      all.push([new THREE.BoxGeometry(0.09, 0.32, 0.09).translate(x, 0.95 - 0.29, 0), L.skin, bone]);
    }
    for (const [bone, x] of [[B_LEG_L, 0.09], [B_LEG_R, -0.09]]) {
      all.push([new THREE.BoxGeometry(0.15, 0.2, 0.16).translate(x, 0.55 - 0.1, 0), L.shorts, bone]);
      all.push([new THREE.BoxGeometry(0.11, 0.33, 0.11).translate(x, 0.55 - 0.36, 0), L.skin, bone]);
      all.push([new THREE.BoxGeometry(0.13, 0.03, 0.23).translate(x, 0.55 - 0.535, 0.03), L.slipper, bone]);
    }
    const mesh = new THREE.SkinnedMesh(paintedSkinned(all), kidMat);
    mesh.add(rootBone);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton([rootBone, this.body, this.armL, this.armR, this.legL, this.legR]));
    // fixed culling sphere that covers raised arms and hops
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.75, 0), 1.15);
    void B_ROOT;
    this.root.add(mesh);
  }

  private faceMesh: THREE.Mesh | null = null;

  /**
   * Put a custom picture on the front of the head (a round "face sticker"
   * that follows the head). null removes it and shows the drawn face again.
   */
  setFace(tex: THREE.Texture | null): void {
    if (this.faceMesh) {
      this.faceMesh.removeFromParent();
      (this.faceMesh.material as THREE.Material).dispose();
      this.faceMesh = null;
    }
    if (!tex) return;
    const mat = new THREE.MeshLambertMaterial({
      map: tex,
      alphaMap: faceMask(),
      alphaTest: 0.5,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 0.35, // stays readable at night
    });
    const m = new THREE.Mesh(faceGeometry(), mat);
    m.position.set(0, 1.14 - HIP, 0); // head center, in body-bone space
    this.body.add(m);
    this.faceMesh = m;
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
    let armL = 0, armR = 0, armLz = 0, armRz = 0, legL = 0, legR = 0, lean = 0, twist = 0;
    const p = t * 2 + this.phase;
    switch (this.mode) {
      case 'idle': {
        // breathing + weight shift
        bob = Math.sin(p * 1.5) * 0.015;
        armL = Math.sin(p) * 0.08;
        armR = -Math.sin(p) * 0.08;
        armLz = 0.08;
        armRz = -0.08;
        lean = Math.sin(p * 0.5) * 0.03;
        this.fidgetT -= dt;
        if (this.fidget === 'none' && this.fidgetT <= 0) {
          const r = Math.random();
          this.fidget = r < 0.5 ? 'look' : r < 0.8 ? 'scratch' : 'hop';
          this.fidgetDur = this.fidget === 'hop' ? 0.45 : 1.6;
          this.lookDir = Math.random() < 0.5 ? -1 : 1;
        }
        if (this.fidget !== 'none') {
          this.fidgetDur -= dt;
          const k = Math.sin(Math.max(0, Math.min(1, 1 - this.fidgetDur / (this.fidget === 'hop' ? 0.45 : 1.6))) * Math.PI);
          if (this.fidget === 'look') twist = this.lookDir * 0.55 * k;
          if (this.fidget === 'scratch') {
            armRz = -2.3 * k;
            armR = -0.6 * k;
          }
          if (this.fidget === 'hop') {
            bob += k * 0.14;
            armLz = 0.08 + k * 0.5;
            armRz = -0.08 - k * 0.5;
          }
          if (this.fidgetDur <= 0) {
            this.fidget = 'none';
            this.fidgetT = 3 + Math.random() * 6;
          }
        }
        break;
      }
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
      case 'baka': {
        // bent over for Luksong Baka: lower levels bend further
        const lvl = Math.max(0, Math.min(4, this.bakaLevel));
        lean = [1.45, 1.3, 1.15, 0.95, 0.75][lvl];
        armL = armR = -0.9 + lean * 0.35; // hands toward the knees
        armLz = 0.12;
        armRz = -0.12;
        legL = legR = -0.12;
        bob = Math.sin(p * 1.2) * 0.008;
        break;
      }
      case 'still':
        break;
    }
    b.position.y = HIP + bob;
    b.rotation.x = lean;
    b.rotation.y += (twist - b.rotation.y) * Math.min(1, dt * 6);
    // legs follow the body upward on hops/jumps (crouch keeps feet planted)
    this.legL.position.y = this.legR.position.y = 0.55 + Math.max(0, bob);
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

const CULL_DIST = 45;

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
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xdcdcdc, fog: false, depthWrite: false, transparent: true }));
    // same on-screen size as before (1.15 m per 160 px), anchored on the title
    const k = 1.15 / 160;
    this.label.scale.set(k * LABEL_H * aspect, k * LABEL_H, 1);
    this.label.center.set(0.5, 1 - LABEL_ANCHOR_Y / LABEL_H);
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
  private hubVisible = true;

  setHubVisible(v: boolean): void {
    this.hubVisible = v;
    this.label.visible = v && !this.culled;
    this.ring.visible = v && !this.culled;
  }

  /** Put every kid back where they stand in the hub. */
  resetToHome(groundAt: (x: number, z: number) => number): void {
    this.culled = false;
    this.kids.forEach((k, i) => {
      const pl = this.home[i];
      k.root.position.set(pl.x, pl.y ?? groundAt(pl.x, pl.z), pl.z);
      k.face(pl.faceX ?? this.spot.x, pl.faceZ ?? this.spot.z);
      k.mode = pl.mode ?? 'idle';
      k.speed = 0;
      k.root.visible = true;
    });
  }

  private culled = false;
  private savedVis: boolean[] = [];

  /**
   * @param keep true for the group of the game being played (never culled).
   * Groups farther than CULL_DIST stop drawing and animating; fog hides them anyway.
   */
  update(dt: number, t: number, camPos: THREE.Vector3, keep = false): void {
    const far = !keep && camPos.distanceTo(this.spot) > CULL_DIST;
    if (far !== this.culled) {
      this.culled = far;
      if (far) this.savedVis = this.kids.map((k) => k.root.visible);
      this.kids.forEach((k, i) => (k.root.visible = far ? false : this.savedVis[i] ?? true));
      this.label.visible = this.ring.visible = !far && this.hubVisible;
    }
    if (far) return;
    for (const k of this.kids) k.update(dt, t);
    const d = camPos.distanceTo(this.label.position);
    const m = this.label.material as THREE.SpriteMaterial;
    m.opacity = THREE.MathUtils.clamp(1.4 - d / 30, 0, 1);
    this.label.position.y += Math.sin(t * 2 + this.spot.x) * 0.0015;
    const rm = this.ring.material as THREE.MeshBasicMaterial;
    rm.opacity = 0.35 + Math.sin(t * 3) * 0.2;
  }
}
