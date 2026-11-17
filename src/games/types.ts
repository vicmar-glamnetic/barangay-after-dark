import type * as THREE from 'three';
import type { AudioSys } from '../core/audio';
import type { Input } from '../core/input';
import type { Physics } from '../core/physics';
import type { Player } from '../player/controller';
import type { Hand } from '../player/hand';
import type { Hud } from '../ui/hud';
import type { MobileControls } from '../ui/mobileControls';
import type { Overlays } from '../ui/overlays';
import type { BlobShadows } from '../world/shadows';
import type { KidPlacement } from '../world/npcs';
import type { Avatars } from '../net/avatars';

/** What a finished mini-game reports back to the manager. */
export interface GameResult {
  gameName: string;
  score: number;
  /** Shown under the big score, e.g. "puntos" or "sunod-sunod na sipa". */
  scoreLabel: string;
  /** Tropa Points to award. */
  points: number;
  won: boolean;
  lines: string[];
  /** Text for the "Copy score" button. */
  shareText: string;
  /** Special feats for badges, e.g. 'untouched' (Tumbang Preso), 'flawless' (Patintero). */
  feats?: string[];
}

/** Everything a mini-game is allowed to touch. */
export interface GameContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  physics: Physics;
  player: Player;
  hand: Hand;
  input: Input;
  audio: AudioSys;
  hud: Hud;
  touch: MobileControls;
  overlays: Overlays;
  blobs: BlobShadows;
  /** Other players in the lobby (multiplayer only). */
  avatars: Avatars;
  isTouch: () => boolean;
  groundAt: (x: number, z: number) => number;
  /** Call once when the game is over. The manager shows the end card. */
  finish: (r: GameResult) => void;
}

/** Where a game lives in the hub and how its kids stand around. */
export interface HubLayout {
  /** Stand here (radius ~2.6 m) to get the "Laro tayo!" prompt. */
  spot: THREE.Vector3;
  labelPos: THREE.Vector3;
  kids: KidPlacement[];
  /** Accent color for the label + ground ring. */
  accent: string;
}
