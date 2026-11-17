import * as THREE from 'three';
import { Kit, StaticBuilder, corrugated, underside, gable, type Frame } from './geo';
import type { Lighting } from './lighting';

/** Palette (sRGB hex). Night look comes from the bake, so albedos stay fairly bright. */
export const C = {
  asphalt: 0x34363d,
  roadLine: 0xd9c25c,
  concrete: 0xa8a49b,
  curb: 0xc4bfb3,
  dirt: 0x7a6048,
  grass: 0x3f5c33,
  wood: 0x8a5a36,
  darkWood: 0x4e3320,
  door: 0x6b3f22,
  steel: 0x7d8790,
  chrome: 0xdfe3ea,
  tire: 0x1c1c1f,
  glass: 0x1a2533,
  leaves: 0x2f5530,
  leaves2: 0x3d6a35,
  bark: 0x4d3a2a,
  roofGalv: 0x9aa3aa,
  roofRust: 0x8e5233,
  roofRed: 0xa53b2e,
  roofBlue: 0x3e6290,
  roofGreen: 0x4f7a4a,
  block: 0xb3ada0,
  white: 0xece6da,
};

export function shade(hex: number, k: number): number {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return c.getHex();
}

/** Batches textured quads per texture (signs, capiz windows, court floor). */
export class TexKit {
  private sets = new Map<THREE.Texture, StaticBuilder>();
  constructor(private lighting: Lighting, private kit: Kit) {}

  quad(t: THREE.Texture, f: Frame, lx: number, ly: number, lz: number, w: number, h: number,
    o: { rx?: number; ry?: number; lit?: boolean; bright?: number; tint?: number; seg?: [number, number] } = {}): void {
    let sb = this.sets.get(t);
    if (!sb) {
      sb = new StaticBuilder(this.lighting, true);
      this.sets.set(t, sb);
    }
    const g = new THREE.PlaneGeometry(w, h, o.seg?.[0] ?? 1, o.seg?.[1] ?? 1);
    sb.add(g, o.tint ?? 0xffffff, this.kit.matrix(f, lx, ly, lz, o.rx, o.ry), { lit: o.lit, bright: o.bright });
  }

  build(scene: THREE.Scene): void {
    for (const [t, sb] of this.sets) {
      const mesh = sb.build(new THREE.MeshBasicMaterial({ map: t, vertexColors: true }));
      if (mesh) scene.add(mesh);
    }
  }
}

export interface Textures {
  capiz: THREE.Texture;
  store: THREE.Texture;
  signStore: THREE.Texture;
  signShed: THREE.Texture;
  signCourt: THREE.Texture;
  signArch: THREE.Texture;
  signBawal: THREE.Texture;
  jeepA: THREE.Texture;
  jeepB: THREE.Texture;
  court: THREE.Texture;
  signTanod: THREE.Texture;
  signUmihi: THREE.Texture;
  signUtang: THREE.Texture;
  tarpPista: THREE.Texture;
}

export interface B {
  kit: Kit;
  tex: TexKit;
  T: Textures;
}

/** World position of a prop-local point. */
export function local(f: Frame, lx: number, ly: number, lz: number): THREE.Vector3 {
  const c = Math.cos(f.rot), s = Math.sin(f.rot);
  return new THREE.Vector3(f.x + lx * c + lz * s, (f.y ?? 0) + ly, f.z - lx * s + lz * c);
}

// ------------------------------------------------------------------ roofs

/** Corrugated GI gable roof, ridge along local X. */
export function gableRoof(b: B, f: Frame, cx: number, baseY: number, cz: number, w: number, d: number, pitch: number, color: number, gableColor: number): void {
  const ov = 0.45;
  const half = d / 2 + ov;
  const rise = Math.tan(pitch) * (d / 2);
  const L = half / Math.cos(pitch);
  const ridgeY = baseY + rise;
  const sheet = corrugated(w + ov * 2, L, 0.03, 0.26);
  const under = underside(w + ov * 2, L);
  for (const side of [0, Math.PI]) {
    b.kit.geo(f, sheet, color, cx, ridgeY, cz, { rx: pitch, ry: side, noise: 0.25 });
    b.kit.geo(f, under, shade(color, 0.45), cx, ridgeY, cz, { rx: pitch, ry: side });
  }
  b.kit.box(f, cx, ridgeY - 0.02, cz, w + ov * 2, 0.08, 0.28, shade(color, 0.8));
  for (const sx of [-1, 1]) b.kit.geo(f, gable(d, rise), gableColor, cx + (sx * w) / 2, baseY, cz, { ry: Math.PI / 2 });
}

