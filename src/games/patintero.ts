import * as THREE from 'three';
import { BaseGame } from './baseGame';
import type { HubLayout } from './types';

/*
 * PATINTERO (stub for v1, kids + "Soon!" label are live in the hub)
 *
 * Planned design:
 * - The chalk grid is already painted on the court texture (world/textures.ts
 *   courtTexture): 4 lanes across, one long center line.
 * - GRID below describes it in world space. Each horizontal line gets one AI
 *   tagger that slides along it (x only); the center-line tagger moves along z.
 * - Player starts at the near edge, must cross every line to the far edge and
 *   back. Touching a tagger costs a life. 3 lives. Score = full crossings.
 * - Taggers: chase the player's x with max speed rising each crossing.
 */
export const PATINTERO_GRID = {
  minX: 5, // court x range of the grid (court center 10, 16)
  maxX: 15,
  minZ: 13.3,
  maxZ: 18.7,
  lines: 5, // vertical lines across the long axis
};

export class Patintero extends BaseGame {
  readonly id = 'patintero';
  readonly name = 'Patintero';
  readonly implemented = false;
  readonly where = 'sa covered court';
  readonly layout: HubLayout = {
    spot: new THREE.Vector3(5.2, 0, 9.6),
    labelPos: new THREE.Vector3(8.5, 3.3, 13),
    accent: '#4cc9f0',
    kids: [
      { x: 6.5, z: 13.3, mode: 'idle' },
      { x: 9, z: 16, mode: 'wave' },
      { x: 11.5, z: 13.3, mode: 'idle' },
      { x: 13.2, z: 16.2, mode: 'cheer' },
    ],
  };

  start(): void {}
  update(): void {}
  stop(): void {}
}
