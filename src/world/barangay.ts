import * as THREE from 'three';
import type { Physics } from '../core/physics';
import type { Quality } from '../core/save';
import { Kit, StaticBuilder, noise2, sagCurve, type Frame } from './geo';
import type { Lighting } from './lighting';
import {
  B, C, TexKit, arch, coconut, court, house, jeepney, langitArea, local, parolGeometry,
  pottedPlant, sampayan, sariSari, shade, tree, tricycle, waitingShed,
} from './props';
import { capizTexture, courtTexture, radialTexture, signTexture, storeWindowTexture } from './textures';

/**
 * MAP LAYOUT (meters, ~60 x 60, Y up). Main road runs along X at z = 0.
 *
 *   z = -30  ------------------- fence -------------------
 *            back houses, sampayan, alleys (Taguan)
 *   z = -10  houses | waiting shed | alley | SARI-SARI (Sipa) | houses (videoke)
 *   z =  -4  sidewalk + electric posts with street lamps
 *   z =   0  ======== MAIN ROAD (jeepneys, tricycle) ========  arch at x = +28
 *   z =  +4  sidewalk + posts
 *   z = +12  PLAZA (Tumbang Preso) | COVERED COURT (Patintero) | crates (Langit-Lupa)
 *   z = +24  acacia tree, mango tree, houses
 *   z = +30  ------------------- fence -------------------
 */
export const HALF = 29.7;

export interface World {
  spawn: { pos: THREE.Vector3; yaw: number };
  /** Street lamp head positions (moths circle these). */
  lampHeads: THREE.Vector3[];
  triangles: number;
  update(dt: number, t: number): void;
}

const F0: Frame = { x: 0, z: 0, rot: 0 };

/** Electric posts with a street lamp arm. Arm points along local +Z toward the road. */
const LAMPS: Frame[] = [
  ...[-22, -9.5, 10.5, 24].map((x) => ({ x, z: -4.85, rot: 0 })),
  ...[-15, 2, 17].map((x) => ({ x, z: 4.85, rot: Math.PI })),
  { x: -22, z: 7.2, rot: 0 },
  { x: -9, z: 20.5, rot: Math.PI },
  { x: 27.6, z: 11, rot: -Math.PI / 2 },
];

const STORE: Frame = { x: 6, z: -10.5, rot: 0 };
const COURT: Frame = { x: 10, z: 16, rot: 0 };