// ------------------------------------------------------------------ houses

export interface HouseSpec {
  w: number;
  d: number;
  floors: 1 | 2;
  wall: number;
  upper?: number;
  roof: number;
  litWindows?: boolean;
  door?: number;
}

function capizWindow(b: B, f: Frame, lx: number, ly: number, lz: number, ry: number, w: number, h: number, isLit: boolean): void {
  b.tex.quad(b.T.capiz, f, lx, ly, lz, w, h, { ry, lit: !isLit, bright: isLit ? 1.25 : 1, tint: isLit ? 0xffc27a : 0xd8d0c0 });
  // sill
  const c = Math.cos(ry), s = Math.sin(ry);
  b.kit.box(f, lx + s * 0.04, ly - h / 2 - 0.08, lz + c * 0.04, Math.abs(c) * (w + 0.2) + Math.abs(s) * 0.12, 0.08, Math.abs(s) * (w + 0.2) + Math.abs(c) * 0.12, C.darkWood);
}

/** Filipino house: concrete ground floor, optional wooden upper floor, capiz windows, GI roof. Front faces local +Z. */
export function house(b: B, f: Frame, s: HouseSpec): void {
  const { kit } = b;
  const h1 = 2.6;
  kit.box(f, 0, 0, 0, s.w, h1, s.d, s.wall, { collide: true, noise: 0.18 });
  kit.box(f, 0, 0, 0, s.w + 0.06, 0.3, s.d + 0.06, shade(s.wall, 0.6));
  let top = h1, tw = s.w, td = s.d;
  const upper = s.upper ?? C.wood;
  if (s.floors === 2) {
    tw = s.w + 0.4;
    td = s.d + 0.4;
    kit.box(f, 0, h1, 0, tw, 2.3, td, upper, { collide: true, noise: 0.25 });
    for (let i = 1; i < 5; i++) kit.box(f, 0, h1 + i * 0.46, td / 2 + 0.01, tw, 0.03, 0.02, shade(upper, 0.6));
    kit.box(f, 0, h1 - 0.12, 0, tw + 0.05, 0.16, td + 0.05, C.darkWood);
    top = h1 + 2.3;
  }
  gableRoof(b, f, 0, top, 0, tw, td, 0.42, s.roof, s.floors === 2 ? upper : s.wall);

  const dx = s.door ?? -s.w * 0.25;
  kit.box(f, dx, 0, s.d / 2 + 0.03, 0.95, 2.05, 0.06, C.door);
  kit.box(f, dx, 2.05, s.d / 2 + 0.03, 1.15, 0.12, 0.1, C.darkWood);
  kit.box(f, dx, 0, s.d / 2 + 0.35, 1.3, 0.15, 0.6, C.concrete, { collide: true });

  const lit = !!s.litWindows;
  capizWindow(b, f, s.w * 0.22, 1.5, s.d / 2 + 0.02, 0, 1.2, 1.0, lit);
  capizWindow(b, f, s.w / 2 + 0.02, 1.5, 0, Math.PI / 2, 1.0, 0.9, false);
  capizWindow(b, f, -s.w / 2 - 0.02, 1.5, 0, -Math.PI / 2, 1.0, 0.9, lit);
  if (s.floors === 2) {
    const n = tw > 6.5 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const x = -tw / 2 + ((i + 0.5) * tw) / n;
      capizWindow(b, f, x, h1 + 1.25, td / 2 + 0.02, 0, 1.3, 1.1, lit && i !== 1);
    }
  }
}

// ------------------------------------------------------------- sari-sari

