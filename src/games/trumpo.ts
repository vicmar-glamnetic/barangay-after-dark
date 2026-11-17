import * as THREE from 'three';
import { L } from '../core/i18n';
import { BaseGame, type EndRow } from './baseGame';
import type { HubLayout } from './types';

/*
 * TRUMPO (spinning top), solo or score battle. 3 rounds.
 *
 *  1. Wind the string: hold to wind, release when the marker is in the green
 *     for a strong, steady spin (outside the green = wobbly throw).
 *  2. Aim with your view and the top flies into the chalk circle.
 *  3. The spinning top wanders and knocks tansan (bottle caps) out of the
 *     circle: +15 each.
 *  4. As it slows, "sapo" it: press while the marker is in the green to scoop
 *     it into your palm (+25). Miss and it topples.
 * Score: +3 per second of spin, +15 per cap out, +25 palm catch, +5 perfect wind.
 */

const C = new THREE.Vector3(-3.8, 0, 21.7); // circle center
const R = 1.1; // circle radius
const THROW_Z = 19.2; // you stand here
const ROUNDS = 3;
const CAPS = 5;
const YAW_SOUTH = Math.PI; // the camera looks down -Z at yaw 0
const WIND_SWEEP = 1.3; // seconds for the wind marker to sweep 0 -> 1
const SWEET: [number, number] = [0.68, 0.86];
const SCOOP: [number, number] = [0.14, 0.36]; // spin left (fraction) where a palm catch works

type Phase = 'aim' | 'fly' | 'spin' | 'fall' | 'done';

interface Cap {
  mesh: THREE.Mesh;
  vel: THREE.Vector2;
  out: boolean;
}

export class Trumpo extends BaseGame {
  readonly id = 'trumpo';
  readonly name = 'Trumpo';
  readonly implemented = true;
  get where() { return L('sa plaza, malapit sa puno ng mangga', 'in the plaza by the mango tree'); }
  get blurb() { return L('Paikutin ang trumpo at ilabas ang tansan', 'Spin your wooden top and knock bottle caps out of the circle'); }
  get howTo() {
    return [
      L('Pindutin nang matagal para paikutin ang tali. Bitawan sa berde para malakas ang ikot.', 'Hold to wind the string. Release in the green for a strong, steady spin.'),
      L('Tumutok sa bilog. Habang umiikot, matatamaan ng trumpo ang mga tansan: +15 bawat lumabas.', 'Aim at the chalk circle. The spinning top bumps the bottle caps: +15 for each one knocked out.'),
      L('Kapag bumabagal na, "sapuhin" ito: pindutin habang nasa berde para saluhin sa palad (+25).', 'When it slows down, press in the green to scoop it onto your palm (+25). Miss and it topples.'),
    ];
  }
  readonly layout: HubLayout = {
    spot: new THREE.Vector3(C.x, 0, THROW_Z - 0.4),
    labelPos: new THREE.Vector3(C.x, 2.8, C.z),
    accent: '#e85d04',
    kids: [
      { x: C.x - 1.8, z: C.z + 0.6, mode: 'cheer', faceX: C.x, faceZ: C.z }, // Boyet
      { x: C.x + 1.7, z: C.z + 0.9, mode: 'idle', faceX: C.x, faceZ: C.z },
    ],
  };

  private top!: THREE.Group;
  private body!: THREE.Group;
  private caps: Cap[] = [];
  private marker!: THREE.Mesh;

  private phase: Phase = 'done';
  private round = 0;
  private score = 0;
  private roundPts = 0;
  private power = 0;
  private dir = 1;
  private winding = false;
  private quality = 0;
  private spin0 = 1;
  private spin = 0;
  private vel = new THREE.Vector2();
  private flyFrom = new THREE.Vector3();
  private flyTo = new THREE.Vector3();
  private t = 0;
  private precess = 0;
  private capsOut = 0;
  private catches = 0;
  private bestSpin = 0;
  private spinTime = 0;
  private wobbleSide = 1;