export function buildBarangay(scene: THREE.Scene, phys: Physics, lighting: Lighting, quality: Quality): World {
  scene.fog = new THREE.FogExp2(0x0d1433, quality === 'high' ? 0.022 : 0.026);
  scene.background = new THREE.Color(0x070b1d);

  // ---------------------------------------------------------------- lights (registered BEFORE geometry so it can be baked)
  const lampHeads = LAMPS.map((f) => local(f, 0, 5.05, 1.5));
  for (const h of lampHeads) lighting.add(h.x, h.y - 0.1, h.z, 0xffa04a, 1.55, 11.5);
  const storeBulb = local(STORE, 0, 2.55, 3.1);
  lighting.add(storeBulb.x, storeBulb.y, storeBulb.z, 0xffd29a, 1.7, 8.5);
  lighting.add(STORE.x - 0.3, 1.6, STORE.z + 2.6, 0xffc07a, 0.8, 4.5, false);
  const courtStrings = [0xff5d73, 0xffd166, 0x5ee6a8, 0x6fb7ff];
  const floodA = local(COURT, -4, 5.8, 0), floodB = local(COURT, 4, 5.8, 0);
  lighting.add(floodA.x, floodA.y, floodA.z, 0xfff0d0, 1.0, 10.5);
  lighting.add(floodB.x, floodB.y, floodB.z, 0xfff0d0, 1.0, 10.5);
  courtStrings.forEach((c, i) => lighting.add(COURT.x - 6 + i * 4, 4.8, COURT.z + (i % 2 ? 3 : -3), c, 0.35, 6, false));
  lighting.add(-1, 2.8, -12.8, 0xffcf8a, 0.9, 6.5); // bare bulb in the Taguan alley
  lighting.add(23.5, 2.2, -7.2, 0xd36bff, 0.55, 6, false); // videoke party lights
  lighting.add(-24, 1.6, -6.7, 0xffb066, 0.45, 4.5, false); // lit windows
  lighting.add(14.5, 3.8, -7.5, 0xffb066, 0.45, 4.5, false);
  lighting.add(24, 1.6, 18.6, 0xffb066, 0.45, 4.5, false);

  // ---------------------------------------------------------------- builders + textures
  const sb = new StaticBuilder(lighting);
  const kit = new Kit(sb, phys);
  const tex = new TexKit(lighting, kit);
  const T = {
    capiz: capizTexture(),
    store: storeWindowTexture(),
    signStore: signTexture([{ text: 'ALING NENA STORE', size: 46, color: '#ffffff' }, { text: 'Ice Cold COLA', size: 30, color: '#ffe066' }], '#c62828', 512, 128, { badge: 'COLA' }),
    signShed: signTexture([{ text: 'WAITING SHED', size: 52, color: '#1b4332' }, { text: 'Handog ng Barangay 143', size: 28, color: '#6a040f' }], '#f3e6b0', 512, 128),
    signCourt: signTexture([{ text: 'BRGY. 143 COVERED COURT', size: 56, color: '#ffffff' }], '#1d3557', 640, 80),
    signArch: signTexture([{ text: 'SALAMAT PO! BALIK KAYO SA BARANGAY 143', size: 64, color: '#fff3c4' }], '#1f5f52', 1024, 104, { border: '#e9c46a' }),
    signBawal: signTexture([{ text: 'BAWAL DUMAAN', size: 60, color: '#ffffff' }], '#b71c1c', 512, 128, { border: '#ffffff' }),
    jeepA: signTexture([{ text: 'BAYAN - PALENGKE', size: 54, color: '#ffef9f' }], '#7b1e3a', 512, 128),
    jeepB: signTexture([{ text: 'CUBAO - QUIAPO', size: 54, color: '#e0fbfc' }], '#0b3d91', 512, 128),
    court: courtTexture(),
  };
  const b: B = { kit, tex, T };

  // ---------------------------------------------------------------- ground
  const grass = new THREE.Color(C.grass), dirt = new THREE.Color(C.dirt);
  const ground = new THREE.PlaneGeometry(64, 64, 48, 48).rotateX(-Math.PI / 2);
  sb.add(ground, C.grass, undefined, {
    colorAt: (p, out) => {
      const n = noise2(p.x * 0.22, p.z * 0.22) * 0.6 + noise2(p.x * 0.8, p.z * 0.8) * 0.4;
      let d = 0.3 + n * 0.55;
      if (p.x < -4 && p.z > 5.5 && p.z < 23) d = 0.82 + n * 0.18; // packed-dirt plaza
      if (Math.abs(p.z) < 7) d = 0.85;
      out.copy(grass).lerp(dirt, THREE.MathUtils.clamp(d, 0, 1));
    },
  });
  sb.add(new THREE.PlaneGeometry(420, 420).rotateX(-Math.PI / 2).translate(0, -0.04, 0), 0x0b1020, undefined, { lit: false });
  phys.addBox(0, -0.5, 0, 200, 0.5, 200);

  // ---------------------------------------------------------------- road + sidewalks
  sb.add(new THREE.PlaneGeometry(130, 7, 65, 3).rotateX(-Math.PI / 2).translate(0, 0.02, 0), C.asphalt, undefined, { noise: 0.25 });
  const dash = new THREE.PlaneGeometry(1.4, 0.12).rotateX(-Math.PI / 2);
  for (let x = -60; x <= 60; x += 3) sb.add(dash, C.roadLine, new THREE.Matrix4().makeTranslation(x, 0.03, 0), { noise: 0.3 });
  const edge = new THREE.PlaneGeometry(130, 0.1).rotateX(-Math.PI / 2);
  for (const z of [-3.3, 3.3]) sb.add(edge, 0xcfcac0, new THREE.Matrix4().makeTranslation(0, 0.03, z));
  for (const s of [-1, 1]) {
    kit.box(F0, 0, 0, s * 4.25, 130, 0.12, 1.5, C.concrete, { collide: true, noise: 0.25 });
    kit.box(F0, 0, 0, s * 3.53, 130, 0.14, 0.12, C.curb);
  }

  // ---------------------------------------------------------------- north side
  house(b, { x: -24, z: -10, rot: 0 }, { w: 7, d: 6, floors: 2, wall: 0xd8cfa8, roof: C.roofRust, litWindows: true });
  house(b, { x: -15.5, z: -10.5, rot: 0 }, { w: 5.6, d: 6, floors: 1, wall: 0x9fc3b8, roof: C.roofBlue });
  house(b, { x: -8.6, z: -11, rot: 0 }, { w: 4.8, d: 5.5, floors: 1, wall: 0xe7d27a, roof: C.roofGalv, door: 0.8 });
  waitingShed(b, { x: -2.2, z: -5.6, rot: 0 });
  sariSari(b, STORE);
  house(b, { x: 14.5, z: -11, rot: 0 }, { w: 6, d: 6, floors: 2, wall: 0xe0a8a0, upper: 0x7a4b2c, roof: C.roofRed, litWindows: true });
  house(b, { x: 23.5, z: -10.5, rot: 0 }, { w: 7, d: 6, floors: 1, wall: 0xa9bfe0, roof: C.roofGalv });
  // back row
  house(b, { x: -21, z: -22, rot: 0 }, { w: 8, d: 6, floors: 2, wall: 0xc9c2b0, upper: 0x6f4a2c, roof: C.roofGreen });
  house(b, { x: -8, z: -22.5, rot: 0 }, { w: 7, d: 6, floors: 1, wall: 0xf2b880, roof: C.roofRust });
  house(b, { x: 4, z: -21.5, rot: 0 }, { w: 6, d: 6, floors: 2, wall: 0xb8d8ba, roof: C.roofGalv });
  house(b, { x: 17, z: -22, rot: 0 }, { w: 8, d: 7, floors: 1, wall: 0xd4a5a5, roof: C.roofBlue, litWindows: true });
  sampayan(b, { x: -13.5, z: -16.5, rot: 0.1 });
  // Taguan hiding props in the alleys
  pottedPlant(b, -4.5, -9, 1.2);
  pottedPlant(b, 2.6, -14.5, 1.0);
  pottedPlant(b, 10.5, -15, 1.3);
  kit.cyl({ x: -4.2, z: -15, rot: 0 }, 0, 0, 0, 0.32, 0.32, 0.9, 0x2a6f97, { collide: true, seg: 10 });
  kit.cyl({ x: -3.5, z: -15.6, rot: 0 }, 0, 0, 0, 0.32, 0.32, 0.9, 0x6a994e, { collide: true, seg: 10 });
  kit.box({ x: 1.5, z: -17.5, rot: 0.3 }, 0, 0, 0, 1.2, 1.0, 1.2, C.wood, { collide: true, noise: 0.3 });
  kit.box({ x: -1, z: -13.2, rot: 0 }, 0, 2.7, 0, 0.05, 0.25, 0.05, 0x333333);

  // ---------------------------------------------------------------- road vehicles + landmarks
  jeepney(b, { x: -5.5, z: 1.9, rot: Math.PI / 2 }, 0xd2364a, 0xf2c230, 0x2f6fd6, T.jeepA);
  jeepney(b, { x: 18.5, z: -1.9, rot: -Math.PI / 2 }, 0x2f6fd6, 0xf2c230, 0xffffff, T.jeepB);
  tricycle(b, { x: 5, z: 2.3, rot: Math.PI / 2 }, 0xf2c230);
  arch(b, { x: 28.2, z: 0, rot: -Math.PI / 2 });
  arch(b, { x: -28.2, z: 0, rot: Math.PI / 2 }); // west arch (road stays open for traffic)

  // ---------------------------------------------------------------- south side
  const courtInfo = court(b, COURT);
  tree(b, -25, 23, 'acacia', 1);
  tree(b, -2.5, 25, 'mango', 2);
  coconut(b, -6, 8, 0.4);
  coconut(b, 19.5, 6.5, 2.6, 7.5);
  coconut(b, -27, -15, 1.2);
  coconut(b, 12, 27, 4.0, 7);
  house(b, { x: 24, z: 23, rot: Math.PI }, { w: 7, d: 6, floors: 2, wall: 0xf1e3c8, upper: 0x8a5a36, roof: C.roofRust, litWindows: true });
  house(b, { x: -14, z: 26.5, rot: Math.PI }, { w: 6, d: 4.5, floors: 1, wall: 0xc2d3a0, roof: C.roofGalv });
  house(b, { x: 4, z: 26.5, rot: Math.PI }, { w: 6, d: 4.5, floors: 1, wall: 0xe8b4bc, roof: C.roofRed });
  langitArea(b, { x: 23.5, z: 11, rot: 0 });

  // ---------------------------------------------------------------- distant silhouettes past the fence
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + 0.05;
    const r = 36 + (i % 4) * 5;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(z) < 7) continue;
    const f: Frame = { x, z, rot: -a };
    if (i % 3 === 0) {
      kit.geo(f, new THREE.IcosahedronGeometry(1, 0).scale(3.5, 3, 3.5), 0x0b1424, 0, 4 + (i % 2), 0, { lit: false });
    } else {
      const w = 5 + (i % 3) * 1.5, h = 3 + (i % 4) * 1.4;
      kit.box(f, 0, 0, 0, w, h, 5, 0x0d1222, { lit: false });
      if (i % 2 === 0) kit.box(f, w * 0.2, h * 0.45, -2.53, 0.7, 0.6, 0.02, 0xffb35c, { lit: false, bright: 1.1, ry: 0 });
      if (i % 5 === 0) kit.box(f, -w * 0.25, h * 0.45, -2.53, 0.7, 0.6, 0.02, 0xffe0a0, { lit: false, bright: 0.9 });
    }
  }

  // ---------------------------------------------------------------- perimeter walls (colliders)
  phys.addBox(0, 1, -HALF - 0.3, 31, 2, 0.3);
  phys.addBox(0, 1, HALF + 0.3, 31, 2, 0.3);
  phys.addBox(-HALF - 0.3, 1, 0, 0.3, 2, 31);
  phys.addBox(HALF + 0.3, 1, 0, 0.3, 2, 31);

  // ---------------------------------------------------------------- build the merged static meshes
  const staticMesh = sb.build(new THREE.MeshBasicMaterial({ vertexColors: true }));
  if (staticMesh) scene.add(staticMesh);
  tex.build(scene);

  // ---------------------------------------------------------------- instanced props: electric posts + fences
  buildLampPosts(scene, lighting);
  buildFences(scene, lighting);

  // ---------------------------------------------------------------- wires, glows, string lights, parols
  buildWires(scene);
  const glowTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64, [[0.2, 'rgba(255,255,255,0.6)'], [0.5, 'rgba(255,255,255,0.12)']]);
  const glow = (p: THREE.Vector3, color: number, size: number) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    s.position.copy(p);
    s.scale.setScalar(size);
    scene.add(s);
    return s;
  };
  const lampGlows = lampHeads.map((h) => glow(h.clone().setY(h.y - 0.12), 0xffb35c, 2.6));
  // one old lamp near the plaza flickers now and then
  const flicker = lampGlows[4];
  let flickT = 6;
  glow(storeBulb, 0xffe0a8, 1.4);
  glow(floodA, 0xfff0d0, 2.4);
  glow(floodB, 0xfff0d0, 2.4);

  // light pools on the ground under lamps (one merged additive mesh)
  {
    const pool = new StaticBuilder(lighting, true);
    const q = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (const h of lampHeads) {
      const m = new THREE.Matrix4().makeScale(9, 1, 9).setPosition(h.x, 0.045, h.z);
      pool.add(q, 0xff9a3c, m, { lit: false, bright: 0.45 });
    }
    const m = new THREE.Matrix4().makeScale(7, 1, 7).setPosition(storeBulb.x, 0.05, storeBulb.z);
    pool.add(q, 0xffc985, m, { lit: false, bright: 0.4 });
    const mesh = pool.build(new THREE.MeshBasicMaterial({
      map: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 128, [[0.4, 'rgba(255,255,255,0.45)']]),
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    if (mesh) scene.add(mesh);
  }

  // string lights (court + store awning): wire lines + bulb points
  const bulbs: number[] = [];
  const bulbCols: number[] = [];
  const wirePts: number[] = [];
  const palette = [0xff4d6d, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xf72585, 0xffffff].map((h) => new THREE.Color(h));
  const addString = (a: THREE.Vector3, c: THREE.Vector3, sag: number, n: number) => {
    const pts = sagCurve(a, c, sag, n);
    for (let i = 0; i < pts.length - 1; i++) wirePts.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
    for (let i = 1; i < pts.length - 1; i++) {
      bulbs.push(pts[i].x, pts[i].y - 0.06, pts[i].z);
      const col = palette[(i + bulbs.length) % palette.length];
      bulbCols.push(col.r, col.g, col.b);
    }
  };
  for (const [p, q] of courtInfo.strings) addString(p, q, 0.7, 16);
  addString(local(STORE, -2.75, 2.45, 3.97), local(STORE, 2.75, 2.45, 3.97), 0.25, 10);
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
  scene.add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x15171c })));
  const bulbGeo = new THREE.BufferGeometry();
  bulbGeo.setAttribute('position', new THREE.Float32BufferAttribute(bulbs, 3));
  bulbGeo.setAttribute('color', new THREE.Float32BufferAttribute(bulbCols, 3));
  const bulbMat = new THREE.PointsMaterial({ size: 0.42, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  scene.add(new THREE.Points(bulbGeo, bulbMat));

  // parols (star lanterns)
  const parolMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
  const parolPos = [local(STORE, 2.75, 2.0, 4.1), new THREE.Vector3(-24 + 1.5, 4.4, -6.75), new THREE.Vector3(14.5, 4.2, -7.75)];
  const parolCols = [0xffd166, 0xff5d8f, 0x6fd3ff];
  const parols: THREE.Mesh[] = [];
  parolPos.forEach((p, i) => {
    const m = new THREE.Mesh(parolGeometry(0.42), parolMat.clone());
    (m.material as THREE.MeshBasicMaterial).color.set(parolCols[i]);
    m.position.copy(p);
    scene.add(m);
    parols.push(m);
    glow(p, parolCols[i], 1.8);
  });

  // videoke window: cycling party colors (its own tiny material)
  const vkMat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
  const vk = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.0), vkMat);
  vk.position.set(23.5 + 1.2, 1.5, -10.5 + 3.02);
  scene.add(vk);
  const vkColors = [0xff3df5, 0x3dd9ff, 0xffe53d, 0x5dff7a].map((h) => new THREE.Color(h));

  return {
    spawn: { pos: new THREE.Vector3(-1.5, 0.2, 7.2), yaw: -0.25 },
    lampHeads,
    triangles: 0,
    update(dt: number, t: number) {
      flickT -= dt;
      if (flickT < 0) {
        // a burst of 0.6 s of stutter, then steady for a while
        const on = Math.sin(t * 61) * Math.sin(t * 23) > -0.2;
        (flicker.material as THREE.SpriteMaterial).opacity = on ? 1 : 0.15;
        if (flickT < -0.6) {
          flickT = 4 + Math.random() * 7;
          (flicker.material as THREE.SpriteMaterial).opacity = 1;
        }
      }
      const i = Math.floor(t * 1.6) % vkColors.length;
      vkMat.color.copy(vkColors[i]).lerp(vkColors[(i + 1) % vkColors.length], (t * 1.6) % 1);
      bulbMat.opacity = 0.85 + Math.sin(t * 2.3) * 0.1;
      for (let k = 0; k < parols.length; k++) parols[k].rotation.y = Math.sin(t * 0.8 + k) * 0.25;
    },
  };
}