/** Sari-sari store with lit grilled window, generic cola sign, awning and bench. Front faces +Z. */
export function sariSari(b: B, f: Frame): void {
  const { kit, tex, T } = b;
  const wall = 0x8fc1a9;
  kit.box(f, 0, 0, 0, 5, 3, 4, wall, { collide: true, noise: 0.2 });
  kit.box(f, 0, 0, 0, 5.06, 0.3, 4.06, shade(wall, 0.55));
  gableRoof(b, f, 0, 3, 0, 5, 4, 0.3, C.roofGalv, wall);
  // glowing window + counter
  tex.quad(T.store, f, -0.3, 1.55, 2.03, 3.2, 1.6, { lit: false, bright: 1.15 });
  kit.box(f, -0.3, 0.7, 2.12, 3.4, 0.08, 0.3, C.wood);
  kit.box(f, 1.95, 0, 2.03, 0.8, 2.0, 0.06, C.door);
  // sign: stands on the front edge of the awning (behind it, the awning hid the top half)
  kit.box(f, -0.1, 2.46, 4.02, 4.5, 0.74, 0.05, C.darkWood);
  tex.quad(T.signStore, f, -0.1, 2.83, 4.06, 4.4, 1.1 * 0.62, { lit: false, bright: 0.9 });
  // awning: single slope
  const pitch = 0.24;
  kit.geo(f, corrugated(5.8, 2.1, 0.025, 0.22), C.roofRed, 0, 2.98, 2.0, { rx: pitch, noise: 0.25 });
  kit.geo(f, underside(5.8, 2.1), shade(C.roofRed, 0.5), 0, 2.98, 2.0, { rx: pitch });
  for (const x of [-2.75, 2.75]) kit.box(f, x, 0, 3.95, 0.1, 2.5, 0.1, C.darkWood, { collide: true });
  // bench
  kit.box(f, -1.6, 0.42, 3.15, 2.0, 0.07, 0.42, C.wood);
  for (const x of [-2.45, -0.75]) kit.box(f, x, 0, 3.15, 0.08, 0.42, 0.36, C.darkWood);
  b.kit.phys.addBoxMatrix(kit.matrix(f, -1.6, 0.24, 3.15), 1.0, 0.24, 0.21);
  // bottle crates stacked by the door
  for (let i = 0; i < 3; i++) kit.box(f, 2.85, i * 0.32, 1.4, 0.45, 0.3, 0.35, i % 2 ? 0xc0392b : 0xb03a2e);
  b.kit.phys.addBoxMatrix(kit.matrix(f, 2.85, 0.48, 1.4), 0.23, 0.48, 0.18);
  // ice box
  kit.box(f, -2.75, 0, 2.6, 0.7, 0.75, 0.5, 0x2f7fc1, { collide: true });
  kit.box(f, -2.75, 0.75, 2.6, 0.74, 0.06, 0.54, 0xeeeeee);
}

// ---------------------------------------------------------------- vehicles

const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.28, 12);
const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.3, 8);
const smallWheel = new THREE.CylinderGeometry(0.3, 0.3, 0.12, 10);

