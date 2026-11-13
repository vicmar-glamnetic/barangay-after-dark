import RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/**
 * Thin wrapper around a Rapier world.
 * All static map geometry hangs off one fixed body as individual colliders.
 */
export class Physics {
  readonly world: World;
  readonly staticBody: RigidBody;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  /** Rapier compat ships its WASM inline; init() just instantiates it. */
  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.staticBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  /** Static box collider from center + half extents and optional rotation. */
  addBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, q?: THREE.Quaternion): Collider {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setFriction(0.8);
    if (q) desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    return this.world.createCollider(desc, this.staticBody);
  }

  /** Static box collider whose center/rotation come from a world matrix (scale ignored). */
  addBoxMatrix(m: THREE.Matrix4, hx: number, hy: number, hz: number): Collider {
    m.decompose(_p, _q, _s);
    return this.addBox(_p.x, _p.y, _p.z, hx * _s.x, hy * _s.y, hz * _s.z, _q);
  }

  addCylinder(cx: number, cy: number, cz: number, halfH: number, r: number): Collider {
    const desc = RAPIER.ColliderDesc.cylinder(halfH, r).setTranslation(cx, cy, cz);
    return this.world.createCollider(desc, this.staticBody);
  }

  /** Height of the static world below (x, fromY, z). Used for blob shadows and spawning. */
  groundAt(x: number, z: number, fromY = 20): number {
    this.ray.origin = { x, y: fromY, z };
    this.ray.dir = { x: 0, y: -1, z: 0 };
    const hit = this.world.castRay(this.ray, fromY + 5, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
    if (!hit) return 0;
    const toi = (hit as unknown as { timeOfImpact?: number; toi?: number }).timeOfImpact ??
      (hit as unknown as { toi: number }).toi;
    return fromY - toi;
  }

  step(dt: number): void {
    this.world.timestep = Math.min(Math.max(dt, 1 / 240), 1 / 30);
    this.world.step();
  }
}
