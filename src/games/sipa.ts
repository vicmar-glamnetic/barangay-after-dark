import * as THREE from 'three';
import { BaseGame } from './baseGame';
import type { HubLayout } from './types';

/*
 * SIPA
 *
 * The sipa (a washer with colorful plastic tassels) floats up in front of you.
 * Kick it (click / tap / Space) when it drops into the ring. Every kick makes
 * gravity a little stronger, so the rhythm gets faster. Miss and it falls.
 * Score = kick streak. Kicking too early whiffs and costs a short cooldown,
 * so mashing does not work.
 */

const SPOT = new THREE.Vector3(6, 0.12, -4.5);
const AHEAD = 1.35; // sipa distance in front of the player
const ZONE_Y = 0.62; // kick height
const WINDOW = 0.3; // +/- meters around the zone that count as a kick
const PERFECT = 0.1;
const BASE_G = 6.5;
const RING_R = 0.22;

type Phase = 'intro' | 'play' | 'drop' | 'done';

export class Sipa extends BaseGame {
  readonly id = 'sipa';
  readonly name = 'Sipa';
  readonly implemented = true;
  readonly where = 'sa harap ng sari-sari store';
  readonly layout: HubLayout = {
    spot: SPOT.clone(),
    labelPos: new THREE.Vector3(6, 3.6, -6.4),
    accent: '#06d6a0',
    kids: [
      { x: 4.3, z: -6.4, mode: 'idle' },
      { x: 7.8, z: -6.6, mode: 'wave' },
      { x: 8.5, z: -5.6, mode: 'idle' },
    ],
  };

  private sipa!: THREE.Group;
  private ring!: THREE.Mesh;
  private approach!: THREE.Mesh;
  private approachMat!: THREE.MeshBasicMaterial;
  private removeShadow: (() => void) | null = null;

  private phase: Phase = 'done';
  private y = 1.2;
  private vy = 0;
  private x = 0;
  private targetX = 0;
  private g = BASE_G;
  private streak = 0;
  private perfects = 0;
  private cooldown = 0;
  private introT = 0;
  private dropT = 0;
  private thud = false;
  private cheerT = 0;