/** Classic jeepney: long boxy body, chrome hood + grille, side stripes, roof sign. Faces local +Z. */
export function jeepney(b: B, f: Frame, body: number, accent: number, accent2: number, sign: THREE.Texture): void {
  const { kit, tex } = b;
  for (const x of [-0.88, 0.88])
    for (const z of [1.75, -1.7]) {
      kit.geo(f, wheelGeo, C.tire, x, 0.4, z, { rz: Math.PI / 2 });
      kit.geo(f, hubGeo, C.chrome, x, 0.4, z, { rz: Math.PI / 2 });
    }
  kit.box(f, 0, 0.28, 0, 1.7, 0.25, 5.0, 0x202024);
  kit.box(f, 0, 0.5, -0.75, 1.95, 0.8, 3.5, body, { noise: 0.1 });
  for (const sx of [-1, 1]) {
    kit.box(f, sx * 0.985, 0.72, -0.75, 0.02, 0.1, 3.5, accent, { lit: true, bright: 1.2 });
    kit.box(f, sx * 0.985, 0.92, -0.75, 0.02, 0.06, 3.5, accent2, { bright: 1.2 });
    kit.box(f, sx * 1.08, 1.2, 1.7, 0.06, 0.2, 0.12, C.chrome);
  }
  kit.box(f, 0, 1.3, -0.75, 1.9, 0.55, 3.45, 0x15161c);
  for (const z of [-2.4, -1.5, -0.6, 0.3]) for (const sx of [-1, 1]) kit.box(f, sx * 0.96, 1.3, z, 0.05, 0.55, 0.12, body);
  kit.box(f, 0, 1.85, -0.55, 2.02, 0.12, 4.0, body);
  for (const sx of [-1, 1]) kit.box(f, sx * 0.95, 1.97, -0.55, 0.04, 0.08, 3.9, C.chrome, { bright: 1.2 });
  kit.box(f, 0, 0.5, 1.45, 1.95, 0.8, 0.9, body);
  kit.box(f, 0, 1.3, 1.82, 1.8, 0.55, 0.05, C.glass, { rx: -0.18 });
  tex.quad(sign, f, 0, 2.15, 1.47, 1.7, 0.42, { lit: false, bright: 0.85 });
  // chrome hood, grille, bumper, headlights, ornaments
  kit.box(f, 0, 0.45, 2.35, 1.55, 0.55, 0.9, C.chrome, { bright: 1.25 });
  kit.box(f, 0, 0.48, 2.81, 1.3, 0.42, 0.04, 0xb8bec6, { bright: 1.2 });
  for (let i = 0; i < 4; i++) kit.box(f, 0, 0.53 + i * 0.09, 2.84, 1.25, 0.025, 0.02, 0x50565e);
  for (const sx of [-1, 1]) {
    kit.geo(f, new THREE.CylinderGeometry(0.11, 0.11, 0.06, 10), 0xfff1c0, sx * 0.55, 0.78, 2.82, { rx: Math.PI / 2, lit: false, bright: 0.7 });
    kit.cyl(f, sx * 0.72, 1.0, 2.7, 0.01, 0.012, 0.9, C.chrome);
  }
  kit.box(f, 0, 0.3, 2.86, 2.05, 0.16, 0.16, C.chrome, { bright: 1.25 });
  kit.box(f, 0, 1.0, 2.55, 0.06, 0.2, 0.22, C.chrome, { bright: 1.3 });
  kit.box(f, 0, 0.25, -2.6, 1.0, 0.1, 0.35, C.chrome);
  kit.box(f, 0, 0.62, -2.51, 0.8, 1.15, 0.02, 0x0c0c10);
  b.kit.phys.addBoxMatrix(kit.matrix(f, 0, 1.05, 0.1), 1.02, 0.95, 2.95);
}

/** Tricycle: motorcycle with a covered sidecar. Faces local +Z. */
export function tricycle(b: B, f: Frame, color: number): void {
  const { kit } = b;
  kit.geo(f, smallWheel, C.tire, 0.5, 0.3, 0.8, { rz: Math.PI / 2 });
  kit.geo(f, smallWheel, C.tire, 0.5, 0.3, -0.6, { rz: Math.PI / 2 });
  kit.geo(f, smallWheel, C.tire, -0.95, 0.3, -0.1, { rz: Math.PI / 2 });
  kit.box(f, 0.5, 0.35, 0.1, 0.24, 0.4, 1.1, color);
  kit.box(f, 0.5, 0.75, -0.2, 0.28, 0.1, 0.6, 0x1b1b1b);
  kit.box(f, 0.5, 1.0, 0.7, 0.7, 0.05, 0.05, C.chrome);
  kit.box(f, -0.4, 0.2, -0.05, 1.05, 0.9, 1.6, color, { noise: 0.1 });
  kit.box(f, -0.4, 1.1, -0.05, 1.0, 0.5, 1.5, 0x111216);
  kit.box(f, -0.4, 1.1, 0.72, 0.95, 0.5, 0.04, C.glass);
  kit.box(f, -0.1, 1.6, -0.05, 1.75, 0.08, 1.9, color);
  kit.box(f, -0.4, 0.62, 0.76, 0.9, 0.12, 0.02, 0xffe066, { bright: 1.2 });
  for (const [x, z] of [[0.7, 0.85], [0.7, -0.95], [-0.9, -0.95]]) kit.box(f, x, 1.1, z, 0.05, 0.5, 0.05, C.chrome);
  b.kit.phys.addBoxMatrix(kit.matrix(f, -0.1, 0.85, -0.05), 0.95, 0.85, 1.05);
}

// ---------------------------------------------------------------- street furniture

