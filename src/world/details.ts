import * as THREE from 'three';
import { sagCurve, type Frame } from './geo';
import { C, shade, type B } from './props';

/*
 * Small "typical barangay" details: monobloc chairs, a chismisan table,
 * painted tire planters, plants in old paint cans, a tanod outpost, a
 * videoke speaker, a palanggana with a washboard, a bamboo chicken coop and
 * banderitas (fiesta buntings) across the road.
 * All static and merged into the baked world mesh, so they cost ~nothing.
 */

/** Plastic monobloc chair. Faces local +Z. */
export function monobloc(b: B, f: Frame, color = 0xf2f2f2): void {
  const { kit } = b;
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) kit.cyl(f, x, 0, z, 0.025, 0.03, 0.42, color, { seg: 6 });
  kit.box(f, 0, 0.42, 0, 0.46, 0.04, 0.46, color);
  kit.box(f, 0, 0.46, -0.21, 0.46, 0.5, 0.04, color, { rx: -0.12 });
  b.kit.phys.addBoxMatrix(kit.matrix(f, 0, 0.3, 0), 0.24, 0.3, 0.24);
}

/** Round-ish plastic table with soft drink bottles and a plate of chicharon. */
export function chismisTable(b: B, f: Frame): void {
  const { kit } = b;
  kit.cyl(f, 0, 0, 0, 0.06, 0.12, 0.7, 0x2f6fb2, { seg: 8 });
  kit.cyl(f, 0, 0.7, 0, 0.45, 0.45, 0.04, 0x3a86d6, { seg: 16, collide: true });
  const bottle = (x: number, z: number, col: number) => {
    kit.cyl(f, x, 0.74, z, 0.035, 0.035, 0.16, col, { seg: 8 });
    kit.cyl(f, x, 0.9, z, 0.015, 0.03, 0.07, col, { seg: 6 });
  };
  bottle(-0.15, 0.1, 0x3b1e0f);
  bottle(0.05, 0.2, 0x2e7d32);
  bottle(0.18, -0.08, 0x3b1e0f);
  kit.cyl(f, -0.1, 0.74, -0.18, 0.13, 0.11, 0.02, 0xf5f5f5, { seg: 12 });
  for (let i = 0; i < 6; i++) kit.box(f, -0.1 + Math.cos(i) * 0.06, 0.76, -0.18 + Math.sin(i * 2) * 0.05, 0.05, 0.02, 0.04, 0xd9a35a);
}

/** Old tire, painted, with a plant growing in it. */
export function tirePlanter(b: B, x: number, z: number, paint: number): void {
  const f: Frame = { x, z, rot: x };
  b.kit.geo(f, new THREE.TorusGeometry(0.32, 0.11, 6, 14).rotateX(Math.PI / 2), paint, 0, 0.11, 0, { noise: 0.2 });
  b.kit.cyl(f, 0, 0, 0, 0.26, 0.26, 0.16, C.dirt, { seg: 10 });
  for (let i = 0; i < 4; i++)
    b.kit.geo(f, new THREE.IcosahedronGeometry(0.17, 0), i % 2 ? C.leaves2 : C.leaves, Math.cos(i * 1.6) * 0.1, 0.3 + (i % 2) * 0.12, Math.sin(i * 1.6) * 0.1, { noise: 0.4 });
  b.kit.phys.addCylinder(x, 0.2, z, 0.2, 0.4);
}

/** A plant in a rusty paint can. */
export function canPlant(b: B, x: number, z: number, s = 1): void {
  const f: Frame = { x, z, rot: 0 };
  b.kit.cyl(f, 0, 0, 0, 0.14 * s, 0.14 * s, 0.26 * s, 0x9a7b5a, { seg: 10, noise: 0.35 });
  b.kit.cyl(f, 0, 0.1 * s, 0, 0.142 * s, 0.142 * s, 0.07 * s, [0xd62828, 0x1d4ed8, 0xf2c230][Math.abs(Math.round(x * 3)) % 3], { seg: 10 });
  for (let i = 0; i < 3; i++)
    b.kit.geo(f, new THREE.IcosahedronGeometry(0.13 * s, 0), i % 2 ? C.leaves2 : C.leaves, Math.cos(i * 2.1) * 0.06, (0.36 + i * 0.07) * s, Math.sin(i * 2.1) * 0.06, { noise: 0.4 });
}

