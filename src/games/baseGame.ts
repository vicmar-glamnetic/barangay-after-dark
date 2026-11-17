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
  /** Every player's final row from the last game (the manager uses it for Torneo standings). */
  lastRows: EndRow[] = [];

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
  protected onHostMsg(from: string, d: GameData): void {
    this.battleHostMsg(from, d);
  }
  /** Every client (including the host): state or event from the host. */
  protected onClientMsg(d: GameData): void {
    this.battleClientMsg(d);
  }

  // ------------------------------------------------------------------ score battle
  // For games where everyone plays their own copy at the same time (Piko,
  // Luksong Baka, Holen, Pukpok Palayok): each client reports its score, the
  // host keeps a live board and ends the game once everyone is done.

  private battleTable = new Map<string, { score: number; done: boolean; won: boolean; lines: string[] }>();
  private battleEnded = false;
  /** Live leaderboard: [id, score, done], best first. */
  protected battleBoard: [string, number, boolean][] = [];

  protected battleReset(): void {
    this.battleTable.clear();
    this.battleBoard = [];
    this.battleEnded = false;
    if (this.isHost) for (const id of this.roster()) this.battleTable.set(id, { score: 0, done: false, won: false, lines: [] });
  }

  /** Client: report my running score. done = my run is over (lines/won used for the end card). */
  protected battleReport(score: number, done: boolean, won = false, lines: string[] = []): void {
    this.toHost({ k: 'bt', score, done, won, lines });
  }

  private battleHostMsg(from: string, d: GameData): void {
    if (d.k !== 'bt' || this.battleEnded) return;
    const lines = Array.isArray(d.lines) ? d.lines.slice(0, 4).map((x) => String(x).slice(0, 60)) : [];
    this.battleTable.set(from, { score: Math.max(0, Math.round(Number(d.score) || 0)), done: !!d.done, won: !!d.won, lines });
    this.toAll({ k: 'bb', rows: [...this.battleTable].map(([id, r]) => [id, r.score, r.done]) });
  }

  private battleClientMsg(d: GameData): void {
    if (d.k === 'bb') this.battleBoard = (d.rows as [string, number, boolean][]).slice().sort((a, b) => b[1] - a[1]);
  }

  /** Host: call every frame. Ends the game once everyone still in the lobby is done. */
  protected battleCheck(): void {
    if (!this.isHost || this.battleEnded) return;
    const ids = new Set(this.roster());
    for (const id of [...this.battleTable.keys()]) if (!ids.has(id)) this.battleTable.delete(id);
    if (!this.battleTable.size || ![...this.battleTable.values()].every((r) => r.done)) return;
    this.battleEnded = true;
    this.endWith([...this.battleTable].map(([id, r]) => ({ id, score: r.score, won: r.won, lines: r.lines })));
  }

  /** "Juan 30 · Ana 20*" (star = still playing). Empty in solo. */
  protected battleText(): string {
    if (!this.multiplayer || this.battleBoard.length < 2) return '';
    return this.battleBoard.slice(0, 4).map(([id, s, done]) => `${this.nameOf(id)} ${s}${done ? '' : '*'}`).join(' · ');
  }

  // ------------------------------------------------------------------ ending

  /** Host: end the game for everyone. */
  protected endWith(rows: EndRow[], extra: Record<string, unknown> = {}): void {
    this.toAll({ k: 'end', rows, extra });
  }

  /** Called on every client with the host's final rows. Subclasses build their result in finishMine(). */
  private finishFromRows(rows: EndRow[], extra: Record<string, unknown>): void {
    this.lastRows = rows;
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
