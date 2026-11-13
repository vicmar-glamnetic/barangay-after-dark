import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Lighting } from './lighting';
import type { Physics } from '../core/physics';

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const _a = new THREE.Color();

/** Deterministic 2D value noise in [0,1], used to vary ground and wall tints. */
export function noise2(x: number, z: number): number {
  const h = (ix: number, iz: number) => {
    const s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = h(ix, iz), b = h(ix + 1, iz), c = h(ix, iz + 1), d = h(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export interface AddOpts {
  /** Bake lighting into the color (default true). False = emissive/unlit. */
  lit?: boolean;
  /** Color multiplier, >1 makes things glow. */
  bright?: number;
  /** Per-vertex tint variation amount (0 to 1). */
  noise?: number;
  /** Optional per-vertex albedo function (overrides color). */
  colorAt?: (p: THREE.Vector3, out: THREE.Color) => void;
}

/**
 * Collects static geometry, bakes lighting into vertex colors, and merges it
 * all into ONE mesh per material: the core trick that keeps draw calls low.
 */
export class StaticBuilder {
  private parts: THREE.BufferGeometry[] = [];
  triangles = 0;

  constructor(private lighting: Lighting, private keepUv = false) {}

  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, matrix?: THREE.Matrix4, o: AddOpts = {}): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    for (const name of Object.keys(g.attributes))
      if (name !== 'position' && name !== 'normal' && !(this.keepUv && name === 'uv')) g.deleteAttribute(name);
    if (this.keepUv && !g.getAttribute('uv')) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    }
    if (matrix) g.applyMatrix4(matrix);

    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const cols = new Float32Array(pos.count * 3);
    const lit = o.lit !== false;
    const bright = o.bright ?? 1;
    _a.set(color);
    for (let i = 0; i < pos.count; i++) {
      _p.fromBufferAttribute(pos, i);
      _n.fromBufferAttribute(nor, i);
      if (o.colorAt) o.colorAt(_p, _a);
      if (lit) this.lighting.bake(_p, _n, _a, _c);
      else _c.copy(_a);
      let k = bright;
      if (o.noise) k *= 1 + (noise2(_p.x * 0.9 + _p.y * 0.7, _p.z * 0.9 - _p.y * 0.3) - 0.5) * o.noise;
      cols[i * 3] = _c.r * k;
      cols[i * 3 + 1] = _c.g * k;
      cols[i * 3 + 2] = _c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.parts.push(g);
    this.triangles += pos.count / 3;
  }

  build(material: THREE.Material): THREE.Mesh | null {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    if (!merged) return null;
    merged.deleteAttribute('normal'); // MeshBasicMaterial does not need normals
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

/** A placement: position on the ground + rotation around Y. Props are built in local space. */
export interface Frame {
  x: number;
  z: number;
  rot: number;
  y?: number;
}

export interface BoxOpts extends AddOpts {
  collide?: boolean;
  rx?: number;
  ry?: number;
  rz?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);
const boxCache = new Map<string, THREE.BufferGeometry>();

/** Box with extra segments on big faces so baked lamp light has vertices to land on. */
export function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
  let g = boxCache.get(key);
  if (!g) {
    const seg = (s: number) => Math.min(6, Math.max(1, Math.round(s / 1.6)));
    g = new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d));
    boxCache.set(key, g);
  }
  return g;
}

/**
 * Building kit: adds geometry to a StaticBuilder and (optionally) a matching
 * static collider, using prop-local coordinates. ly is the BOTTOM of the box.
 */
export class Kit {
  constructor(public sb: StaticBuilder, public phys: Physics) {}

  matrix(f: Frame, lx: number, ly: number, lz: number, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
    const parent = new THREE.Matrix4().makeRotationY(f.rot).setPosition(f.x, f.y ?? 0, f.z);
    // 'YXZ': tilt first (X), then turn (Y). This is what sloped roofs need.
    _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
    _m.compose(_p.set(lx, ly, lz), _q, _s);
    return parent.multiply(_m);
  }

  box(f: Frame, lx: number, ly: number, lz: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, o: BoxOpts = {}): void {
    const m = this.matrix(f, lx, ly + h / 2, lz, o.rx, o.ry, o.rz);
    this.sb.add(boxGeo(w, h, d), color, m, o);
    if (o.collide) this.phys.addBoxMatrix(m, w / 2, h / 2, d / 2);
  }

  /** Upright cylinder; ly is the bottom. */
  cyl(f: Frame, lx: number, ly: number, lz: number, rTop: number, rBot: number, h: number, color: THREE.ColorRepresentation, o: BoxOpts & { seg?: number } = {}): void {
    const m = this.matrix(f, lx, ly + h / 2, lz, o.rx, o.ry, o.rz);
    this.sb.add(new THREE.CylinderGeometry(rTop, rBot, h, o.seg ?? 8), color, m, o);
    if (o.collide) {
      m.decompose(_p, _q, _n);
      this.phys.addCylinder(_p.x, _p.y, _p.z, h / 2, Math.max(rTop, rBot));
    }
  }

  /** Arbitrary geometry placed at a local position (geometry origin = placement point). */
  geo(f: Frame, g: THREE.BufferGeometry, color: THREE.ColorRepresentation, lx: number, ly: number, lz: number, o: BoxOpts = {}): void {
    this.sb.add(g, color, this.matrix(f, lx, ly, lz, o.rx, o.ry, o.rz), o);
  }
}

/**
 * Corrugated GI sheet: ridges run down the slope (along +Z), wave across X.
 * Built facing +Y with a flat darker underside so it can be seen from below.
 */
export function corrugated(w: number, len: number, amp = 0.03, period = 0.2): THREE.BufferGeometry {
  const segX = Math.max(2, Math.round((w / period) * 2));
  const segZ = Math.max(1, Math.round(len / 2.5));
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= segZ; j++) {
    for (let i = 0; i <= segX; i++) {
      const x = -w / 2 + (i / segX) * w;
      pos.push(x, (i % 2 === 0 ? 1 : -1) * amp, (j / segZ) * len);
    }
  }
  const row = segX + 1;
  for (let j = 0; j < segZ; j++)
    for (let i = 0; i < segX; i++) {
      const a = j * row + i, b = (j + 1) * row + i, c = a + 1, d = b + 1;
      idx.push(a, b, c, c, b, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat underside for a roof sheet (faces -Y). */
export function underside(w: number, len: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, len);
  g.rotateX(Math.PI / 2);
  g.translate(0, -0.04, len / 2);
  return g;
}

/** Double-sided triangle (two windings) for gable ends. */
export function gable(width: number, height: number): THREE.BufferGeometry {
  const hw = width / 2;
  const v = [-hw, 0, 0, hw, 0, 0, 0, height, 0, hw, 0, 0, -hw, 0, 0, 0, height, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/** Catenary-ish sagging curve between two points (for wires and string lights). */
export function sagCurve(a: THREE.Vector3, b: THREE.Vector3, sag: number, n: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = a.clone().lerp(b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  return pts;
}