// ------------------------------------------------------------------------- instanced posts

function buildLampPosts(scene: THREE.Scene, lighting: Lighting): void {
  const sb = new StaticBuilder(lighting);
  const kit = new Kit(sb, null as unknown as Physics);
  const f: Frame = { x: 0, z: 0, rot: 0 };
  kit.cyl(f, 0, 0, 0, 0.11, 0.16, 7.6, 0x8c8a86, { lit: false, seg: 7 });
  kit.box(f, 0, 7.05, 0, 1.8, 0.12, 0.12, 0x4e3320, { lit: false });
  for (const x of [-0.75, 0, 0.75]) kit.box(f, x, 7.17, 0, 0.07, 0.12, 0.07, 0xdedede, { lit: false });
  kit.box(f, 0, 5.15, 0.75, 0.07, 0.07, 1.5, 0x55585e, { lit: false, rx: -0.08 });
  kit.box(f, 0, 5.02, 1.5, 0.3, 0.14, 0.5, 0x3a3d42, { lit: false });
  kit.box(f, 0, 4.96, 1.5, 0.22, 0.04, 0.36, 0xffd9a0, { lit: false, bright: 5 });
  // transformer on the first post
  const mesh = sb.build(new THREE.MeshBasicMaterial({ vertexColors: true }))!;
  const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, LAMPS.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const n = new THREE.Vector3(0, 0.3, 1).normalize();
  LAMPS.forEach((L, i) => {
    m.makeRotationY(L.rot).setPosition(L.x, 0, L.z);
    inst.setMatrixAt(i, m);
    lighting.bake(new THREE.Vector3(L.x, 2.5, L.z), n.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), L.rot), new THREE.Color(1, 1, 1), c);
    inst.setColorAt(i, c.multiplyScalar(1.3));
  });
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  scene.add(inst);
}

