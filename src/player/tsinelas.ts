import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Real-world size of the slipper (matches the physics collider in Tumbang Preso). */
export const TSINELAS = { length: 0.27, width: 0.11, thickness: 0.03 };

function colored(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const n of Object.keys(ng.attributes)) if (n !== 'position' && n !== 'normal') ng.deleteAttribute(n);
  const c = new THREE.Color(hex);
  const a = new Float32Array(ng.getAttribute('position').count * 3);
  for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
  ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return ng;
}

/**
 * Classic rubber tsinelas: two-tone sole (white sides, colored top) and a
 * V-strap from the toe post. Centered at its middle, toe toward -Z, lying flat.
 */
export function tsinelasGeometry(strap = 0x1f6fb2, top = 0x2f86d6): THREE.BufferGeometry {
  const { length: L, width: W, thickness: T } = TSINELAS;
  const shape = new THREE.Shape();
  // outline: rounded heel at +Z, wider rounded toe at -Z
  shape.moveTo(-W * 0.38, L * 0.42);
  shape.quadraticCurveTo(0, L * 0.56, W * 0.38, L * 0.42);
  shape.quadraticCurveTo(W * 0.42, 0, W * 0.5, -L * 0.25);
  shape.quadraticCurveTo(W * 0.42, -L * 0.54, 0, -L * 0.5);
  shape.quadraticCurveTo(-W * 0.42, -L * 0.54, -W * 0.5, -L * 0.25);
  shape.quadraticCurveTo(-W * 0.42, 0, -W * 0.38, L * 0.42);
  const ex = (depth: number) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 5 });
    g.rotateX(Math.PI / 2); // shape XY -> XZ, extrude goes down
    return g;
  };
  const sole = ex(T * 0.65);
  sole.translate(0, T * 0.15, 0);
  const topLayer = ex(T * 0.35);
  topLayer.translate(0, T * 0.5, 0);
  // V-strap: toe post at the front, two bands to the sides
  const post = new THREE.Vector3(0, T * 0.5, -L * 0.28);
  const parts = [colored(sole, 0xf2f2f2), colored(topLayer, top)];
  for (const sx of [-1, 1]) {
    const end = new THREE.Vector3(sx * W * 0.47, T * 0.5, -L * 0.02);
    const mid = post.clone().lerp(end, 0.5);
    mid.y += 0.03;
    const len = post.distanceTo(end) + 0.02;
    const band = new THREE.BoxGeometry(0.02, 0.014, len);
    band.rotateY(Math.atan2(end.x - post.x, end.z - post.z));
    band.translate(mid.x, mid.y - 0.012, mid.z);
    parts.push(colored(band, strap));
  }
  parts.push(colored(new THREE.CylinderGeometry(0.007, 0.007, 0.03, 5).translate(post.x, post.y + 0.015, post.z), strap));
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** The player's chosen tsinelas colors (Settings). Tumbang Preso throws use these. */
export const slipperColors = { strap: 0x1f6fb2, top: 0x2f86d6 };

export const tsinelasMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
