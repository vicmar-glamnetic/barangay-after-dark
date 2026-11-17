import * as THREE from 'three';
import type { AudioSys } from '../core/audio';
import { eventAt, slotPick, type NightEvent } from '../core/meta';
import type { Quality } from '../core/save';
import type { Lighting } from './lighting';
import { Kid } from './npcs';
import type { BlobShadows } from './shadows';

/** Where the sorbetero can park (open ground, away from game areas). */
const CART_SPOTS: [number, number, number][] = [
  [-0.5, 8.8, 0.4], [12.5, 6.8, 0], [-20, -16.6, 0.2], [-6.8, -17.6, 1.6], [25, -15.3, -0.3], [-1, -27, 0.1], [-24, -27, 0.5],
];
const CATCH_DIST = 2.2;

/**
 * Visual + audio side of the night events (logic lives in core/meta).
 * The event comes from the wall clock, so every player sees the same one
 * at the same time without any networking.
 */
export class NightEvents {
  current: NightEvent | null = null;
  slot = -1;
  leftMs = 0;
  /** Called when an event starts (toast) or ends. */
  onChange: ((ev: NightEvent | null) => void) | null = null;

  private checkT = 0;
  private power = 1;
  private powerTarget = 1;
  private flickT = 0;
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private rainOn = false;
  private rainK = 0;
  private cart = new THREE.Group();
  private vendor: Kid;
  private bellT = 0;
  readonly cartPos = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private lighting: Lighting,
    private setWorldPower: (k: number) => void,
    private audio: AudioSys,
    blobs: BlobShadows,
    quality: Quality,
  ) {
    // rain: short streaks in a box that follows the camera
    const n = quality === 'high' ? 1400 : 700;
    this.rainPos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) this.resetDrop(i, Math.random() * 14, new THREE.Vector3());
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);

    // sorbetero cart: box on wheels with an umbrella
    const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, basic = false) => {
      const m = new THREE.Mesh(geo, basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color }));
      m.position.set(x, y, z);
      this.cart.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(1.2, 0.7, 0.7), 0xf2f2f2, 0, 0.75, 0);
    add(new THREE.BoxGeometry(1.22, 0.16, 0.72), 0xe63946, 0, 0.55, 0);
    add(new THREE.BoxGeometry(1.22, 0.1, 0.72), 0x2a6fd6, 0, 1.0, 0);
    for (const x of [-0.25, 0.25]) add(new THREE.CylinderGeometry(0.17, 0.17, 0.2, 12), 0xffd166, x, 1.2, 0);
    for (const z of [-0.38, 0.38]) add(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 14).rotateX(Math.PI / 2), 0x222222, 0.3, 0.28, z);
    add(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), 0x999999, -0.45, 1.75, 0);
    const umb = add(new THREE.ConeGeometry(0.95, 0.4, 10, 1, true), 0xffd166, -0.45, 2.55, 0);
    (umb.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
    add(new THREE.SphereGeometry(0.12, 8, 6), 0xffe9a8, 0.0, 1.55, 0, true); // little lamp
    this.vendor = new Kid({ shirt: 0xffffff, shorts: 0x1d3557, skin: 0xb5764a, hair: 0x161210, girl: false, slipper: 0x111111 });
    this.vendor.root.scale.setScalar(1.25);
    this.vendor.root.position.set(-0.95, 0, 0.1);
    this.vendor.mode = 'wave';
    this.cart.add(this.vendor.root);
    this.cart.visible = false;
    scene.add(this.cart);
    blobs.add(this.cart, 1.1);
  }

  /** Tropa multiplier for a game finished right now. */
  get event(): NightEvent | null {
    return this.current;
  }

  get cartVisible(): boolean {
    return this.cart.visible;
  }

  /** Hide the cart once caught (it comes back next sorbetero event). */
  hideCart(): void {
    this.cart.visible = false;
  }

  private resetDrop(i: number, y: number, c: THREE.Vector3): void {
    const x = c.x + (Math.random() - 0.5) * 34;
    const z = c.z + (Math.random() - 0.5) * 34;
    const o = i * 6;
    this.rainPos[o] = x;
    this.rainPos[o + 1] = y;
    this.rainPos[o + 2] = z;
    this.rainPos[o + 3] = x + 0.03;
    this.rainPos[o + 4] = y + 0.45;
    this.rainPos[o + 5] = z + 0.02;
  }

  update(dt: number, t: number, cam: THREE.Vector3, caughtSlot: number): void {
    // re-check the clock once a second
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 1;
      const e = eventAt();
      const ev = e?.ev ?? null;
      this.leftMs = e?.leftMs ?? 0;
      if (ev?.id !== this.current?.id || (e && e.slot !== this.slot)) {
        this.current = ev;
        this.slot = e?.slot ?? -1;
        this.apply(caughtSlot);
        this.onChange?.(ev);
      }
    }

    // brownout: flicker, then fade
    if (this.power !== this.powerTarget) {
      this.flickT += dt;
      const flicker = this.flickT < 0.9 && Math.sin(this.flickT * 40) > 0;
      const k = this.flickT >= 0.9 ? this.powerTarget : flicker ? 1 - this.powerTarget : this.powerTarget;
      this.setWorldPower(k);
      this.lighting.setPower(k);
      if (this.flickT >= 0.9) this.power = this.powerTarget;
    }

    // rain
    this.rainK = THREE.MathUtils.clamp(this.rainK + (this.rainOn ? dt : -dt) * 0.5, 0, 1);
    this.rain.visible = this.rainK > 0.01;
    if (this.rain.visible) {
      (this.rain.material as THREE.LineBasicMaterial).opacity = 0.5 * this.rainK;
      const fall = 13 * dt;
      const p = this.rainPos;
      for (let i = 0, n = p.length / 6; i < n; i++) {
        const o = i * 6;
        p[o + 1] -= fall;
        p[o + 4] -= fall;
        if (p[o + 1] < 0 || Math.abs(p[o] - cam.x) > 18 || Math.abs(p[o + 2] - cam.z) > 18) this.resetDrop(i, cam.y + 2 + Math.random() * 10, cam);
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }

    // sorbetero: bell every few seconds, umbrella spins, vendor waves
    if (this.cart.visible) {
      this.vendor.update(dt, t);
      this.bellT -= dt;
      if (this.bellT <= 0) {
        this.bellT = 3.2 + Math.random() * 1.5;
        this.audio.play('bell', { pos: this.cartPos, vol: 1.4 });
      }
    }
  }

  private apply(caughtSlot: number): void {
    const id = this.current?.id;
    if ((id === 'brownout') !== (this.powerTarget < 1)) {
      this.powerTarget = id === 'brownout' ? 0 : 1;
      this.flickT = 0;
      this.audio.play('thud', { vol: 0.6 });
    }
    this.rainOn = id === 'ulan';
    this.audio.setRain(this.rainOn);
    const showCart = id === 'sorbetero' && caughtSlot !== this.slot;
    this.cart.visible = showCart;
    if (showCart) {
      const [x, z, rot] = CART_SPOTS[slotPick(this.slot, CART_SPOTS.length)];
      this.cart.position.set(x, 0, z);
      this.cart.rotation.y = rot;
      this.cartPos.set(x, 1.2, z);
      this.bellT = 0.5;
    }
  }

  /** Close enough to the cart to buy ice cream? */
  nearCart(p: THREE.Vector3): boolean {
    return this.cart.visible && Math.hypot(p.x - this.cart.position.x, p.z - this.cart.position.z) < CATCH_DIST;
  }

  dispose(): void {
    this.scene.remove(this.rain, this.cart);
  }
}