/** Barangay tanod outpost: a small plywood booth with a sign and a bench. Front faces local +Z. */
export function tanodBooth(b: B, f: Frame): void {
  const { kit, tex, T } = b;
  const wall = 0xe9e2c6;
  kit.box(f, 0, 0, -0.75, 1.6, 2.2, 0.08, wall, { collide: true, noise: 0.2 });
  for (const sx of [-1, 1]) kit.box(f, sx * 0.76, 0, -0.35, 0.08, 2.2, 0.8, wall, { collide: true, noise: 0.2 });
  kit.box(f, 0, 0, 0.0, 1.6, 0.95, 0.08, 0x1d4e89, { collide: true });
  kit.box(f, 0, 0.95, 0.02, 1.7, 0.06, 0.3, C.wood);
  kit.box(f, 0, 2.2, -0.3, 1.9, 0.08, 1.3, C.roofBlue, { rx: 0.12 });
  tex.quad(T.signTanod, f, 0, 1.78, 0.06, 1.5, 0.42, { lit: true, bright: 1.1 });
  // log book on the counter
  kit.box(f, 0.3, 0.98, 0.05, 0.3, 0.03, 0.22, 0x8b1e1e);
  // a pitcher of water and a radio
  kit.cyl(f, -0.4, 0.98, 0.04, 0.06, 0.07, 0.18, 0x8ecae6, { seg: 8 });
  kit.box(f, -0.1, 0.98, 0.03, 0.22, 0.12, 0.08, 0x222222);
}

/** Big videoke speaker box on the sidewalk. Faces local +Z. */
export function videokeSpeaker(b: B, f: Frame): void {
  const { kit } = b;
  kit.box(f, 0, 0, 0, 0.55, 0.9, 0.45, 0x1b1b1f, { collide: true });
  kit.geo(f, new THREE.CircleGeometry(0.18, 16), 0x3a3a44, 0, 0.32, 0.23, {});
  kit.geo(f, new THREE.CircleGeometry(0.08, 12), 0x55555f, 0, 0.32, 0.235, {});
  kit.geo(f, new THREE.CircleGeometry(0.07, 12), 0x3a3a44, 0, 0.72, 0.23, {});
}

/** Palanggana (wash basin) with a washboard and a scrub brush. */
export function palanggana(b: B, f: Frame): void {
  const { kit } = b;
  kit.cyl(f, 0, 0, 0, 0.42, 0.3, 0.22, 0x2a9d8f, { seg: 16, collide: true });
  kit.cyl(f, 0, 0.18, 0, 0.38, 0.38, 0.01, 0xcfe8ff, { seg: 16, bright: 1.05 });
  kit.box(f, 0.15, 0.05, 0.05, 0.32, 0.5, 0.03, C.wood, { rx: -0.9 });
  for (let i = 0; i < 5; i++) kit.box(f, 0.15, 0.1 + i * 0.07, 0.12 + i * 0.05, 0.3, 0.012, 0.012, C.darkWood, { rx: -0.9 });
  kit.box(f, -0.55, 0, 0.1, 0.16, 0.05, 0.08, 0xf2c230);
  kit.box(f, -0.75, 0, -0.2, 0.32, 0.26, 0.3, 0xf28482, {}); // laundry basket
}

/** Bamboo chicken coop (kulungan) with a rooster's perch. Front faces local +Z. */
export function chickenCoop(b: B, f: Frame): void {
  const { kit } = b;
  const bamboo = 0xc8b26a;
  kit.box(f, 0, 0, 0, 1.0, 0.06, 0.7, shade(bamboo, 0.8), { collide: true });
  for (let i = 0; i <= 8; i++) {
    kit.cyl(f, -0.48 + i * 0.12, 0.06, 0.33, 0.015, 0.015, 0.7, bamboo, { seg: 5 });
    kit.cyl(f, -0.48 + i * 0.12, 0.06, -0.33, 0.015, 0.015, 0.7, bamboo, { seg: 5 });
  }
  for (const z of [-0.33, 0.33]) kit.box(f, 0, 0.76, z, 1.0, 0.04, 0.04, shade(bamboo, 0.85));
  kit.box(f, 0, 0.76, 0, 1.1, 0.04, 0.8, 0x8a7350);
  b.kit.phys.addBoxMatrix(kit.matrix(f, 0, 0.4, 0), 0.5, 0.4, 0.35);
}

/**
 * Banderitas: strings of small triangular flags in fiesta colors, sagging
 * between two points. Flags are double-sided so they read from both ways.
 */
export function banderitas(b: B, a: THREE.Vector3, c: THREE.Vector3, sag = 0.7): THREE.Vector3[] {
  const len = a.distanceTo(c);
  const n = Math.max(6, Math.round(len / 0.5));
  const pts = sagCurve(a, c, sag, n);
  const cols = [0xe63946, 0xffd166, 0x06d6a0, 0x118ab2, 0xf72585, 0xffffff];
  const tri = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.16, 0), new THREE.Vector2(0.16, 0), new THREE.Vector2(0, -0.3)]));
  const dir = new THREE.Vector3().subVectors(c, a);
  const yaw = Math.atan2(dir.x, dir.z) - Math.PI / 2;
  const F: Frame = { x: 0, z: 0, rot: 0 };
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const col = cols[i % cols.length];
    b.kit.geo(F, tri, col, p.x, p.y, p.z, { ry: yaw, lit: false, bright: 0.75 });
    b.kit.geo(F, tri, shade(col, 0.85), p.x, p.y, p.z, { ry: yaw + Math.PI, lit: false, bright: 0.75 });
  }
  return pts; // the caller draws the string itself with the other wires
}
