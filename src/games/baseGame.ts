import type { NpcGroup } from '../world/npcs';
import type { GameContext, HubLayout } from './types';

/**
 * Base class for every street game.
 *
 * To add a new game:
 *  1. Create games/myGame.ts extending BaseGame.
 *  2. Fill in id, name, layout (where its kids hang out in the hub).
 *  3. Implement start / update / stop. Call this.ctx.finish(result) when done.
 *  4. Register it in the GAMES list in gameManager.ts (order = unlock order).
 */
export abstract class BaseGame {
  abstract readonly id: string;
  abstract readonly name: string;
  /** False = stub: kids + "Soon!" label appear but it cannot be started yet. */
  abstract readonly implemented: boolean;
  abstract readonly layout: HubLayout;
  /** Short hub hint, e.g. "sa plaza malapit sa puno". */
  abstract readonly where: string;

  protected ctx!: GameContext;
  group!: NpcGroup;

  /** Called once by the manager after the hub kids exist. Build persistent props here. */
  attach(ctx: GameContext, group: NpcGroup): void {
    this.ctx = ctx;
    this.group = group;
    this.onAttach();
  }

  protected onAttach(): void {}

  /** Start (or restart) a fresh session. */
  abstract start(): void;
  /** Per frame while running. Runs before the physics step. */
  abstract update(dt: number, t: number): void;
  /** Optional: per frame after the physics step (sync meshes to bodies). */
  postPhysics(_dt: number): void {}
  /** Tear down everything start() created and restore the hub look. */
  abstract stop(): void;
}
