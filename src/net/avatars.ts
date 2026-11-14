import * as THREE from 'three';
import type { AudioSys } from '../core/audio';
import { Kid, randomLook, type KidMode } from '../world/npcs';
import type { BlobShadows } from '../world/shadows';
import { FONT } from '../world/textures';
import type { Session } from './session';
import { faceTexture } from './face';

const ANIM: KidMode[] = ['idle', 'run', 'cheer', 'crouch'];
const _before = new THREE.Vector3();
const _target = new THREE.Vector3();

interface Avatar {
  kid: Kid;
  tag: THREE.Sprite;
  name: string;
  pos: THREE.Vector3;
  stepDist: number;
  face: string | undefined;
}

/**
 * Renders the other players in the lobby as kids with floating name tags.
 * Positions arrive at ~15 Hz and are smoothed every frame.
 */
export class Avatars {
  private list = new Map<string, Avatar>();
  private visible = false;
  tagsVisible = true;
  /** Hide specific players' tags (Taguan hides hiders from the seeker). */
  hiddenTags = new Set<string>();

  constructor(private scene: THREE.Scene, private blobs: BlobShadows, private audio: AudioSys) {}

  setVisible(v: boolean): void {
    this.visible = v;
    for (const a of this.list.values()) {
      a.kid.root.visible = v;
      a.tag.visible = v && this.tagsVisible;
    }
  }

  /** Current smoothed position of a remote player (used by host game logic too). */
  positionOf(id: string): THREE.Vector3 | null {
    return this.list.get(id)?.pos ?? null;
  }

  clear(): void {
    for (const a of this.list.values()) {
      a.kid.dispose();
      a.tag.removeFromParent();
    }
    this.list.clear();
  }

  update(dt: number, t: number, s: Session | null): void {
    if (!s) {
      if (this.list.size) this.clear();
      return;
    }
    // add / remove avatars to match the roster
    for (const p of s.players) {
      if (p.id === s.selfId || this.list.has(p.id)) continue;
      const look = { ...randomLook(), shirt: p.color };
      const kid = new Kid(look);
      kid.root.visible = this.visible;
      this.scene.add(kid.root);
      kid.addShadow(this.blobs);
      const tag = makeTag(p.name, p.color);
      tag.visible = this.visible && this.tagsVisible;
      this.scene.add(tag);
      const rp = s.poses.get(p.id);
      const pos = new THREE.Vector3(rp?.x ?? 0, rp?.y ?? 0, rp?.z ?? 0);
      kid.root.position.copy(pos);
      this.list.set(p.id, { kid, tag, name: p.name, pos, stepDist: 0, face: undefined });
    }
    // custom faces (update when someone picks a new one)
    for (const p of s.players) {
      const a = this.list.get(p.id);
      if (!a || a.face === p.face) continue;
      a.face = p.face;
      a.kid.setFace(p.face ? faceTexture(p.face) : null);
    }
    for (const [id, a] of this.list) {
      if (!s.players.some((p) => p.id === id)) {
        a.kid.dispose();
        a.tag.removeFromParent();
        this.list.delete(id);
      }
    }
    // smooth toward the latest pose
    for (const [id, a] of this.list) {
      const rp = s.poses.get(id);
      if (!rp) continue;
      _before.copy(a.pos);
      const k = 1 - Math.exp(-dt * 12);
      _target.set(rp.x, rp.y, rp.z);
      if (a.pos.distanceToSquared(_target) > 25) a.pos.copy(_target);
      else a.pos.lerp(_target, k);
      const moved = a.pos.distanceTo(_before);
      const kid = a.kid;
      kid.root.position.copy(a.pos);
      let d = rp.yaw + Math.PI - kid.root.rotation.y; // camera looks down -Z, kid faces +Z
      d = Math.atan2(Math.sin(d), Math.cos(d));
      kid.root.rotation.y += d * Math.min(1, dt * 12);
      kid.mode = ANIM[rp.anim] ?? 'idle';
      kid.speed = dt > 0 ? moved / dt : 0;
      if (kid.mode === 'idle' && kid.speed > 0.6) kid.mode = 'run';
      kid.update(dt, t);
      a.tag.position.set(a.pos.x, a.pos.y + 1.75, a.pos.z);
      a.tag.visible = this.visible && this.tagsVisible && !this.hiddenTags.has(id);
      // footsteps from other players (positional)
      if (this.visible && kid.speed > 1) {
        a.stepDist += moved;
        if (a.stepDist > 1.8) {
          a.stepDist = 0;
          this.audio.play('step', { pos: a.pos, vol: 0.9 });
        }
      }
    }
  }
}

function makeTag(name: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = `800 34px ${FONT}`;
  const w = Math.min(248, g.measureText(name).width + 34);
  g.fillStyle = 'rgba(12,16,38,0.8)';
  if (g.roundRect) {
    g.beginPath();
    g.roundRect((256 - w) / 2, 6, w, 52, 18);
    g.fill();
  } else g.fillRect((256 - w) / 2, 6, w, 52); // older iOS
  g.fillStyle = '#' + color.toString(16).padStart(6, '0');
  g.fillRect((256 - w) / 2 + 12, 26, 10, 10);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 128 + 8, 33, w - 30);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xdcdcdc, depthWrite: false, fog: false, transparent: true }));
  s.scale.set(1.4, 0.35, 1);
  s.renderOrder = 6;
  return s;
}