function buildFences(scene: THREE.Scene, lighting: Lighting): void {
  const sb = new StaticBuilder(lighting);
  const kit = new Kit(sb, null as unknown as Physics);
  const f: Frame = { x: 0, z: 0, rot: 0 };
  kit.box(f, 0, 0, 0, 2.0, 1.6, 0.18, C.block, { lit: false, noise: 0.15 });
  kit.box(f, 0, 1.6, 0, 2.05, 0.08, 0.26, 0xd8d2c4, { lit: false });
  kit.box(f, 0.95, 0, 0, 0.26, 1.78, 0.26, 0xc9c2b2, { lit: false });
  kit.box(f, 0, 0.9, 0.095, 2.0, 0.18, 0.01, 0x3e7c6b, { lit: false });
  kit.box(f, 0, 0.9, -0.095, 2.0, 0.18, 0.01, 0x3e7c6b, { lit: false });
  const mesh = sb.build(new THREE.MeshBasicMaterial({ vertexColors: true }))!;

  const spots: [number, number, number][] = [];
  for (let x = -HALF + 1; x < HALF; x += 2) {
    spots.push([x, -HALF, 0]);
    spots.push([x, HALF, Math.PI]);
  }
  for (let z = -HALF + 1; z < HALF; z += 2) {
    if (Math.abs(z) < 5.5) continue; // road opening (closed off by invisible wall + arch/barricade)
    spots.push([-HALF, z, Math.PI / 2]);
    spots.push([HALF, z, -Math.PI / 2]);
  }
  const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, spots.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const n = new THREE.Vector3();
  spots.forEach(([x, z, rot], i) => {
    m.makeRotationY(rot).setPosition(x, 0, z);
    inst.setMatrixAt(i, m);
    n.set(-x, 0, -z).normalize();
    lighting.bake(new THREE.Vector3(x, 0.9, z), n, new THREE.Color(1, 1, 1), c);
    inst.setColorAt(i, c);
  });
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  scene.add(inst);
}

