import * as THREE from 'three';
import type { SaveStore } from '../core/save';
import { Session } from '../net/session';
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

export interface ManagerHooks {
  /** A blocking menu opened/closed (release / re-grab pointer lock, hide touch HUD). */
  onModal: (open: boolean) => void;
}

/**
 * Owns the street games, their NPC groups in the hub, the interact system,
 * unlock order, lobbies (multiplayer sessions), and the start / finish /
 * retry / quit flow.
 */
export class GameManager {
  /** Order here = unlock order. Add new games to this list. */
  readonly games: BaseGame[] = [new TumbangPreso(), new Sipa(), new Patintero(), new Taguan(), new LangitLupa()];
  active: BaseGame | null = null;
  session: Session | null = null;
  private ended = false;
  private ctx: GameContext;
  /** Options for the next multiplayer run of each game (Taguan rotates the seeker). */
  private nextOpts = new Map<string, Record<string, unknown>>();

  constructor(base: Omit<GameContext, 'finish'>, private save: SaveStore, private menus: Menus, private hooks: ManagerHooks) {
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

  /** In a multiplayer game right now? (game logic keeps running while paused) */
  get networked(): boolean {
    return !!this.active?.net;
  }

  isPlayable(i: number): boolean {
    return this.games[i].implemented && i < this.save.data.unlocked;
  }

  gameById(id: string): BaseGame | undefined {
    return this.games.find((g) => g.id === id);
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

  hubObjective(): string {
    if (this.session) return `Nasa lobby ka (${this.session.code}). Buksan ang pause menu para makita ang lobby.`;
    const next = this.games.find((g, i) => this.isPlayable(i) && this.save.data.best[g.id] === undefined);
    if (next) return `Hanapin ang naglalaro ng ${next.name} ${next.where}`;
    return 'Ipunin ang Tropa Points! Laruin ulit o mag-lobby kasama ang tropa.';
  }

  // ================================================================== frame

  update(dt: number, t: number, camPos: THREE.Vector3, controlsActive: boolean, simulate: boolean): void {
    for (const g of this.games) g.group.update(dt, t, camPos);
    const { hud, touch, input, player, isTouch } = this.ctx;

    if (this.active) {
      if (!this.ended && simulate) this.active.update(dt, t);
      return;
    }

    // hub: nearest game spot
    let best: BaseGame | null = null;
    let bestD = INTERACT_RADIUS;
    for (const g of this.games) {
      const d = Math.hypot(g.layout.spot.x - player.position.x, g.layout.spot.z - player.position.z);
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    if (!best || !controlsActive) {
      hud.setPrompt(null);
      touch.setInteractReady(false);
      return;
    }
    const i = this.games.indexOf(best);
    const key = isTouch() ? undefined : 'E';
    if (!best.implemented) hud.setPrompt(`${best.name}: Soon! Abangan.`);
    else if (this.isPlayable(i)) hud.setPrompt(`Laro tayo! ${best.name}`, key);
    else hud.setPrompt(`${best.name}: naka-lock (pwede sumali sa lobby)`, key);
    touch.setInteractReady(best.implemented);

    if (input.pressed('interact')) {
      if (!best.implemented) {
        hud.toast('Soon!', 'small', 900);
        this.ctx.audio.play('ui');
      } else this.openSpotMenu(best);
    }
  }

  postPhysics(dt: number): void {
    this.active?.postPhysics(dt);
  }

  // ================================================================== menus at a game spot

  private openSpotMenu(g: BaseGame): void {
    const i = this.games.indexOf(g);
    const playable = this.isPlayable(i);
    this.ctx.audio.play('ui');
    this.hooks.onModal(true);
    this.menus.showGameMenu({
      name: g.name,
      canSolo: playable,
      lockedMsg: playable ? '' : `Tapusin muna ang ${this.games[i - 1]?.name ?? 'naunang laro'} para makapaglaro mag-isa.`,
      inLobby: !!this.session,
      onSolo: () => this.startSolo(g),
      onCreate: () => this.createLobby(g),
      onJoin: () => this.showJoin(),
      onLobby: () => this.showLobby(),
      onClose: () => this.closeMenu(),
    });
  }

  closeMenu(): void {
    this.menus.close();
    this.hooks.onModal(false);
  }

  private async createLobby(g: BaseGame): Promise<void> {
    if (this.session) {
      if (this.session.isHost) this.session.setGame(g.id);
      this.showLobby();
      return;
    }
    this.menus.showBusy('Gumagawa ng lobby...');
    try {
      const s = await Session.host(g.id, this.menus.playerName);
      this.attachSession(s);
      this.showLobby();
    } catch (e) {
      this.menus.showMessage((e as Error).message, () => this.closeMenu());
    }
  }

  showJoin(): void {
    this.hooks.onModal(true);
    this.menus.showJoin(
      async (code) => {
        try {
          const s = await Session.join(code, this.menus.playerName);
          this.attachSession(s);
          this.showLobby();
          return null;
        } catch (e) {
          return (e as Error).message;
        }
      },
      () => this.closeMenu(),
    );
  }

  showLobby(): void {
    const s = this.session;
    if (!s) return;
    this.hooks.onModal(true);
    this.menus.showLobby(s, (id) => this.gameById(id)?.name ?? id, {
      onStart: () => {
        s.startGame(this.nextOpts.get(s.gameId) ?? {});
      },
      onLeave: () => this.leaveLobby(),
      onClose: () => {
        this.closeMenu();
        if (!this.active) this.ctx.hud.setObjective(this.hubObjective());
      },
    });
  }

  private attachSession(s: Session): void {
    this.session = s;
    s.onRoster = () => this.menus.refreshLobby();
    s.onStart = (gameId, seed, opts) => this.startNet(gameId, seed, opts);
    s.onGame = (from, d) => {
      if (this.active && this.active.net === s) this.active.receive(from, d);
    };
    s.onClosed = (reason) => this.sessionClosed(s, reason);
    this.ctx.hud.setObjective(this.hubObjective());
  }

  leaveLobby(): void {
    this.session?.leave();
  }

  private sessionClosed(s: Session, reason: string): void {
    if (this.session !== s) return;
    if (this.active?.net === s) this.quit();
    this.session = null;
    if (['lobby', 'end'].includes(this.menus.kind)) this.closeMenu();
    this.ctx.avatars.clear();
    if (reason) this.ctx.hud.toast(reason, 'bad', 2200);
    this.ctx.hud.setObjective(this.hubObjective());
  }

  // ================================================================== start / finish

  private startSolo(g: BaseGame): void {
    this.closeMenu();
    g.net = null;
    g.seed = Math.floor(Math.random() * 1e9);
    g.opts = {};
    this.start(g);
  }

  private startNet(gameId: string, seed: number, opts: Record<string, unknown>): void {
    const g = this.gameById(gameId);
    if (!g || !this.session) return;
    if (this.menus.isOpen) this.menus.close();
    this.hooks.onModal(false);
    g.net = this.session;
    g.seed = seed;
    g.opts = opts;
    this.start(g);
  }

  private start(g: BaseGame): void {
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
    const s = g.net;
    if (s) this.nextOpts.set(g.id, g.nextOpts());
    if (s?.isHost) s.gameOver();

    window.setTimeout(() => {
      if (this.active !== g) return;
      this.hooks.onModal(true);
      const extra = { best: this.save.data.best[g.id] ?? r.score, isBest, unlocked };
      if (!s) {
        this.menus.showEnd(r, extra, { onRetry: () => this.retry(), onBack: () => this.quitFromCard(), backLabel: 'Balik sa barangay' });
      } else {
        this.menus.showEnd(r, extra, {
          onRetry: s.isHost ? () => s.startGame(g.nextOpts()) : null,
          retryNote: s.isHost ? '' : 'Hintayin ang host para sa susunod na laro.',
          onBack: () => {
            this.quitFromCard();
            this.showLobby();
          },
          backLabel: 'Balik sa lobby',
        });
      }
    }, 1100);
  }

  private retry(): void {
    const g = this.active;
    if (!g) return;
    this.menus.close();
    this.hooks.onModal(false);
    g.stop();
    g.group.resetToHome(this.ctx.groundAt);
    this.ended = false;
    g.start();
  }

  private quitFromCard(): void {
    this.menus.close();
    this.hooks.onModal(false);
    this.quit();
  }

  /**
   * Leave the current game. In multiplayer, a client leaving mid-game also
   * leaves the lobby (so the host's game does not wait for them), and a host
   * leaving mid-game ends it for everyone.
   */
  quitMidGame(): void {
    const g = this.active;
    if (g?.net && !this.ended) {
      if (g.net.isHost) g.net.gameOver();
      this.leaveLobby();
      return;
    }
    this.quit();
  }

  quit(): void {
    const g = this.active;
    if (!g) return;
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
