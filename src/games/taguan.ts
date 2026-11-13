import * as THREE from 'three';
import { BaseGame } from './baseGame';
import type { HubLayout } from './types';

/*
 * TAGUAN / Hide and Seek (stub for v1, kids + "Soon!" label are live in the hub)
 *
 * Planned design:
 * - Player is the seeker. Screen fades to black with
 *   "Isa... dalawa... tatlo..." up to ten (ctx.overlays.fade(true, text)).
 * - 4 kids pick random HIDING_SPOTS (behind drums, plants, the sampayan,
 *   alleys, the jeepneys) and crouch ('crouch' kid mode).
 * - 90 seconds to find all 4. A kid is found when within ~1.6 m and on screen.
 * - Proximity audio: ctx.audio.play('giggle' | 'step', { pos }) on a timer
 *   whose interval shrinks as the player gets closer.
 */
export const HIDING_SPOTS: [number, number][] = [
  [-4.6, -14.6], [-3.0, -16.4], [2.2, -18.3], [2.8, -15.4], [10.8, -14.2],
  [-13.5, -15.6], [-17.8, -15.2], [-11.5, -8.0], [12.0, -7.6], [-7.5, 2.4],
  [17.0, -3.4], [-27.5, -7.0],
];

export class Taguan extends BaseGame {
  readonly id = 'taguan';
  readonly name = 'Taguan';
  readonly implemented = false;
  readonly where = 'sa eskinita sa likod ng waiting shed';
  readonly layout: HubLayout = {
    spot: new THREE.Vector3(-0.6, 0, -9.4),
    labelPos: new THREE.Vector3(0.2, 3.3, -11),
    accent: '#c77dff',
    kids: [
      { x: 2.9, z: -11.2, faceX: 10, faceZ: -11.2, mode: 'count' }, // the "it", counting at the wall
      { x: 0.6, z: -11.6, mode: 'wave' },
      { x: -1.9, z: -11.0, mode: 'idle' },
    ],
  };

  start(): void {}
  update(): void {}
  stop(): void {}
}