/** The famous tangle of electric wires between posts. */
function buildWires(scene: THREE.Scene): void {
  const pts: number[] = [];
  const add = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
    const c = sagCurve(a, b, sag, 10);
    for (let i = 0; i < c.length - 1; i++) pts.push(c[i].x, c[i].y, c[i].z, c[i + 1].x, c[i + 1].y, c[i + 1].z);
  };
  const north = LAMPS.slice(0, 4), south = LAMPS.slice(4, 7);
  for (const row of [north, south]) {
    const ext = [{ x: -45, z: row[0].z, rot: 0 }, ...row, { x: 45, z: row[0].z, rot: 0 }];
    for (let i = 0; i < ext.length - 1; i++) {
      const p = ext[i], q = ext[i + 1];
      for (const dx of [-0.75, 0, 0.75]) add(new THREE.Vector3(p.x + dx, 7.15, p.z), new THREE.Vector3(q.x + dx, 7.15, q.z), 0.8 + Math.abs(dx));
      add(new THREE.Vector3(p.x, 6.4, p.z), new THREE.Vector3(q.x, 6.2, q.z), 1.1);
    }
  }
  // street crossings and drops to houses
  add(new THREE.Vector3(-22, 7.0, -4.85), new THREE.Vector3(-15, 7.0, 4.85), 0.9);
  add(new THREE.Vector3(10.5, 7.0, -4.85), new THREE.Vector3(2, 7.0, 4.85), 1.0);
  add(new THREE.Vector3(10.5, 6.8, -4.85), new THREE.Vector3(8, 3.4, -8.6), 0.4);
  add(new THREE.Vector3(-9.5, 6.8, -4.85), new THREE.Vector3(-8.6, 3.0, -8.3), 0.35);
  add(new THREE.Vector3(24, 6.8, -4.85), new THREE.Vector3(23.5, 3.0, -7.6), 0.35);
  add(new THREE.Vector3(-22, 6.8, 7.2), new THREE.Vector3(-22, 6.9, -4.85), 1.2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x0c0d10 })));
}

export { shade };