  protected onAttach(): void {
    const { scene } = this.ctx;
    // washer + tassels
    this.sipa = new THREE.Group();
    const washer = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.014, 12), new THREE.MeshLambertMaterial({ color: 0x8d9299 }));
    this.sipa.add(washer);
    const cols = [0xff4d6d, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xf72585, 0xff8c42, 0xffffff, 0x9b5de5];
    const strand = new THREE.BoxGeometry(0.012, 0.14, 0.03).translate(0, 0.07, 0);
    cols.forEach((c, i) => {
      const m = new THREE.Mesh(strand, new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.35 }));
      const a = (i / cols.length) * Math.PI * 2;
      m.position.set(Math.cos(a) * 0.02, 0.005, Math.sin(a) * 0.02);
      m.rotation.set(Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5);
      this.sipa.add(m);
    });
    this.sipa.scale.setScalar(1.35);
    this.sipa.visible = false;

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(RING_R, 0.012, 6, 40).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.85, fog: false, depthWrite: false }),
    );
    this.approachMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, fog: false, depthWrite: false });
    this.approach = new THREE.Mesh(new THREE.TorusGeometry(1, 0.008, 6, 48).rotateX(Math.PI / 2), this.approachMat);
    this.ring.visible = this.approach.visible = false;
    scene.add(this.sipa, this.ring, this.approach);
  }

  start(): void {
    const { player, hand, hud, touch, blobs, isTouch } = this.ctx;
    player.teleport(SPOT.x, SPOT.y, SPOT.z, 0, -0.3);
    player.moveEnabled = false;
    player.lookEnabled = false;
    hand.setHolding(false);
    hand.showLeg(true);
    this.streak = this.perfects = 0;
    this.g = BASE_G;
    this.x = this.targetX = 0;
    this.y = 1.25;
    this.vy = 0;
    this.cooldown = 0;
    this.phase = 'intro';
    this.introT = 1.6;
    this.thud = false;
    this.sipa.visible = this.ring.visible = this.approach.visible = true;
    this.removeShadow = blobs.add(this.sipa, 0.25);
    hud.setObjective(isTouch() ? 'I-tap kapag pumasok sa bilog ang sipa!' : 'Click o Space kapag pumasok sa bilog ang sipa!');
    hud.setBig('0');
    hud.setCrosshair(false);
    touch.setActionLabel('Sipa');
    touch.setJumpVisible(false);
    this.group.kids.forEach((k) => {
      k.mode = 'idle';
      k.face(SPOT.x, SPOT.z - AHEAD);
    });
    this.place();
  }

  stop(): void {
    const { player, hand, hud, touch } = this.ctx;
    this.phase = 'done';
    this.sipa.visible = this.ring.visible = this.approach.visible = false;
    this.removeShadow?.();
    this.removeShadow = null;
    player.moveEnabled = true;
    player.lookEnabled = true;
    hand.showLeg(false);
    hud.clearGameWidgets();
    hud.setCrosshair(true);
    touch.setActionLabel('Bato');
    touch.setJumpVisible(true);
  }

  update(dt: number, t: number): void {
    const { input, hud, audio, hand } = this.ctx;
    const kick = input.pressed('action') || input.pressed('jump') || input.tapPressed;
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.cheerT > 0 && (this.cheerT -= dt) <= 0) this.group.kids.forEach((k) => (k.mode = 'idle'));

    switch (this.phase) {
      case 'intro':
        this.introT -= dt;
        this.y = 1.25 + Math.sin(t * 4) * 0.03;
        if (this.introT <= 0) {
          this.phase = 'play';
          this.vy = 2.2;
          hud.toast('Sipa!', 'small', 700);
        }
        break;

      case 'play': {
        this.vy -= this.g * dt;
        this.y += this.vy * dt;
        this.x += (this.targetX - this.x) * Math.min(1, dt * 2.5);
        const d = this.y - ZONE_Y;
        const inWindow = Math.abs(d) <= WINDOW && this.vy < 0.5;
        if (kick && this.cooldown <= 0) {
          if (inWindow) this.doKick(Math.abs(d));
          else {
            hand.kick();
            audio.play('whiff');
            this.cooldown = 0.32;
          }
        }
        if (d < -WINDOW - 0.02) {
          this.phase = 'drop';
          this.dropT = 1.3;
          hud.toast('Nahulog!', 'bad', 1200);
          this.group.kids.forEach((k) => (k.mode = 'wave'));
        }
        break;
      }

      case 'drop':
        this.vy -= this.g * dt;
        this.y = Math.max(0.15, this.y + this.vy * dt);
        if (this.y <= 0.15 && !this.thud) {
          this.thud = true;
          audio.play('thud');
        }
        this.dropT -= dt;
        if (this.dropT <= 0) this.end();
        break;

      case 'done':
        return;
    }
    this.place(t);
  }

  private doKick(err: number): void {
    const { hud, audio, hand } = this.ctx;
    this.streak++;
    const perfect = err < PERFECT;
    if (perfect) this.perfects++;
    this.g = BASE_G * Math.min(2.7, 1 + this.streak * 0.05);
    const h = 1.05 + Math.random() * 0.15;
    this.vy = Math.sqrt(2 * this.g * h);
    this.targetX = THREE.MathUtils.clamp(this.targetX + (Math.random() - 0.5) * 0.26, -0.22, 0.22);
    this.cooldown = 0.12;
    hand.kick();
    audio.play('kick', { vol: 1.2 });
    if (perfect) audio.play('perfect');
    hud.setBig(String(this.streak));
    if (this.streak % 5 === 0) {
      hud.toast(`${this.streak}! Galing!`, 'good', 900);
      audio.play('cheer');
      this.group.kids.forEach((k) => (k.mode = 'cheer'));
      this.cheerT = 1.2;
    } else if (perfect) hud.toast('Perfect!', 'small', 500);
  }

  /** Position the sipa and the timing rings in front of the player. */
  private place(t = 0): void {
    const cx = SPOT.x + this.x;
    const cz = SPOT.z - AHEAD;
    this.sipa.position.set(cx, this.y, cz);
    this.sipa.rotation.set(Math.sin(t * 7) * 0.25, t * 5, Math.cos(t * 6) * 0.2);
    this.ring.position.set(cx, ZONE_Y, cz);
    this.approach.position.set(cx, ZONE_Y, cz);
    const d = this.y - ZONE_Y;
    const r = RING_R + THREE.MathUtils.clamp(d, 0, 1.6) * 0.55;
    this.approach.scale.setScalar(r);
    const inWindow = Math.abs(d) <= WINDOW && this.vy < 0.5;
    this.approachMat.color.set(inWindow ? 0x06d6a0 : d < 0.7 ? 0xffd166 : 0xffffff);
    this.approach.visible = this.phase === 'play' || this.phase === 'intro';
  }

  private end(): void {
    this.phase = 'done';
    const s = this.streak;
    this.ctx.hud.setObjective('');
    this.ctx.finish({
      gameName: this.name,
      score: s,
      scoreLabel: 'sunod-sunod na sipa',
      points: s * 2 + this.perfects,
      won: s >= 10,
      lines: [`Perfect: ${this.perfects}`, s >= 10 ? 'Pang-barangay champion!' : 'Kaya mo pa yan! Abutin ang 10.'],
      shareText: `Naka-${s} sipa ako sa Barangay After Dark!`,
    });
  }
}
