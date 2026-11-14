import * as THREE from 'three';
import type { SaveStore } from '../core/save';
import type { Menus } from '../ui/menus';
import { NpcGroup } from '../world/npcs';
import type { BaseGame } from './baseGame';
import { LangitLupa } from './langitLupa';
import { Patintero } from './patintero';
import { Sipa } from './sipa';
import { Taguan } from './taguan';
import { TumbangPreso } from './tumbangPreso';
import type { GameContext, GameResult } from './types';

const INTERACT_RADIUS = 2.7;

/**
 * Owns the list of street games, their NPC groups in the hub, the interact
 * system, unlock order, and the start / finish / retry / quit flow.
 */
export class GameManager {
  /** Order here = unlock order. Add new games to this list. */
  readonly games: BaseGame[] = [new TumbangPreso(), new Sipa(), new Patintero(), new Taguan(), new LangitLupa()];
  active: BaseGame | null = null;
  private ended = false;
  private nearby: BaseGame | null = null;
  private ctx: GameContext;

  constructor(
    base: Omit<GameContext, 'finish'>,
    private save: SaveStore,
    private menus: Menus,
    /** Tell the app an end card opened/closed (to release/re-grab pointer lock). */
    private onEndCard: (open: boolean) => void,
  ) {
    this.ctx = { ...base, finish: (r) => this.finish(r) };
    for (const g of this.games) {
      const L = g.layout;
      const group = new NpcGroup(base.scene, L.spot, L.kids, L.labelPos, base.blobs, base.groundAt);
      g.attach(this.ctx, group);
    }
    this.refreshLabels();
  }

  get playing(): boolean {
    return this.active !== null;
  }

  isPlayable(i: number): boolean {
    return this.games[i].implemented && i < this.save.data.unlocked;
  }

  refreshLabels(): void {
    this.games.forEach((g, i) => {
      if (!g.implemented) g.group.setLabel(g.name, 'Soon!', '#9aa3c7');
      else if (i >= this.save.data.unlocked) g.group.setLabel(g.name, 'Naka-lock', '#8d99ae');
      else {
        const best = this.save.data.best[g.id];
        g.group.setLabel(g.name, best !== undefined ? `Laro tayo!  Best ${best}` : 'Laro tayo!', g.layout.accent);
      }
    });
  }

  /** Hub objective: point the player to the next thing to do. */
  hubObjective(): string {
    const next = this.games.find((g, i) => this.isPlayable(i) && this.save.data.best[g.id] === undefined);
    if (next) return `Hanapin ang naglalaro ng ${next.name} ${next.where}`;
    return 'Ipunin ang Tropa Points! Laruin ulit para sa best score.';
  }

  update(dt: number, t: number, camPos: THREE.Vector3, controlsActive: boolean): void {
    for (const g of this.games) g.group.update(dt, t, camPos);
    const { hud, touch, input, player, isTouch } = this.ctx;

    if (this.active) {
      if (!this.ended && controlsActive) this.active.update(dt, t);
      return;
    }

    // --- hub: interact prompt
    let best: BaseGame | null = null;
    let bestD = INTERACT_RADIUS;
    for (const g of this.games) {
      const d = Math.hypot(g.layout.spot.x - player.position.x, g.layout.spot.z - player.position.z);
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    this.nearby = best;
    if (!best || !controlsActive) {
      hud.setPrompt(null);
      touch.setInteractReady(false);
      return;
    }
    const i = this.games.indexOf(best);
    const playable = this.isPlayable(i);
    const key = isTouch() ? undefined : 'E';
    if (playable) hud.setPrompt(`Laro tayo! ${best.name}`, key);
    else if (!best.implemented) hud.setPrompt(`${best.name}: Soon! Abangan.`);
    else hud.setPrompt(`Naka-lock: tapusin muna ang ${this.games[i - 1]?.name ?? 'naunang laro'}`);
    touch.setInteractReady(playable);

    if (input.pressed('interact')) {
      if (playable) this.start(best);
      else {
        hud.toast(best.implemented ? 'Naka-lock pa!' : 'Soon!', 'small', 900);
        this.ctx.audio.play('ui');
      }
    }
  }

  postPhysics(dt: number): void {
    this.active?.postPhysics(dt);
  }

  start(g: BaseGame): void {
    if (this.active) this.quit(); // never run two games at once
    this.active = g;
    this.ended = false;
    g.group.setHubVisible(false);
    this.ctx.hud.setPrompt(null);
    this.ctx.touch.setInteractReady(false);
    this.ctx.audio.play('ui');
    g.start();
  }

  private finish(r: GameResult): void {
    const g = this.active;
    if (!g || this.ended) return;
    this.ended = true;
    const idx = this.games.indexOf(g);
    this.save.addPoints(r.points);
    const isBest = this.save.recordScore(g.id, r.score);
    let unlocked: string | undefined;
    const next = this.games[idx + 1];
    if (next && this.save.unlockUpTo(idx + 2)) unlocked = next.implemented ? next.name : `${next.name} (Soon!)`;
    this.refreshLabels();
    this.ctx.hud.setPoints(this.save.data.tropaPoints);
    this.ctx.audio.play(r.won ? 'win' : 'lose');

    // Let the last moment breathe before the card pops.
    window.setTimeout(() => {
      if (this.active !== g) return;
      this.onEndCard(true);
      this.menus.showEnd(
        r,
        { best: this.save.data.best[g.id] ?? r.score, isBest, unlocked },
        () => this.retry(),
        () => this.quit(),
      );
    }, 1100);
  }

  retry(): void {
    const g = this.active;
    if (!g) return;
    this.menus.close();
    this.onEndCard(false);
    g.stop();
    g.group.resetToHome(this.ctx.groundAt);
    this.ended = false;
    g.start();
  }

  /** Leave the current game (from the end card or the pause menu). */
  quit(): void {
    const g = this.active;
    if (!g) return;
    if (this.menus.kind === 'end') {
      this.menus.close();
      this.onEndCard(false);
    }
    g.stop();
    g.group.resetToHome(this.ctx.groundAt);
    g.group.setHubVisible(true);
    const { player, hand, hud, touch } = this.ctx;
    player.moveEnabled = true;
    player.lookEnabled = true;
    hand.setHolding(false);
    hand.showLeg(false);
    hud.clearGameWidgets();
    hud.setCrosshair(true);
    touch.setActionLabel('Bato');
    touch.setJumpVisible(true);
    this.active = null;
    this.ended = false;
    hud.setObjective(this.hubObjective());
  }
}
