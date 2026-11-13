import * as THREE from 'three';
import { tsinelasGeometry, tsinelasMaterial } from './tsinelas';

const SKIN = 0xc68642;

/**
 * First-person view model, drawn in the separate hand scene (see core/renderer).
 * - Right hand holding a tsinelas (Tumbang Preso): aim pull-back and throw.
 * - A leg that swings up from the bottom of the screen (Sipa kicks).
 */
export class Hand {
  readonly root = new THREE.Group();
  private arm = new THREE.Group();
  private slipper: THREE.Mesh;
  private leg = new THREE.Group();

  private holding = false;
  private aim = -1; // -1 = not aiming, else 0..1 power
  private throwT = 1; // 0..1 animation progress
  private kickT = 1;
  private legOn = false;
  private swayT = 0;
  private restPos = new THREE.Vector3(0.32, -0.34, -0.62);

  constructor(scene: THREE.Scene) {
    const hemi = new THREE.HemisphereLight(0xa8b8ff, 0x3a2a1a, 2.2);
    const key = new THREE.DirectionalLight(0xffb070, 1.2);
    key.position.set(1, 1, 0.5);
    scene.add(hemi, key, this.root);

    const skin = new THREE.MeshLambertMaterial({ color: SKIN });
    const sleeve = new THREE.MeshLambertMaterial({ color: 0xe63946 });
    // forearm reaching up from the lower right, hand at the origin of `arm`
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.38), skin);
    fore.position.set(0.02, -0.05, 0.2);
    fore.rotation.x = 0.35;
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.095, 0.12), sleeve);
    cuff.position.set(0.03, -0.11, 0.38);
    cuff.rotation.x = 0.35;
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.1), skin);
    this.arm.add(fore, cuff, palm);

    this.slipper = new THREE.Mesh(tsinelasGeometry(), tsinelasMaterial);
    this.slipper.position.set(0, 0.035, -0.09);
    this.slipper.rotation.set(-0.5, 0.15, 0.25);
    this.arm.add(this.slipper);
    this.arm.position.copy(this.restPos);
    this.root.add(this.arm);

    // Leg for sipa: thigh + shin + tsinelas foot, pivot below the screen
    const shorts = new THREE.MeshLambertMaterial({ color: 0x264653 });
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.13), skin);
    shin.position.set(0, 0.25, 0);
    const shortsM = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.18), shorts);
    shortsM.position.set(0, -0.05, 0);
    const foot = new THREE.Mesh(tsinelasGeometry(0xe63946, 0xe85d5d), tsinelasMaterial);
    foot.scale.setScalar(1.15);
    foot.position.set(0, 0.52, -0.05);
    foot.rotation.set(-1.2, 0, 0);
    const legInner = new THREE.Group();
    legInner.add(shin, shortsM, foot);
    this.leg.add(legInner);
    this.leg.position.set(0.05, -1.25, -0.9);
    this.leg.visible = false;
    this.root.add(this.leg);
    this.root.visible = false;
  }

  setHolding(v: boolean): void {
    this.holding = v;
    this.slipper.visible = v;
    this.aim = -1;
    this.throwT = 1;
    this.refresh();
  }

  /** Power 0..1 while aiming, or null to stop aiming. */
  setAim(power: number | null): void {
    this.aim = power === null ? -1 : power;
  }

  throwAnim(): void {
    this.throwT = 0;
    this.aim = -1;
  }

  showLeg(v: boolean): void {
    this.legOn = v;
    this.leg.visible = v;
    this.kickT = 1;
    this.refresh();
  }

  kick(): void {
    this.kickT = 0;
  }

  private refresh(): void {
    this.arm.visible = this.holding || this.throwT < 1;
    this.root.visible = this.arm.visible || this.legOn;
  }

  update(dt: number, moveSpeed: number): void {
    this.swayT += dt * (1 + moveSpeed * 1.4);
    const sway = Math.min(1, moveSpeed / 5);
    const target = this.restPos.clone();
    target.x += Math.sin(this.swayT * 1.1) * 0.012 * sway;
    target.y += Math.abs(Math.cos(this.swayT * 1.1)) * 0.016 * sway + Math.sin(this.swayT * 0.7) * 0.004;
    let rx = 0;
    if (this.aim >= 0) {
      // pull back and up while charging
      target.add(new THREE.Vector3(0.08, 0.05 + this.aim * 0.05, 0.03 + this.aim * 0.04));
      rx = 0.25 + this.aim * 0.35;
    }
    if (this.throwT < 1) {
      this.throwT = Math.min(1, this.throwT + dt * 4);
      const s = Math.sin(this.throwT * Math.PI);
      target.add(new THREE.Vector3(-0.1 * s, 0.05 * s, -0.25 * s));
      rx = -0.6 * s;
      if (this.throwT >= 1) this.refresh();
    }
    this.arm.position.lerp(target, Math.min(1, dt * 16));
    this.arm.rotation.x += (rx - this.arm.rotation.x) * Math.min(1, dt * 16);

    if (this.legOn) {
      // kick: up fast, down slower
      this.kickT = Math.min(1, this.kickT + dt * 3.2);
      const k = this.kickT < 0.3 ? this.kickT / 0.3 : 1 - (this.kickT - 0.3) / 0.7;
      const e = k * k * (3 - 2 * k);
      this.leg.position.y = -1.25 + e * 0.75;
      this.leg.rotation.x = -0.9 * e;
    }
    this.refresh();
  }
}