export function waitingShed(b: B, f: Frame): void {
  const { kit, tex, T } = b;
  const wall = 0xd9c78f;
  kit.box(f, 0, 0, -0.7, 3.4, 2.3, 0.15, wall, { collide: true, noise: 0.2 });
  for (const sx of [-1, 1]) kit.box(f, sx * 1.65, 0, -0.35, 0.12, 2.3, 0.85, wall, { collide: true });
  kit.box(f, 0, 0.42, -0.4, 3.0, 0.08, 0.45, C.concrete);
  for (const x of [-1.2, 0, 1.2]) kit.box(f, x, 0, -0.4, 0.15, 0.42, 0.35, C.concrete);
  b.kit.phys.addBoxMatrix(kit.matrix(f, 0, 0.25, -0.4), 1.5, 0.25, 0.23);
  kit.box(f, 0, 2.3, -0.2, 3.9, 0.12, 1.95, 0x6e7c8a);
  kit.box(f, 0, 1.98, 0.75, 3.9, 0.44, 0.06, 0xf3e6b0);
  tex.quad(T.signShed, f, 0, 2.2, 0.79, 3.6, 0.42, { lit: true, bright: 1.1 });
}

/** Covered basketball court. f is the court center, long axis along local X. Returns string-light anchor curves. */
export function court(b: B, f: Frame): { strings: THREE.Vector3[][]; floods: THREE.Vector3[] } {
  const { kit, tex, T } = b;
  kit.box(f, 0, 0, 0, 16.6, 0.1, 10.6, C.concrete, { collide: true });
  tex.quad(T.court, f, 0, 0.105, 0, 16, 10, { rx: -Math.PI / 2, seg: [16, 10], bright: 1.1 });
  const postTops: THREE.Vector3[] = [];
  for (const x of [-8, 0, 8])
    for (const z of [-5.6, 5.6]) {
      kit.cyl(f, x, 0, z, 0.12, 0.15, 6.6, C.steel, { collide: true });
      postTops.push(local(f, x, 5.4, z));
    }
  gableRoof(b, f, 0, 6.6, 0, 17.2, 11.4, 0.16, C.roofBlue, 0x58708a);
  for (const x of [-8, 0, 8]) kit.box(f, x, 6.4, 0, 0.15, 0.22, 11.4, 0x5c6670);
  // hoop at +X end
  kit.cyl(f, 8.95, 0, 0, 0.09, 0.1, 3.6, 0x3c6e9e, { collide: true });
  kit.box(f, 8.6, 3.4, 0, 0.75, 0.1, 0.1, 0x3c6e9e);
  kit.box(f, 8.2, 2.25, 0, 0.06, 1.05, 1.8, 0xf0f0f0, { bright: 1.1 });
  kit.box(f, 8.16, 2.5, 0, 0.02, 0.45, 0.59, 0xd04030);
  kit.box(f, 8.16, 2.54, 0, 0.025, 0.37, 0.51, 0xf0f0f0);
  kit.geo(f, new THREE.TorusGeometry(0.23, 0.02, 6, 18), 0xff6a1a, 7.92, 3.05, 0, { rx: Math.PI / 2, lit: false, bright: 0.75 });
  kit.geo(f, new THREE.CylinderGeometry(0.23, 0.15, 0.4, 10, 1, true), 0xdddddd, 7.92, 2.85, 0, { bright: 0.9 });
  // benches on the road side
  for (const x of [-5, 0, 5]) {
    kit.box(f, x, 0.42, -6.3, 3, 0.08, 0.4, C.wood);
    for (const dx of [-1.3, 1.3]) kit.box(f, x + dx, 0, -6.3, 0.1, 0.42, 0.34, C.darkWood);
    b.kit.phys.addBoxMatrix(kit.matrix(f, x, 0.25, -6.3), 1.5, 0.25, 0.2);
  }
  tex.quad(T.signCourt, f, 0, 6.05, -5.82, 7, 0.8, { ry: Math.PI, lit: true, bright: 1.25 });

  // string lights: two long sides plus zigzags across
  const [a0, b0, a1, b1, a2, b2] = postTops; // (x=-8,z-),(x=-8,z+),(0,-),(0,+),(8,-),(8,+)
  const strings = [
    [a0, a1], [a1, a2], [b0, b1], [b1, b2],
    [a0, b1], [b0, a1], [a1, b2], [b1, a2],
  ];
  return { strings: strings.map(([p, q]) => [p, q]), floods: [local(f, -4, 5.8, 0), local(f, 4, 5.8, 0)] };
}

// ---------------------------------------------------------------- nature

