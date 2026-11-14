import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AudioSys } from '../core/audio';
import { radialTexture } from './textures';
import type { BlobShadows } from './shadows';

const SPEED = 11; // m/s
const FROM = 62; // spawn/despawn distance along the road
const LANE_Z = 0; // center of the road (parked vehicles sit in the outer lanes)

function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  const c = new THREE.Color(hex);
  const a = new Float32Array(g.getAttribute('position').count * 3);
  for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.deleteAttribute('uv');
  return g;
}

/**
 * A tricycle that drives through the barangay every half minute or so, with
 * headlights, a light pool on the road, spinning wheels, and its engine sound
 * moving with it. It honks if you stand in its way (and passes through you;
 * it is a friendly ghost of a tricycle).
 */
export class Traffic {
  private root = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private pool: THREE.Mesh;
  private active = false;
  private dir = 1;
  private x = 0;
  private wait = 9 + Math.random() * 8;
  private honked = false;

  constructor(scene: THREE.Scene, blobs: BlobShadows, private audio: AudioSys) {
    const colors = [0xf2c230, 0x2a9d8f, 0xe63946, 0x4361ee];
    const body = colors[Math.floor(Math.random() * colors.length)];
    // Model faces +X. Motorcycle on the right (-Z side when facing +X), sidecar on the left.
    const g = mergeGeometries([
      box(1.1, 0.4, 0.24, 0.1, 0.55, -0.45, body), // bike body
      box(0.6, 0.1, 0.28, -0.2, 0.8, -0.45, 0x1b1b1b), // seat
      box(0.05, 0.05, 0.7, 0.7, 1.0, -0.45, 0xdfe3ea), // handlebar
      box(1.6, 0.9, 1.05, -0.05, 0.65, 0.4, body), // sidecar
      box(1.5, 0.5, 1.0, -0.05, 1.35, 0.4, 0x111216), // cabin window band
      box(0.04, 0.5, 0.95, 0.72, 1.35, 0.4, 0x1a2533), // windshield
      box(1.9, 0.08, 1.75, -0.05, 1.64, 0.1, body), // roof
      box(0.04, 0.12, 0.9, 0.76, 0.82, 0.4, 0xffe066), // stripe plate
      // driver
      box(0.3, 0.42, 0.26, -0.25, 1.05, -0.45, 0x264653),
      box(0.22, 0.22, 0.22, -0.2, 1.4, -0.45, 0xc68642),
      box(0.26, 0.08, 0.26, -0.2, 1.53, -0.45, 0x161210),
    ])!;
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.root.add(mesh);
    const wg = new THREE.CylinderGeometry(0.28, 0.28, 0.12, 12).rotateX(Math.PI / 2);
    const wm = new THREE.MeshLambertMaterial({ color: 0x1c1c1f });
    for (const [x, z] of [[0.75, -0.45], [-0.55, -0.45], [-0.1, 1.0]]) {
      const w = new THREE.Mesh(wg, wm);
      w.position.set(x, 0.28, z);
      this.root.add(w);
      this.wheels.push(w);
    }
    // headlight + taillight glows
    const glowTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64, [[0.25, 'rgba(255,255,255,0.6)']]);
    const glow = (x: number, y: number, z: number, color: number, s: number) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
      sp.position.set(x, y, z);
      sp.scale.setScalar(s);
      this.root.add(sp);
    };
    glow(0.8, 0.85, -0.45, 0xfff2c8, 1.1);
    glow(0.78, 0.7, 0.75, 0xfff2c8, 0.7);
    glow(-0.9, 0.7, 0.85, 0xff3030, 0.5);
    // light pool on the road ahead
    this.pool = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 4.5).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,240,200,0.9)', 'rgba(255,240,200,0)', 128), color: 0xffe8b0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    this.pool.position.set(4.2, 0.04, 0);
    this.root.add(this.pool);
    this.root.visible = false;
    scene.add(this.root);
    blobs.add(this.root, 2.2);
  }

  update(dt: number, player: THREE.Vector3): void {
    if (!this.active) {
      this.wait -= dt;
      if (this.wait > 0) return;
      this.active = true;
      this.honked = false;
      this.dir = Math.random() < 0.5 ? 1 : -1;
      this.x = -FROM * this.dir;
      this.root.rotation.y = this.dir > 0 ? 0 : Math.PI;
      this.root.visible = true;
      this.audio.passBy(this.x, FROM * this.dir, LANE_Z, (FROM * 2) / SPEED);
    }
    this.x += this.dir * SPEED * dt;
    const bump = Math.sin(this.x * 3.1) * 0.015 + Math.sin(this.x * 7.3) * 0.008;
    this.root.position.set(this.x, bump, LANE_Z);
    this.root.rotation.z = Math.sin(this.x * 1.7) * 0.012;
    for (const w of this.wheels) w.rotation.z -= (SPEED * dt) / 0.28 * this.dir;

    // honk when the player stands in the road ahead
    const ahead = (player.x - this.x) * this.dir;
    if (!this.honked && Math.abs(player.z - LANE_Z) < 1.6 && ahead > 3 && ahead < 16 && player.y < 0.5) {
      this.honked = true;
      this.audio.play('honk', { pos: this.root.position.clone().setY(1) });
    }
    if (Math.abs(this.x) > FROM) {
      this.active = false;
      this.root.visible = false;
      this.wait = 25 + Math.random() * 30;
    }
  }
}
