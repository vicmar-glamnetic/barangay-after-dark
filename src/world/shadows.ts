import * as THREE from 'three';
import { radialTexture } from './textures';

interface Item {
  obj: THREE.Object3D;
  size: number;
}

/**
 * Fake blob shadows for every moving object, drawn with ONE instanced mesh.
 * Ground height comes from a downward raycast against static colliders.
 */
export class BlobShadows {
  private mesh: THREE.InstancedMesh;
  private items = new Set<Item>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(scene: THREE.Scene, private groundAt: (x: number, z: number, fromY: number) => number, max = 64) {
    const mat = new THREE.MeshBasicMaterial({
      map: radialTexture('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)', 64, [[0.5, 'rgba(0,0,0,0.45)']]),
      transparent: true,
      depthWrite: false,
      color: 0x000000,
    });
    // The texture carries the alpha; color multiplies to black.
    mat.color.set(0xffffff);
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  add(obj: THREE.Object3D, size: number): () => void {
    const it = { obj, size };
    this.items.add(it);
    return () => this.items.delete(it);
  }

  update(): void {
    let i = 0;
    for (const it of this.items) {
      if (!it.obj.visible || !it.obj.parent) continue;
      if (i >= this.mesh.instanceMatrix.count) break;
      it.obj.getWorldPosition(this.p);
      const gy = this.groundAt(this.p.x, this.p.z, this.p.y + 0.3);
      const h = Math.max(0, this.p.y - gy);
      const k = it.size * (1 - Math.min(0.5, h * 0.25));
      this.p.y = gy + 0.025;
      this.m.compose(this.p, this.q, this.s.set(k, k, 1));
      this.mesh.setMatrixAt(i++, this.m);
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