  protected onAttach(): void {
    const { scene, blobs } = this.ctx;
    // chalk circle + throw line
    const chalk = new THREE.MeshBasicMaterial({ color: 0xb8b2a2 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.04, R + 0.02, 48).rotateX(-Math.PI / 2), chalk);
    ring.position.set(C.x, 0.025, C.z);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.06).rotateX(-Math.PI / 2), chalk);
    line.position.set(C.x, 0.025, THROW_Z + 0.25);
    scene.add(ring, line);

    // the top: a lathe-turned wooden body with painted stripes and a nail tip
    this.top = new THREE.Group();
    this.body = new THREE.Group();
    const prof = [
      [0.0, 0.0], [0.012, 0.0], [0.014, 0.03], [0.05, 0.06], [0.075, 0.1], [0.082, 0.13], [0.07, 0.15], [0.03, 0.16], [0.028, 0.2], [0.0, 0.2],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const wood = new THREE.Mesh(new THREE.LatheGeometry(prof, 16), new THREE.MeshLambertMaterial({ color: 0xc1121f }));
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.079, 0.008, 6, 20).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xffd166 }));
    stripe.position.y = 0.12;
    const stripe2 = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.007, 6, 20).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x1d3557 }));
    stripe2.position.y = 0.085;
    const nail = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.03, 6).rotateX(Math.PI), new THREE.MeshLambertMaterial({ color: 0x9aa3aa }));
    nail.position.y = -0.005;
    this.body.add(wood, stripe, stripe2, nail);
    this.top.add(this.body);
    this.body.scale.setScalar(1.7); // a touch bigger than life so it reads from where you stand
    this.top.visible = false;
    scene.add(this.top);
    blobs.add(this.top, 0.22);

    // tansan (bottle caps)
    const capGeo = new THREE.CylinderGeometry(0.045, 0.048, 0.016, 14);
    const cols = [0xd62828, 0x1d4ed8, 0xf2c230, 0x2a9d8f, 0xf8f8f8];
    for (let i = 0; i < CAPS; i++) {
      const m = new THREE.Mesh(capGeo, new THREE.MeshLambertMaterial({ color: cols[i % cols.length] }));
      m.position.set(C.x + Math.cos(i * 1.3) * 0.5, 0.008, C.z + Math.sin(i * 1.3) * 0.5);
      scene.add(m);
      this.caps.push({ mesh: m, vel: new THREE.Vector2(), out: false });
    }

    // where the throw will land
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.15, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, depthWrite: false, fog: false }),
    );
    this.marker.visible = false;
    scene.add(this.marker);
  }

  // ================================================================== lifecycle

  start(): void {
    const { hud, touch } = this.ctx;
    this.battleReset();
    this.round = 0;
    this.score = 0;
    this.capsOut = 0;
    this.catches = 0;
    this.bestSpin = 0;
    touch.setActionLabel(L('Ikot', 'Spin'));
    touch.setJumpVisible(false);
    hud.setCrosshair(true);
    this.nextRound();
  }

  stop(): void {
    const { player, hud, touch } = this.ctx;
    this.phase = 'done';
    this.top.visible = false;
    this.marker.visible = false;
    player.moveEnabled = true;
    player.lookEnabled = true;
    touch.setActionLabel(L('Bato', 'Throw'));
    touch.setJumpVisible(true);
    hud.clearGameWidgets();
  }

  private nextRound(): void {
    const { player, hud, isTouch } = this.ctx;
    this.round++;
    this.roundPts = 0;
    this.phase = 'aim';
    this.winding = false;
    this.top.visible = false;
    player.moveEnabled = false;
    player.lookEnabled = true;
    player.teleport(C.x, 0, THROW_Z, YAW_SOUTH, -0.42);
    // scatter the caps (seeded so a score battle gets the same layout)
    const rnd = this.rng(11 + this.round);
    for (const c of this.caps) {
      const a = rnd() * Math.PI * 2, r = 0.15 + rnd() * 0.6;
      c.mesh.position.set(C.x + Math.cos(a) * r, 0.008, C.z + Math.sin(a) * r);
      c.mesh.visible = true;
      c.vel.set(0, 0);
      c.out = false;
    }
    hud.toast(L(`Round ${this.round}/${ROUNDS}`, `Round ${this.round}/${ROUNDS}`), 'small', 1000);
    hud.setObjective(isTouch()
      ? L('Tumutok sa bilog. Pindutin nang matagal ang Ikot, bitawan sa berde.', 'Aim at the circle. Hold Spin, release in the green.')
      : L('Tumutok sa bilog. Pindutin nang matagal ang click, bitawan sa berde.', 'Aim at the circle. Hold the mouse button, release in the green.'));
  }

  // ================================================================== frame

  update(dt: number, time: number): void {
    const { input, hud, audio } = this.ctx;
    if (this.phase === 'done') {
      this.battleCheck();
      return;
    }
    const press = input.pressed('action') || input.pressed('jump') || input.tapPressed;
    this.moveCaps(dt);

    switch (this.phase) {
      case 'aim': {
        // keep the aim roughly toward the circle
        const land = this.landing();
        this.marker.position.set(land.x, 0.03, land.z);
        this.marker.visible = true;
        const inCircle = Math.hypot(land.x - C.x, land.z - C.z) < R - 0.1;
        (this.marker.material as THREE.MeshBasicMaterial).color.set(inCircle ? 0x06d6a0 : 0xff5d73);
        if (input.down('action')) {
          if (!this.winding) {
            this.winding = true;
            this.power = 0;
            this.dir = 1;
            audio.play('swing', { vol: 0.4 });
          }
          this.power += (this.dir * dt) / WIND_SWEEP;
          if (this.power >= 1) {
            this.power = 1;
            this.dir = -1;
          } else if (this.power <= 0) {
            this.power = 0;
            this.dir = 1;
          }
          hud.setMeter(this.power, SWEET[0], SWEET[1], L('Ikot ng tali: bitawan sa berde', 'Wind the string: release in the green'));
        } else if (this.winding) {
          this.winding = false;
          this.throwTop(land);
        }
        break;
      }
      case 'fly': {
        this.t = Math.min(1, this.t + dt / 0.45);
        const k = this.t;
        this.top.position.lerpVectors(this.flyFrom, this.flyTo, k);
        this.top.position.y = THREE.MathUtils.lerp(this.flyFrom.y, 0, k) + Math.sin(k * Math.PI) * 0.6;
        this.body.rotation.x = (1 - k) * 1.2;
        this.top.rotation.y += dt * 40;
        if (k >= 1) {
          this.phase = 'spin';
          this.spinTime = 0;
          audio.play('thud', { pos: this.flyTo, vol: 0.6 });
          hud.setObjective(L('Umiikot! Hintayin bumagal, tapos sapuhin sa berde.', "It's spinning! Wait for it to slow, then scoop it in the green."));
        }
        break;
      }
      case 'spin': {
        this.spin -= dt;
        this.spinTime += dt;
        const f = Math.max(0, this.spin / this.spin0);
        // spin on its axis, precess and wobble more as it slows
        this.top.rotation.y += dt * (12 + 50 * f);
        this.precess += dt * (2 + 6 * (1 - f));
        const tilt = (1 - f) ** 2 * 0.45 + (1 - this.quality) * 0.08;
        this.body.rotation.set(Math.cos(this.precess) * tilt, 0, Math.sin(this.precess) * tilt);
        // wander: initial push plus a lazy curl, more drift when wobbly
        const curl = (0.6 + (1 - this.quality)) * this.wobbleSide;
        this.vel.rotateAround(new THREE.Vector2(), curl * dt * 0.8);
        this.vel.multiplyScalar(Math.pow(0.55, dt));
        this.vel.x += Math.sin(time * 3.1) * dt * 0.08;
        this.top.position.x += this.vel.x * dt;
        this.top.position.z += this.vel.y * dt;
        // stay in the plaza
        const d = Math.hypot(this.top.position.x - C.x, this.top.position.z - C.z);
        if (d > R + 1.2) {
          this.vel.multiplyScalar(-0.5);
          this.top.position.x = C.x + ((this.top.position.x - C.x) / d) * (R + 1.2);
          this.top.position.z = C.z + ((this.top.position.z - C.z) / d) * (R + 1.2);
        }
        this.hitCaps();
        hud.setMeter(f, SCOOP[0], SCOOP[1], f > SCOOP[1] ? L(`Umiikot  ${this.spinTime.toFixed(1)}s`, `Spinning  ${this.spinTime.toFixed(1)}s`) : L('SAPUHIN NA!', 'SCOOP IT NOW!'));
        if (press) {
          if (f >= SCOOP[0] && f <= SCOOP[1]) this.scoop();
          else {
            hud.toast(L('Natumba sa kamay!', 'You knocked it over!'), 'bad', 1000);
            this.topple();
          }
        } else if (this.spin <= 0) this.topple();
        break;
      }
      case 'fall': {
        this.t += dt;
        this.body.rotation.x = Math.min(1.35, this.body.rotation.x + dt * 4);
        if (this.t > 1.6) {
          if (this.round >= ROUNDS) this.endRun();
          else this.nextRound();
        }
        break;
      }
    }
    hud.setStat(L(`Round ${this.round}/${ROUNDS}   Tansan: ${this.capsOut}   Puntos: ${this.score + this.roundPts}`, `Round ${this.round}/${ROUNDS}   Caps out: ${this.capsOut}   Score: ${this.score + this.roundPts}`) + `   ${this.battleText()}`);
    this.battleCheck();
  }

  /** Where the throw lands: 2.5 m ahead along the view. */
  private landing(): THREE.Vector3 {
    const f = new THREE.Vector3();
    this.ctx.camera.getWorldDirection(f);
    f.y = 0;
    f.normalize();
    const p = this.ctx.player.position;
    return new THREE.Vector3(p.x + f.x * 2.5, 0, p.z + f.z * 2.5);
  }

  private throwTop(land: THREE.Vector3): void {
    const { hud, audio, player } = this.ctx;
    hud.setMeter(null);
    this.marker.visible = false;
    const mid = (SWEET[0] + SWEET[1]) / 2, half = (SWEET[1] - SWEET[0]) / 2;
    const off = Math.abs(this.power - mid);
    this.quality = off <= half ? 1 - (off / half) * 0.3 : Math.max(0.1, 0.7 - (off - half) * 2.2);
    if (off <= half * 0.25) {
      this.roundPts += 5;
      hud.toast(L('Perpektong ikot! +5', 'Perfect wind! +5'), 'good', 800);
      audio.play('perfect', { vol: 0.8 });
    } else if (off > half) hud.toast(L('Mahina ang ikot...', 'Wobbly throw...'), 'small', 800);
    // a wobbly throw also lands a little off
    const err = (1 - this.quality) * 0.6;
    this.flyTo.set(land.x + (Math.random() - 0.5) * err, 0, land.z + (Math.random() - 0.5) * err);
    // leave the hand a little in front of the camera so it doesn't fill the screen
    const fwd = new THREE.Vector2(land.x - player.position.x, land.z - player.position.z).normalize();
    this.flyFrom.set(player.position.x + fwd.x * 0.8 + 0.15, 1.1, player.position.z + fwd.y * 0.8);
    this.spin0 = this.spin = 3 + this.quality * 7;
    const dir = new THREE.Vector2(this.flyTo.x - this.flyFrom.x, this.flyTo.z - this.flyFrom.z).normalize();
    this.vel.copy(dir).multiplyScalar(0.25 + this.quality * 0.25);
    this.wobbleSide = Math.random() < 0.5 ? -1 : 1;
    this.precess = 0;
    this.t = 0;
    this.top.visible = true;
    this.top.position.copy(this.flyFrom);
    this.body.rotation.set(0, 0, 0);
    this.phase = 'fly';
    player.lookEnabled = false;
    audio.play('throw', { vol: 0.8 });
  }

  private hitCaps(): void {
    const tp = this.top.position;
    for (const c of this.caps) {
      if (c.out) continue;
      const dx = c.mesh.position.x - tp.x, dz = c.mesh.position.z - tp.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15 && d > 1e-4) {
        // the spinning top flicks the cap away (with a sideways spin kick)
        const speed = 0.9 + (this.spin / this.spin0) * 1.4;
        c.vel.set((dx / d) * speed - (dz / d) * 0.4 * this.wobbleSide, (dz / d) * speed + (dx / d) * 0.4 * this.wobbleSide);
        this.vel.multiplyScalar(0.8);
        this.ctx.audio.play('clang', { pos: c.mesh.position, vol: 0.5 });
      }
    }
  }

  private moveCaps(dt: number): void {
    for (const c of this.caps) {
      if (c.vel.lengthSq() < 1e-5) continue;
      c.mesh.position.x += c.vel.x * dt;
      c.mesh.position.z += c.vel.y * dt;
      c.mesh.rotation.y += dt * 8;
      c.vel.multiplyScalar(Math.pow(0.12, dt));
      if (!c.out && Math.hypot(c.mesh.position.x - C.x, c.mesh.position.z - C.z) > R) {
        c.out = true;
        this.capsOut++;
        this.roundPts += 15;
        this.ctx.hud.toast(L('Labas ang tansan! +15', 'Cap knocked out! +15'), 'good', 800);
        this.ctx.audio.play('tick');
      }
    }
  }

  private scoop(): void {
    const { hud, audio } = this.ctx;
    this.catches++;
    this.roundPts += 25;
    hud.toast(L('Sapo! Nasa palad mo! +25', 'Scooped! Spinning on your palm! +25'), 'good', 1200);
    audio.play('cheer');
    this.group.kids.forEach((k) => (k.mode = 'cheer'));
    this.endRound(true);
  }

  private topple(): void {
    this.ctx.audio.play('thud', { pos: this.top.position, vol: 0.7 });
    this.endRound(false);
  }

  private endRound(caught: boolean): void {
    const { hud } = this.ctx;
    hud.setMeter(null);
    const secs = Math.floor(this.spinTime);
    this.bestSpin = Math.max(this.bestSpin, this.spinTime);
    this.roundPts += secs * 3;
    this.score += this.roundPts;
    this.roundPts = 0;
    if (caught) this.top.visible = false;
    this.phase = 'fall';
    this.t = 0;
    hud.setObjective(L(`Umikot nang ${secs}s.`, `It spun for ${secs}s.`));
    this.battleReport(this.score, false);
  }

  private endRun(): void {
    this.phase = 'done';
    this.top.visible = false;
    this.ctx.hud.setMeter(null);
    this.ctx.hud.setObjective(this.multiplayer ? L('Tapos ka na. Hinihintay ang iba...', "You're done. Waiting for the others...") : '');
    this.battleReport(this.score, true, this.score >= 120, [
      L(`Tansan na nailabas: ${this.capsOut}/${CAPS * ROUNDS}`, `Caps knocked out: ${this.capsOut}/${CAPS * ROUNDS}`),
      L(`Sapo sa palad: ${this.catches}/${ROUNDS}`, `Palm catches: ${this.catches}/${ROUNDS}`),
      L(`Pinakamatagal na ikot: ${this.bestSpin.toFixed(1)}s`, `Longest spin: ${this.bestSpin.toFixed(1)}s`),
    ]);
  }

  protected finishMine(mine: EndRow, won: boolean, ranking: string[]): void {
    this.ctx.hud.setObjective('');
    this.ctx.finish({
      gameName: this.name,
      score: mine.score,
      scoreLabel: L('puntos', 'points'),
      points: mine.score,
      won,
      lines: [...mine.lines, ...ranking],
      shareText: L(`${mine.score} puntos ako sa Trumpo sa Hari ng Kanto!`, `My spinning top scored ${mine.score} in Trumpo on Hari ng Kanto!`),
    });
  }
}