export function tree(b: B, x: number, z: number, kind: 'acacia' | 'mango', seed = 1): void {
  const f: Frame = { x, z, rot: seed * 1.7 };
  const { kit } = b;
  const big = kind === 'acacia';
  kit.cyl(f, 0, 0, 0, 0.35, 0.55, big ? 3.4 : 2.6, C.bark, { collide: true, seg: 7, noise: 0.3 });
  const arms = big ? 5 : 4;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2;
    const br = new THREE.CylinderGeometry(0.09, 0.2, big ? 3.4 : 2.2, 5).translate(0, (big ? 3.4 : 2.2) / 2, 0);
    kit.geo(f, br, C.bark, 0, big ? 2.9 : 2.2, 0, { rx: 0.85, ry: a, noise: 0.3 });
  }
  const n = big ? 10 : 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    const r = big ? 2.4 + (i % 3) * 0.8 : 1.3 + (i % 2) * 0.7;
    const y = big ? 5.2 + (i % 2) * 0.6 : 3.9 + (i % 3) * 0.6;
    const g = new THREE.IcosahedronGeometry(1, big ? 0 : 1).scale(big ? 2.4 : 1.7, big ? 0.9 : 1.4, big ? 2.4 : 1.7);
    kit.geo(f, g, i % 2 ? C.leaves : C.leaves2, Math.cos(a) * r, y, Math.sin(a) * r, { ry: a, noise: 0.4 });
  }
  const top = new THREE.IcosahedronGeometry(1, 1).scale(big ? 3.2 : 2.2, big ? 1.1 : 1.6, big ? 3.2 : 2.2);
  kit.geo(f, top, C.leaves2, 0, big ? 6.0 : 5.0, 0, { noise: 0.4 });
}

export function coconut(b: B, x: number, z: number, lean: number, h = 8): void {
  const f: Frame = { x, z, rot: lean };
  const { kit } = b;
  const segs = 5;
  let px = 0, py = 0;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const tilt = 0.1 + t * 0.18;
    const len = h / segs;
    kit.geo(f, new THREE.CylinderGeometry(0.17, 0.22, len, 6).translate(0, len / 2, 0), 0x6d5a45, px, py, 0, { rz: -tilt, noise: 0.3 });
    px += Math.sin(tilt) * len;
    py += Math.cos(tilt) * len;
  }
  const frond = new THREE.BoxGeometry(0.45, 0.03, 2.8, 1, 1, 3).translate(0, 0, 1.4);
  for (let i = 0; i < 8; i++) kit.geo(f, frond, i % 2 ? C.leaves : C.leaves2, px, py, 0, { rx: 0.35 + (i % 3) * 0.15, ry: (i / 8) * Math.PI * 2, noise: 0.3 });
  for (let i = 0; i < 3; i++) kit.geo(f, new THREE.IcosahedronGeometry(0.18, 0), 0x5b6b2a, px + Math.cos(i * 2) * 0.2, py - 0.2, Math.sin(i * 2) * 0.2);
}

export function sampayan(b: B, f: Frame): void {
  const { kit } = b;
  for (const x of [-3, 3]) kit.cyl(f, x, 0, 0, 0.05, 0.06, 2.15, 0xb9a46a, { collide: true, seg: 6 });
  kit.box(f, 0, 2.0, 0, 6, 0.015, 0.015, 0x222222);
  const cols = [0xe63946, 0xf1faee, 0x457b9d, 0xffb703, 0x8ecae6, 0xf28482, 0x90be6d, 0xffffff];
  let x = -2.6;
  let i = 0;
  while (x < 2.6) {
    const w = 0.35 + ((i * 37) % 5) * 0.08;
    const h = 0.45 + ((i * 53) % 4) * 0.12;
    kit.box(f, x + w / 2, 2.0 - h, 0, w, h, 0.02, cols[i % cols.length], { rz: ((i % 3) - 1) * 0.04 });
    x += w + 0.12;
    i++;
  }
  kit.cyl(f, 1.2, 0, 0.8, 0.45, 0.35, 0.3, 0x2f6fb2);
}

// ---------------------------------------------------------------- landmarks

export function arch(b: B, f: Frame): void {
  const { kit, tex, T } = b;
  const col = 0x2e7d6b;
  for (const sx of [-1, 1]) {
    kit.box(f, sx * 4.7, 0, 0, 0.8, 5.6, 0.8, col, { collide: true, noise: 0.15 });
    kit.box(f, sx * 4.7, 5.6, 0, 1.0, 0.3, 1.0, 0xe9c46a);
  }
  kit.box(f, 0, 4.5, 0, 10.2, 1.1, 0.5, col);
  // the pillars' inner faces are 8.6 m apart: keep the sign (and its text) clear of them
  tex.quad(T.signArch, f, 0, 5.05, 0.27, 8.3, 0.83, { lit: false, bright: 0.85 });
  kit.box(f, 0, 5.6, 0, 3, 0.5, 0.4, 0xe9c46a);
}

