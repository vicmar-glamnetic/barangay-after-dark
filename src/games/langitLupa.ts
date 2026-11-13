import * as THREE from 'three';
import { BaseGame } from './baseGame';
import type { HubLayout } from './types';

/*
 * LANGIT-LUPA ("heaven-earth") (stub for v1, kids + "Soon!" label are live)
 *
 * Planned design:
 * - Survive 60 seconds. Anything raised is "langit" (safe): crates, the bench,
 *   the low wall, drums, the kariton (all built in world/props.ts langitArea
 *   with colliders, so the player can already jump on them).
 * - Detect langit with player.position.y > SAFE_HEIGHT (ground is 0).
 * - The "it" kid chases on the ground and tags you if you are on the lupa.
 * - Rule from the street: you cannot stay on one langit for more than
 *   MAX_PERCH seconds, which forces the parkour.
 */
export const SAFE_HEIGHT = 0.35;
export const MAX_PERCH = 5;

export class LangitLupa extends BaseGame {
  readonly id = 'langitLupa';
  readonly name = 'Langit-Lupa';
  readonly implemented = false;
  readonly where = 'sa mga kahon sa tabi ng court';
  readonly layout: HubLayout = {
    spot: new THREE.Vector3(20.6, 0, 7.8),
    labelPos: new THREE.Vector3(23.5, 3.6, 10.5),
    accent: '#ff8c42',
    kids: [
      { x: 21, z: 9, mode: 'cheer' }, // on the stacked crates
      { x: 26.1, z: 13.4, mode: 'wave' }, // on a crate
      { x: 23.5, z: 12.2, mode: 'idle' }, // on the bench
      { x: 22.6, z: 14.2, mode: 'idle' }, // the "it", on the ground
    ],
  };

  start(): void {}
  update(): void {}
  stop(): void {}
}
