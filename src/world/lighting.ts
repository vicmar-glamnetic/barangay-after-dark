import * as THREE from 'three';

/** A light that is baked into static vertex colors (and can drive a real point light). */
export interface BakeLight {
  pos: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  range: number;
  /** If true, the real point-light pool may use it to light moving objects. */
  dynamic: boolean;
}

const POOL_SIZE = 3;

/**
 * Lighting strategy (performance first):
 * - Static world: lighting is BAKED into vertex colors at build time (see bake()).
 *   It renders with MeshBasicMaterial, which costs almost nothing per pixel.
 * - Moving things (kids, can, slipper, sipa): MeshLambertMaterial lit by a
 *   hemisphere light, a dim moon light, and a pool of 3 point lights that
 *   follow the nearest lamps to the player.
 * - No shadow maps. Characters get blob shadows (world/shadows.ts).
 */
export class Lighting {
  readonly lights: BakeLight[] = [];
  readonly moonDir = new THREE.Vector3(-0.45, 0.62, -0.64).normalize();
  readonly hemi: THREE.HemisphereLight;
  readonly moon: THREE.DirectionalLight;
  private pool: THREE.PointLight[] = [];
  private poolTimer = 0;
  /** 1 = normal, lower = brownout (street lamps off, darker sky light). */
  private power = 1;

  constructor(scene: THREE.Scene) {
    this.hemi = new THREE.HemisphereLight(0x8ea3e6, 0x3b2b22, 1.5);
    scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0xbfd0ff, 0.55);
    this.moon.position.copy(this.moonDir).multiplyScalar(50);
    scene.add(this.moon);
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = new THREE.PointLight(0xffa04a, 0, 12, 1.4);
      this.pool.push(p);
      scene.add(p);
    }
  }

  add(x: number, y: number, z: number, color: THREE.ColorRepresentation, intensity: number, range: number, dynamic = true): BakeLight {
    const l: BakeLight = { pos: new THREE.Vector3(x, y, z), color: new THREE.Color(color), intensity, range, dynamic };
    this.lights.push(l);
    return l;
  }

  /**
   * Compute lit vertex color: albedo * (moonlit ambient + moon + sum of lamps),
   * plus a cheap ambient-occlusion darkening near the ground for walls.
   */
  bake(p: THREE.Vector3, n: THREE.Vector3, albedo: THREE.Color, out: THREE.Color): THREE.Color {
    const up = n.y * 0.5 + 0.5;
    let r = 0.07 + 0.11 * up;
    let g = 0.07 + 0.13 * up;
    let b = 0.11 + 0.22 * up;
    const md = Math.max(0, n.x * this.moonDir.x + n.y * this.moonDir.y + n.z * this.moonDir.z) * 0.22;
    r += 0.55 * md;
    g += 0.62 * md;
    b += 0.85 * md;
    for (const l of this.lights) {
      const dx = l.pos.x - p.x;
      const dy = l.pos.y - p.y;
      const dz = l.pos.z - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > l.range * l.range) continue;
      const d = Math.sqrt(d2) || 1e-4;
      const att = (1 - d / l.range) ** 2;
      const ndl = Math.max(0, (n.x * dx + n.y * dy + n.z * dz) / d) * 0.85 + 0.15;
      const f = l.intensity * att * ndl;
      r += l.color.r * f;
      g += l.color.g * f;
      b += l.color.b * f;
    }
    const ao = n.y > 0.7 ? 1 : 0.62 + 0.38 * Math.min(1, Math.max(0, p.y) / 1.6);
    return out.setRGB(albedo.r * r * ao, albedo.g * g * ao, albedo.b * b * ao);
  }

  /** Brownout: 0..1 multiplier on the lamp pool and the hemisphere light. */
  setPower(k: number): void {
    this.power = k;
    this.hemi.intensity = 1.5 * (0.45 + 0.55 * k);
    this.poolTimer = 0;
  }

  /** Move the real point lights to the lamps nearest the player. */
  update(dt: number, focus: THREE.Vector3): void {
    this.poolTimer -= dt;
    if (this.poolTimer > 0) return;
    this.poolTimer = 0.25;
    const near = this.lights
      .filter((l) => l.dynamic)
      .map((l) => ({ l, d: l.pos.distanceToSquared(focus) }))
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      const e = near[i];
      if (!e) {
        p.intensity = 0;
        continue;
      }
      p.position.copy(e.l.pos);
      p.color.copy(e.l.color);
      p.distance = e.l.range * 1.4;
      p.intensity = e.l.intensity * 9 * this.power;
    }
  }
}