export function barricade(b: B, f: Frame): void {
  const { kit, tex, T } = b;
  for (const x of [-2.6, 2.6]) {
    for (const s of [-1, 1]) kit.box(f, x, 0, s * 0.18, 0.08, 1.1, 0.08, C.wood, { rx: s * 0.2 });
  }
  for (let i = 0; i < 6; i++) kit.box(f, -2.75 + i * 1.1, 0.75, 0, 1.1, 0.25, 0.06, i % 2 ? 0xffffff : 0xd62828, { bright: 1.1 });
  tex.quad(T.signBawal, f, 0, 1.5, 0.06, 2.2, 0.55, { lit: true, bright: 1.3 });
  for (const x of [-1, 1]) kit.box(f, x, 0.85, 0.03, 0.05, 0.8, 0.05, C.wood);
}

/** Crates, benches and walls for Langit-Lupa ("langit" = anything raised). */
export function langitArea(b: B, f: Frame): void {
  const { kit } = b;
  const crate = (x: number, y: number, z: number, s = 1) => {
    kit.box(f, x, y, z, s, 0.8, s, C.wood, { collide: true, noise: 0.3 });
    kit.box(f, x, y + 0.36, z, s + 0.02, 0.06, s + 0.02, C.darkWood);
  };
  crate(-2.5, 0, -2);
  crate(-2.5, 0.8, -2);
  crate(-1.3, 0, -2.2);
  crate(2.6, 0, 2.4, 1.1);
  kit.box(f, 0.5, 0, -3.2, 3.2, 0.9, 0.4, C.block, { collide: true, noise: 0.2 });
  kit.box(f, 0, 0, 1.2, 2.4, 0.45, 0.6, C.wood, { collide: true });
  kit.cyl(f, -3.4, 0, 1.6, 0.32, 0.32, 0.9, 0x2a6f97, { collide: true, seg: 10 });
  kit.cyl(f, -2.7, 0, 2.4, 0.32, 0.32, 0.9, 0xc0392b, { collide: true, seg: 10 });
  // kariton (push cart)
  kit.box(f, 3.2, 0.5, -1.0, 1.4, 0.45, 2.0, 0x6d8b74, { collide: true });
  kit.geo(f, smallWheel, C.tire, 3.95, 0.3, -1.0, { rz: Math.PI / 2 });
  kit.geo(f, smallWheel, C.tire, 2.45, 0.3, -1.0, { rz: Math.PI / 2 });
}

export function pottedPlant(b: B, x: number, z: number, s = 1): void {
  const f: Frame = { x, z, rot: x * 3 };
  b.kit.cyl(f, 0, 0, 0, 0.28 * s, 0.2 * s, 0.4 * s, 0x9c4a2a, { collide: true, seg: 7 });
  for (let i = 0; i < 4; i++)
    b.kit.geo(f, new THREE.IcosahedronGeometry(0.3 * s, 0), i % 2 ? C.leaves2 : C.leaves, Math.cos(i * 1.6) * 0.15 * s, (0.6 + (i % 2) * 0.25) * s, Math.sin(i * 1.6) * 0.15 * s, { noise: 0.4 });
}

/** Parol (star lantern) geometry, centered, facing +Z. */
export function parolGeometry(r = 0.45): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i) shape.lineTo(x, y);
    else shape.moveTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
  g.translate(0, 0, -0.04);
  return g;
}

// ---------------------------------------------------------------- Taguan hiding props

/** Stack of three wooden crates (about 1.6 m tall). */
export function crateStack(b: B, f: Frame): void {
  const { kit } = b;
  const crate = (x: number, y: number, z: number, s: number, ry = 0) => {
    kit.box(f, x, y, z, s, 0.8, s, C.wood, { collide: true, noise: 0.3, ry });
    kit.box(f, x, y + 0.36, z, s + 0.02, 0.06, s + 0.02, C.darkWood, { ry });
  };
  crate(0, 0, 0, 1);
  crate(1.05, 0, 0.1, 0.95, 0.15);
  crate(0.45, 0.8, 0.05, 0.9, -0.1);
}

