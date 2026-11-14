import * as THREE from 'three';
import type { GameData, Session } from '../net/session';
import type { Sfx } from '../core/audio';
import type { NpcGroup } from '../world/npcs';
import type { GameContext, HubLayout } from './types';

/** One player's final row, sent by the host in the 'end' message. */
export interface EndRow {
  id: string;
  score: number;
  /** Extra per-player lines for the end card. */
  lines: string[];
  /** Solo win condition (ignored in multiplayer, where rank 1 wins). */
  won: boolean;
}

/**
 * Base class for every street game.
 *
 * NETWORKING MODEL (same code for solo and multiplayer):
 *  - The HOST runs the real game logic for every participant (`roster()`).
 *    In solo you are the host and the only participant.
 *  - Clients send actions with toHost(); the host answers with toAll()
 *    (state snapshots, events, toasts). toAll() also reaches the host itself.
 *  - Solo has no Session: toHost/toAll are delivered locally.
 *
 * To add a new game:
 *  1. Create games/myGame.ts extending BaseGame.
 *  2. Fill in id, name, where, implemented, layout.
 *  3. Implement start / update / stop, and onHostMsg / onClientMsg if it
 *     has shared state. End with this.endWith(rows) from the host.
 *  4. Register it in the games list in gameManager.ts (order = unlock order).
 */
export abstract class BaseGame {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly implemented: boolean;
  abstract readonly layout: HubLayout;
  abstract readonly where: string;

  protected ctx!: GameContext;
  group!: NpcGroup;

  /** Set by the manager before start(). null = solo. */
  net: Session | null = null;
  /** Shared random seed for this session (same on every client). */
  seed = 1;
  /** Host-chosen options for this run (e.g. who seeks in Taguan). */
  opts: Record<string, unknown> = {};

  private poseVecs = new Map<string, THREE.Vector3>();

  attach(ctx: GameContext, group: NpcGroup): void {
    this.ctx = ctx;
    this.group = group;
    this.onAttach();
  }

  protected onAttach(): void {}

  abstract start(): void;
  abstract update(dt: number, t: number): void;
  postPhysics(_dt: number): void {}
  abstract stop(): void;

  /** Options for the next multiplayer run (Taguan rotates the seeker). */
  nextOpts(): Record<string, unknown> {
    return {};
  }

  /** Override to send a custom anim code in the pose (0 idle, 1 run, 2 cheer, 3 crouch). */
  localAnim(): number | null {
    return null;
  }

  // ------------------------------------------------------------------ identity

  get multiplayer(): boolean {
    return this.net !== null;
  }
  get isHost(): boolean {
    return !this.net || this.net.isHost;
  }
  get selfId(): string {
    return this.net?.selfId ?? 'me';
  }
  /** Everyone playing, in a stable order (the host first). */
  protected roster(): string[] {
    return this.net ? this.net.players.map((p) => p.id) : ['me'];
  }
  protected slotOf(id: string): number {
    return Math.max(0, this.roster().indexOf(id));
  }
  protected nameOf(id: string): string {
    if (id === this.selfId) return 'Ikaw';
    return this.net ? this.net.nameOf(id) : 'Ikaw';
  }
  /** Latest known feet position of any participant (host logic uses this). */
  protected posOf(id: string): THREE.Vector3 | null {
    if (id === this.selfId) return this.ctx.player.position;
    const p = this.net?.poses.get(id);
    if (!p) return null;
    let v = this.poseVecs.get(id);
    if (!v) this.poseVecs.set(id, (v = new THREE.Vector3()));
    return v.set(p.x, p.y, p.z);
  }

  // ------------------------------------------------------------------ messaging

  /** Client -> host. */
  protected toHost(d: GameData): void {
    if (this.net) this.net.sendGame(d);
    else this.onHostMsg(this.selfId, d);
  }

  /** Host -> everyone, including the host's own client side. */
  protected toAll(d: GameData): void {
    const msg = { ...d, b: 1 };
    if (this.net) this.net.broadcastGame(msg);
    else this.receive(this.selfId, msg);
  }

  /** Host: toast for one player (to = id) or everyone (to = null). */
  protected toast(to: string | null, text: string, kind: '' | 'good' | 'bad' | 'small' = '', ms = 1200): void {
    this.toAll({ k: 'toast', to, text, kind, ms });
  }

  /** Host: positional or global sound for everyone. */
  protected sfx(name: Sfx, pos?: THREE.Vector3): void {
    this.toAll({ k: 'sfx', name, pos: pos ? [pos.x, pos.y, pos.z] : null });
  }

  /** Entry point from the manager for every game-channel message. */
  receive(from: string, d: GameData): void {
    if (d.b) {
      if (d.k === 'toast') {
        if (d.to === null || d.to === this.selfId) this.ctx.hud.toast(String(d.text), d.kind as '', Number(d.ms) || 1200);
        return;
      }
      if (d.k === 'sfx') {
        if (d.to && d.to !== this.selfId) return;
        const p = d.pos as number[] | null;
        this.ctx.audio.play(d.name as Sfx, p ? { pos: new THREE.Vector3(p[0], p[1], p[2]) } : {});
        return;
      }
      if (d.k === 'end') {
        this.finishFromRows(d.rows as EndRow[], d.extra as Record<string, unknown>);
        return;
      }
      this.onClientMsg(d);
    } else if (this.isHost) {
      this.onHostMsg(from, d);
    }
  }

  /** Host side: a client (or the host itself) sent an action. */
  protected onHostMsg(_from: string, _d: GameData): void {}
  /** Every client (including the host): state or event from the host. */
  protected onClientMsg(_d: GameData): void {}

  // ------------------------------------------------------------------ ending

  /** Host: end the game for everyone. */
  protected endWith(rows: EndRow[], extra: Record<string, unknown> = {}): void {
    this.toAll({ k: 'end', rows, extra });
  }

  /** Called on every client with the host's final rows. Subclasses build their result in finishMine(). */
  private finishFromRows(rows: EndRow[], extra: Record<string, unknown>): void {
    const mine = rows.find((r) => r.id === this.selfId);
    if (!mine) return;
    const sorted = [...rows].sort((a, b) => b.score - a.score);
    const top = sorted[0]?.score ?? 0;
    const won = this.multiplayer ? mine.score === top && top > 0 : mine.won;
    const ranking = this.multiplayer
      ? sorted.map((r, i) => `${i + 1}. ${r.id === this.selfId ? 'Ikaw' : this.net!.nameOf(r.id)}  ${r.score}`)
      : [];
    this.finishMine(mine, won, ranking, extra);
  }

  /** Build and report this player's result (call this.ctx.finish). */
  protected abstract finishMine(mine: EndRow, won: boolean, ranking: string[], extra: Record<string, unknown>): void;

  /** Small deterministic RNG from the shared seed. */
  protected rng(salt = 0): () => number {
    let s = (this.seed + salt * 7919) % 2147483647 || 1;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }
}