/** Cluster of plastic water drums. */
export function drums(b: B, f: Frame): void {
  const cols = [0x2a6f97, 0x6a994e, 0xd9822b];
  [[0, 0], [0.68, 0.1], [0.3, 0.62]].forEach(([x, z], i) => {
    b.kit.cyl(f, x, 0, z, 0.32, 0.32, 0.9, cols[i % cols.length], { collide: true, seg: 10 });
    b.kit.cyl(f, x, 0.9, z, 0.2, 0.2, 0.04, shade(cols[i % cols.length], 0.6), { seg: 8 });
  });
}

/** Big round shrub; solid core so you crouch behind it, not inside it. */
export function bush(b: B, x: number, z: number, s = 1): void {
  const f: Frame = { x, z, rot: x * 1.3 + z };
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05;
    const r = (0.5 + (i % 3) * 0.12) * s;
    b.kit.geo(f, new THREE.IcosahedronGeometry(r, 0), i % 2 ? C.leaves2 : C.leaves, Math.cos(a) * 0.45 * s, (0.45 + (i % 2) * 0.35) * s, Math.sin(a) * 0.4 * s, { noise: 0.45 });
  }
  b.kit.phys.addCylinder(x, 0.6 * s, z, 0.6 * s, 0.75 * s);
}

/** Wooden kariton (push cart) loaded with sacks. Long axis along local X. */
export function kariton(b: B, f: Frame): void {
  const { kit } = b;
  kit.box(f, 0, 0.45, 0, 1.7, 0.08, 1.0, C.wood, { collide: true, noise: 0.3 });
  for (const z of [-0.48, 0.48]) kit.box(f, 0, 0.53, z, 1.7, 0.35, 0.06, C.darkWood);
  for (const z of [-0.58, 0.58]) kit.geo(f, new THREE.CylinderGeometry(0.42, 0.42, 0.07, 12), C.darkWood, 0.1, 0.42, z, { rx: Math.PI / 2 });
  for (const z of [-0.35, 0.35]) kit.box(f, -1.25, 0.6, z, 0.9, 0.05, 0.05, C.darkWood, { rz: -0.25 });
  kit.box(f, 0.85, 0, 0, 0.06, 0.45, 0.06, C.darkWood);
  [[-0.4, -0.2], [0.35, 0.15], [-0.05, 0.05]].forEach(([x, z], i) =>
    kit.box(f, x, 0.53 + (i === 2 ? 0.38 : 0), z, 0.65, 0.4, 0.5, 0xd8c7a0, { noise: 0.35, ry: i * 0.4 }),
  );
  kit.phys.addBoxMatrix(kit.matrix(f, 0, 0.55, 0), 0.9, 0.55, 0.55);
}

/** Clay banga jars. */
export function bangaJars(b: B, f: Frame): void {
  [[0, 0, 1], [0.7, 0.25, 0.8], [0.25, 0.75, 0.68]].forEach(([x, z, s]) => {
    b.kit.geo(f, new THREE.SphereGeometry(0.42 * s, 10, 8).scale(1, 1.15, 1), 0x9c4a2a, x, 0.46 * s, z, { noise: 0.25 });
    b.kit.cyl(f, x, 0.88 * s, z, 0.22 * s, 0.18 * s, 0.14 * s, 0x84391f, { seg: 10 });
    const p = local(f, x, 0, z);
    b.kit.phys.addCylinder(p.x, 0.5 * s, p.z, 0.5 * s, 0.4 * s);
  });
}

/** Stacked hollow blocks with a plank leaning on them. */
export function hollowBlocks(b: B, f: Frame): void {
  const { kit } = b;
  kit.box(f, 0, 0, 0, 1.6, 0.6, 0.8, C.block, { collide: true, noise: 0.35 });
  kit.box(f, 0.1, 0.6, 0, 1.2, 0.4, 0.8, shade(C.block, 0.92), { collide: true, noise: 0.35 });
  kit.box(f, -0.5, 1.0, 0.05, 0.4, 0.2, 0.4, C.block, { noise: 0.3 });
  kit.box(f, 0.3, 0.55, 0.5, 2.0, 0.05, 0.25, C.wood, { rz: 0.45 });
}
