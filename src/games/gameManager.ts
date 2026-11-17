import * as THREE from 'three';
import type { SaveStore } from '../core/save';
import {
  SLIPPERS, dailyChallenge, dailyReward, nextRank, nextStarGap, rankFor, rankIndex, starText, starsFor, today, yesterday,
} from '../core/progression';
import {
  QUEST_TROPA, TREAT_MULT, RIVALS, RIVAL_MAX, advanceQuests, checkBadges, dailyQuests, eventMult, nameTagSub, pushRecord, rivalReward, rivalTarget, rollQuests,
  type Badge, type Finish, type NightEvent, type Quest,
} from '../core/meta';
import { Session } from '../net/session';
import { fetchTop, submitScore, type BoardRow } from '../net/leaderboard';
import { Blackboard } from '../world/blackboard';
import { L } from '../core/i18n';
import { BADGES } from '../core/meta';
import type { Menus } from '../ui/menus';
import { NpcGroup } from '../world/npcs';
import type { BaseGame } from './baseGame';
import { Holen } from './holen';
import { LangitLupa } from './langitLupa';
import { LuksongBaka } from './luksongBaka';
import { Patintero } from './patintero';
import { Piko } from './piko';
import { PukpokPalayok } from './pukpokPalayok';
import { Sipa } from './sipa';
import { Taguan } from './taguan';
import { TumbangPreso } from './tumbangPreso';
import { Sungka } from './sungka';
import { Trumpo } from './trumpo';
import type { GameContext, GameResult } from './types';

const INTERACT_RADIUS = 2.7;

export interface ManagerHooks {
  /** A blocking menu opened/closed (release / re-grab pointer lock, hide touch HUD). */
  onModal: (open: boolean) => void;
  /** The night event running right now (core/meta), or null. */
  event: () => NightEvent | null;
  /** Badges earned (show a toast + sound). */
  onBadges: (b: Badge[]) => void;
}

/** Torneo: 3 games in a row in a lobby, standings by placement. */
interface Tour {
  id: string;
  list: string[];
  i: number;
  totals: Map<string, number>;
}
const TOUR_PTS = [5, 3, 2, 1, 0, 0];
const TAUNT_RADIUS = 6.5;
/** Plaza chalkboard: beside the spawn point, angled toward it and the road. */
const BOARD = { x: 1.0, z: 8.9, rot: Math.atan2(-2.5, -1.7) };
const BOARD_REACH = 2.6;
/** Aling Nena's sari-sari store counter (the Tindahan). */
const STORE_SPOT = new THREE.Vector3(6.6, 0, -7.1);
const STORE_REACH = 2.2;

/**
 * Owns the street games, their NPC groups in the hub, the interact system,
 * unlock order, lobbies (multiplayer sessions), and the start / finish /
 * retry / quit flow.
 */
export class GameManager {
  /** Order here = unlock order. Add new games to this list. */
  readonly games: BaseGame[] = [
    new TumbangPreso(), new Sipa(), new Patintero(), new Taguan(), new LangitLupa(),
    new Piko(), new LuksongBaka(), new Holen(), new PukpokPalayok(), new Sungka(), new Trumpo(),
  ];
  active: BaseGame | null = null;
  session: Session | null = null;
  private ended = false;
  private ctx: GameContext;
  /** Options for the next multiplayer run of each game (Taguan rotates the seeker). */
  private nextOpts = new Map<string, Record<string, unknown>>();
  private tour: Tour | null = null;
  /** Hub banter: which spot the player is near, and when each rival last spoke. */
  private nearSpot: BaseGame | null = null;
  private tauntAt = new Map<string, number>();
  private board: Blackboard;
  private store: NpcGroup;
  private boardT = 0;
  private topT = 0;
  private top: { game: string; rows: BoardRow[] | null } = { game: '', rows: null };

  constructor(base: Omit<GameContext, 'finish'>, private save: SaveStore, private menus: Menus, private hooks: ManagerHooks) {
    this.ctx = { ...base, finish: (r) => this.finish(r) };
    this.board = new Blackboard(base.scene, base.physics, BOARD.x, BOARD.z, BOARD.rot);
    this.store = new NpcGroup(base.scene, STORE_SPOT, [{ x: 7.05, z: -7.85, faceX: 6.6, faceZ: -5, mode: 'wave' }], new THREE.Vector3(6.6, 3.55, -7.6), base.blobs, base.groundAt);
    this.store.kids[0].root.scale.setScalar(1.3); // Aling Nena is a grown-up
    this.labelStore();
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

  /** Every implemented game is open from the start (no unlock gating). */
  isPlayable(i: number): boolean {
    return this.games[i].implemented;
  }

  gameById(id: string): BaseGame | undefined {
    return this.games.find((g) => g.id === id);
  }

  refreshLabels(): void {
    this.games.forEach((g) => {
      if (!g.implemented) g.group.setLabel(g.name, 'Soon!', '#9aa3c7');
      else {
        const best = this.save.data.best[g.id];
        const daily = this.daily().gameId === g.id && !this.dailyDoneToday() ? L('  HAMON!', '  DAILY!') : '';
        const rv = this.rivalText(g.id);
        g.group.setLabel(g.name, (best !== undefined ? `${starText(this.save.data.stars[g.id] ?? 0)}  Best ${best}` : L('Laro tayo!', "Let's play!")) + daily + (rv ? `  ·  ${rv}` : ''), g.layout.accent);
      }
    });
  }

  /** "Karibal: Jun-jun 35" or '' once every level is beaten. */
  rivalText(id: string): string {
    const rv = RIVALS[id];
    const lvl = this.save.data.rivals[id] ?? 0;
    if (!rv) return '';
    if (lvl >= RIVAL_MAX) return L(`${rv.name}: talo na!`, `${rv.name}: beaten!`);
    return L(`Karibal: ${rv.name} ${rivalTarget(id, lvl)}`, `Rival: ${rv.name} ${rivalTarget(id, lvl)}`);
  }

  quests(): Quest[] {
    const names: Record<string, string> = {};
    for (const g of this.games) names[g.id] = g.name;
    return dailyQuests(this.games.filter((g) => g.implemented).map((g) => g.id), names);
  }

  /** Name/title line other players see on my name tag. */
  get myTag(): string {
    return nameTagSub(this.save.data);
  }

  private labelStore(): void {
    this.store.setLabel(L('Tindahan', 'Store'), L('Aling Nena  ·  Tsinelas, Titulo, Palamig', 'Aling Nena  ·  Flip-flops, Titles, Drinks'), '#ffd166');
  }

  /** Language switched: redraw every in-world label and the board. */
  onLanguage(): void {
    this.refreshLabels();
    this.labelStore();
    this.boardT = 0;
    this.ctx.touch.relabel();
    if (!this.active) {
      this.ctx.touch.setActionLabel(L('Bato', 'Throw'));
      this.ctx.hud.setObjective(this.hubObjective());
    }
    this.ctx.hud.setRank(this.progressText());
  }

  /** Keep the plaza chalkboard current (redraws only when something changed). */
  private updateBoard(dt: number): void {
    this.boardT -= dt;
    this.topT -= dt;
    const d = this.daily();
    if (this.topT <= 0 || this.top.game !== d.gameId) {
      this.topT = 60;
      const want = d.gameId;
      this.top = { game: want, rows: this.top.game === want ? this.top.rows : null };
      fetchTop(want, 'week').then((rows) => {
        if (this.top.game === want) this.top.rows = rows;
        this.boardT = 0;
      });
    }
    if (this.boardT > 0) return;
    this.boardT = 1;
    const data = this.save.data;
    rollQuests(data);
    const ev = this.hooks.event();
    const qs = this.quests();
    this.board.draw({
      date: new Date().toLocaleDateString(L('fil-PH', 'en-US'), { weekday: 'long', month: 'long', day: 'numeric' }),
      rank: rankFor(data.tropaPoints).name,
      tropa: data.tropaPoints,
      barya: data.barya,
      streak: data.streak,
      daily: { name: this.gameById(d.gameId)?.name ?? d.gameId, target: d.target, reward: dailyReward(data.streak), done: this.dailyDoneToday() },
      quests: qs.map((q, i) => ({ text: q.text, prog: data.quests.prog[i] ?? 0, goal: q.goal, done: data.quests.done[i] ?? false })),
      event: ev ? ev.chip : null,
      top: { game: this.gameById(d.gameId)?.name ?? d.gameId, rows: this.top.rows ? this.top.rows.slice(0, 3) : null },
      badges: { got: BADGES.filter((b) => data.badges[b.id]).length, total: BADGES.length },
    });
  }

  daily(): { gameId: string; target: number } {
    return dailyChallenge(this.games.filter((g) => g.implemented).map((g) => g.id));
  }

  dailyDoneToday(): boolean {
    return this.save.data.dailyDone === today();
  }

  /** "Tambay  ·  12 sa 21 ★" for the HUD chip. */
  progressText(): string {
    const total = Object.values(this.save.data.stars).reduce((a, b) => a + b, 0);
    const max = this.games.filter((g) => g.implemented).length * 3;
    return `${rankFor(this.save.data.tropaPoints).name}  ·  ${total}/${max}★${this.save.data.streak > 1 ? `  ·  ${this.save.data.streak} ${L('araw', 'days')}` : ''}`;
  }

  hubObjective(): string {
    if (this.session) return L(`Nasa lobby ka (${this.session.code}). Buksan ang pause menu para makita ang lobby.`, `You're in lobby ${this.session.code}. Open the pause menu to see it.`);
    if (!this.dailyDoneToday()) {
      const d = this.daily();
      const g = this.gameById(d.gameId)!;
      return L(
        `Hamon ngayon: ${g.name}, ${d.target}+ puntos (+${dailyReward(this.save.data.streak)} Tropa Points) ${g.where}`,
        `Today's challenge: score ${d.target}+ in ${g.name} (+${dailyReward(this.save.data.streak)} Tropa Points), ${g.where}`,
      );
    }
    const next = this.games.find((g, i) => this.isPlayable(i) && this.save.data.best[g.id] === undefined);
    if (next) return L(`Subukan ang ${next.name} ${next.where}`, `Try ${next.name} (${next.blurb}), ${next.where}`);
    const unstarred = this.games.find((g) => g.implemented && (this.save.data.stars[g.id] ?? 0) < 3);
    if (unstarred) return L(`Kunin ang ★★★ sa ${unstarred.name}! (${starText(this.save.data.stars[unstarred.id] ?? 0)})`, `Go for ★★★ in ${unstarred.name}! (${starText(this.save.data.stars[unstarred.id] ?? 0)})`);
    return L('Ipunin ang Tropa Points! Laruin ulit o mag-lobby kasama ang tropa.', 'Keep earning Tropa Points! Replay a game or start a lobby with friends.');
  }

  // ================================================================== frame

  update(dt: number, t: number, camPos: THREE.Vector3, controlsActive: boolean, simulate: boolean): void {
    for (const g of this.games) g.group.update(dt, t, camPos, g === this.active);
    this.store.update(dt, t, camPos, false);
    const { hud, touch, input, player, isTouch } = this.ctx;
    this.updateBoard(dt);

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
    this.hubBanter(player.position, controlsActive);
    // Aling Nena's store counter opens the Tindahan
    const sd = Math.hypot(STORE_SPOT.x - player.position.x, STORE_SPOT.z - player.position.z);
    if (controlsActive && sd < STORE_REACH && (!best || sd < bestD)) {
      hud.setPrompt(L('Bumili kay Aling Nena', 'Shop at Aling Nena\'s'), isTouch() ? undefined : 'E');
      touch.setInteractReady(true);
      if (input.pressed('interact')) {
        this.ctx.audio.play('bell');
        this.hooks.onModal(true);
        this.menus.showStore(() => this.closeMenu());
      }
      return;
    }
    // the plaza chalkboard opens the Libro
    const bd = Math.hypot(this.board.front.x - player.position.x, this.board.front.z - player.position.z);
    if (controlsActive && bd < BOARD_REACH && (!best || bd < bestD)) {
      hud.setPrompt(L('Libro ng Barangay', 'Barangay Book'), isTouch() ? undefined : 'E');
      touch.setInteractReady(true);
      if (input.pressed('interact')) {
        this.ctx.audio.play('ui');
        this.hooks.onModal(true);
        this.menus.showBook('hamon', () => this.closeMenu());
      }
      return;
    }
    if (!best || !controlsActive) {
      hud.setPrompt(null);
      touch.setInteractReady(false);
      return;
    }
    const key = isTouch() ? undefined : 'E';
    if (!best.implemented) hud.setPrompt(`${best.name}: Soon! Abangan.`);
    else hud.setPrompt(L(`Laro tayo! ${best.name}`, `Play ${best.name}`), key);
    touch.setInteractReady(best.implemented);

    if (input.pressed('interact')) {
      if (!best.implemented) {
        hud.toast('Soon!', 'small', 900);
        this.ctx.audio.play('ui');
      } else this.openSpotMenu(best);
    }
  }

  /** A rival taunts you when you walk up to their game (at most every 40 s each). */
  private hubBanter(p: THREE.Vector3, active: boolean): void {
    let near: BaseGame | null = null;
    for (const g of this.games) {
      if (!g.implemented) continue;
      if (Math.hypot(g.layout.spot.x - p.x, g.layout.spot.z - p.z) < TAUNT_RADIUS) near = g;
    }
    if (near === this.nearSpot) return;
    this.nearSpot = near;
    if (!near || !active) return;
    const rv = RIVALS[near.id];
    const lvl = this.save.data.rivals[near.id] ?? 0;
    const now = performance.now();
    if (!rv || lvl >= RIVAL_MAX || now - (this.tauntAt.get(near.id) ?? -1e9) < 40000) return;
    this.tauntAt.set(near.id, now);
    const line = rv.taunts[Math.floor(Math.random() * rv.taunts.length)];
    this.ctx.hud.toast(`${rv.name}: "${line}"`, 'small', 2400);
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
      blurb: g.blurb,
      howTo: g.howTo,
      canSolo: playable,
      lockedMsg: playable ? '' : L(`Tapusin muna ang ${this.games[i - 1]?.name ?? 'naunang laro'} para makapaglaro mag-isa.`, `Finish ${this.games[i - 1]?.name ?? 'the previous game'} first to play solo.`),
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
    this.menus.showBusy(L('Gumagawa ng lobby...', 'Creating a lobby...'));
    try {
      const s = await Session.host(g.id, this.menus.playerName, this.menus.playerFace, this.myTag);
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
          const s = await Session.join(code, this.menus.playerName, this.menus.playerFace, this.myTag);
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
        this.tour = null;
        s.startGame(this.nextOpts.get(s.gameId) ?? {});
      },
      onTour: () => this.startTour(),
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

  /** Host: start a Torneo of 3 different random games. */
  private startTour(): void {
    const s = this.session;
    if (!s?.isHost) return;
    const pool = this.games.filter((g) => g.implemented).map((g) => g.id);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const list = pool.slice(0, 3);
    this.tourStep({ id: Math.random().toString(36).slice(2, 8), list, i: 0 });
  }

  private tourStep(t: { id: string; list: string[]; i: number }): void {
    const s = this.session;
    if (!s?.isHost) return;
    const gid = t.list[t.i];
    s.setGame(gid);
    s.startGame({ ...(this.nextOpts.get(gid) ?? {}), tour: t });
  }

  leaveLobby(): void {
    this.session?.leave();
  }

  private sessionClosed(s: Session, reason: string): void {
    if (this.session !== s) return;
    if (this.active?.net === s) this.quit();
    this.session = null;
    this.tour = null;
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
    const t = opts.tour as { id: string; list: string[]; i: number } | undefined;
    if (t && Array.isArray(t.list)) {
      if (this.tour?.id !== t.id) this.tour = { id: t.id, list: t.list, i: t.i, totals: new Map() };
      else this.tour.i = t.i;
    } else this.tour = null;
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
    const data = this.save.data;
    const rankBefore = rankIndex(data.tropaPoints);
    const prevBest = data.best[g.id];
    rollQuests(data);
    // night event bonus
    const ev = this.hooks.event();
    const mult = eventMult(ev, g.id);
    let eventMsg: string | undefined;
    if (mult !== 1 && r.points > 0) {
      const extra = Math.round(r.points * (mult - 1));
      r.points += extra;
      eventMsg = `${ev!.name}: +${extra} Tropa Points (x${mult})`;
    }
    // a treat from the store boosts this game's Tropa Points
    if (data.boost > 0 && r.points > 0) {
      const extra = Math.round(r.points * (TREAT_MULT - 1));
      r.points += extra;
      data.boost--;
      const note = L(`Pampalamig: +${extra} Tropa Points`, `Treat bonus: +${extra} Tropa Points`);
      eventMsg = eventMsg ? `${eventMsg}  ·  ${note}` : note;
    }
    // stars
    const stars = starsFor(g.id, r.score);
    const prevStars = data.stars[g.id] ?? 0;
    if (stars > prevStars) data.stars[g.id] = stars;
    // daily challenge
    let dailyMsg: string | undefined;
    const d = this.daily();
    if (d.gameId === g.id && !this.dailyDoneToday() && r.score >= d.target) {
      data.streak = data.dailyDone === yesterday() ? data.streak + 1 : 1;
      data.dailyDone = today();
      const bonus = dailyReward(data.streak - 1);
      r.points += bonus;
      dailyMsg = L(`Hamon ng Araw, tapos! +${bonus} Tropa Points  ·  ${data.streak} araw sunod-sunod`, `Daily challenge done! +${bonus} Tropa Points  ·  ${data.streak}-day streak`);
    }
    // rival (solo or multiplayer, your own score counts)
    let rivalMsg: string | undefined;
    let rivalBeaten = false;
    const rv = RIVALS[g.id];
    const lvl = data.rivals[g.id] ?? 0;
    if (rv && lvl < RIVAL_MAX) {
      const target = rivalTarget(g.id, lvl);
      if (r.score >= target) {
        rivalBeaten = true;
        const pay = rivalReward(lvl);
        data.rivals[g.id] = lvl + 1;
        data.barya += pay;
        rivalMsg = lvl + 1 >= RIVAL_MAX
          ? L(`Talo mo na si ${rv.name} sa lahat ng level! "${rv.lose}" +${pay} Barya`, `You beat ${rv.name} at every level! "${rv.lose}" +${pay} Barya`)
          : L(`Talo mo si ${rv.name} (${target})! "${rv.lose}" +${pay} Barya  ·  Susunod: ${rivalTarget(g.id, lvl + 1)}`, `You beat ${rv.name} (${target})! "${rv.lose}" +${pay} Barya  ·  Next: ${rivalTarget(g.id, lvl + 1)}`);
      } else rivalMsg = L(`${rv.name}: "${rv.win}" Kailangan mo ng ${target}.`, `${rv.name}: "${rv.win}" You need ${target} to beat them.`);
    }
    // torneo standings (every client computes the same totals from the host's rows)
    let tourLines: string[] | undefined;
    let tourWon = false;
    let tourNext: string | null = null;
    const t = this.tour;
    if (t && g.net && g.lastRows.length) {
      const sorted = [...g.lastRows].sort((a, b) => b.score - a.score);
      sorted.forEach((row) => {
        // ties share the better placement
        const place = sorted.findIndex((x) => x.score === row.score);
        t.totals.set(row.id, (t.totals.get(row.id) ?? 0) + (TOUR_PTS[place] ?? 0));
      });
      const table = [...t.totals].sort((a, b) => b[1] - a[1]);
      const last = t.i >= t.list.length - 1;
      tourLines = [
        last ? L('TORNEO: Huling resulta', 'TOURNAMENT: Final standings') : L(`TORNEO: Laro ${t.i + 1} sa ${t.list.length}`, `TOURNAMENT: Game ${t.i + 1} of ${t.list.length}`),
        ...table.map(([id, pts], i) => `${i + 1}. ${id === g.net!.selfId ? L('Ikaw', 'You') : g.net!.nameOf(id)}  ${pts} pts`),
      ];
      if (last) {
        tourWon = table[0]?.[0] === g.net.selfId && (table[1]?.[1] ?? -1) < table[0][1];
        if (tourWon) tourLines.push(L('Ikaw ang KAMPEON ng Torneo!', 'You are the TOURNAMENT CHAMPION!'));
      } else tourNext = t.list[t.i + 1];
    }
    // records, quests, points
    const recordRank = pushRecord(data, g.id, r.score);
    const fin: Finish = {
      gameId: g.id, score: r.score, won: r.won, stars, multiplayer: !!g.net, feats: r.feats ?? [],
      event: ev?.id ?? null, tourWon, rivalBeaten, rivalLevel: lvl,
    };
    const q = advanceQuests(data, this.quests(), fin, r.points);
    if (q.done.length) r.points += QUEST_TROPA * q.done.length;
    const questMsgs = q.done.map((x) => L(`Gawain tapos: ${x.text}`, `Quest done: ${x.text}`));
    if (q.bonus) questMsgs.push(L('Lahat ng gawain ngayon, tapos! Bonus Barya!', "All of today's quests done! Bonus Barya!"));
    data.barya += Math.round(r.points);
    this.save.addPoints(r.points);
    const isBest = this.save.recordScore(g.id, r.score);
    const badges = checkBadges(data, fin);
    // rank up (and tsinelas unlocks that come with it)
    const rankAfter = rankIndex(data.tropaPoints);
    let rankMsg: string | undefined;
    if (rankAfter > rankBefore) {
      const sl = SLIPPERS.find((x) => x.rank === rankAfter);
      rankMsg = L(`Bagong ranggo: ${rankFor(data.tropaPoints).name}!${sl ? `  Bagong tsinelas: ${sl.name}` : ''}`, `New rank: ${rankFor(data.tropaPoints).name}!${sl ? `  New flip-flops: ${sl.name}` : ''}`);
      this.session?.setSub(this.myTag);
    }
    // near-miss nudge: the closest goal you just missed
    let nudge: string | undefined;
    const gap = nextStarGap(g.id, r.score);
    if (prevBest !== undefined && r.score < prevBest && prevBest - r.score <= Math.max(5, prevBest * 0.25)) nudge = L(`Kulang ka na lang ng ${prevBest - r.score} para sa best mo!`, `Just ${prevBest - r.score} short of your best!`);
    else if (gap && gap.gap <= Math.max(5, r.score * 0.3)) nudge = L(`Kulang ka na lang ng ${gap.gap} para sa ${starText(gap.stars)}!`, `Just ${gap.gap} more for ${starText(gap.stars)}!`);
    else {
      const nr = nextRank(data.tropaPoints);
      if (nr) nudge = L(`${nr.at - data.tropaPoints} Tropa Points pa para maging ${nr.name}`, `${nr.at - data.tropaPoints} more Tropa Points to become ${nr.name}`);
    }
    this.save.persist();
    this.refreshLabels();
    this.ctx.hud.setPoints(data.tropaPoints);
    this.ctx.hud.setRank(this.progressText());
    if (rankMsg) window.setTimeout(() => this.ctx.audio.play('win'), 1500);
    if (badges.length) window.setTimeout(() => this.ctx.audio.play('badge'), 1900);
    const prog = {
      stars, newStars: stars > prevStars, dailyMsg, rankMsg, nudge, eventMsg, rivalMsg, questMsgs, tourLines,
      badges: badges.map((b) => `${b.name} (+${b.barya} Barya)`), prevBest, recordRank,
      barya: data.barya, rank: rankFor(data.tropaPoints).name,
    };
    this.ctx.audio.play(r.won ? 'win' : 'lose');
    // online leaderboard: send in the background, celebrate a top-20 spot
    if (data.settings.onlineScores && r.score > 0) {
      submitScore(g.id, r.score, this.menus.playerName).then((res) => {
        if (!res?.week || res.week > 20 || this.active !== g) return;
        window.setTimeout(() => this.ctx.hud.toast(L(`Pang-#${res.week} ka ngayong linggo sa ${g.name}!`, `#${res.week} this week in ${g.name}!`), 'good', 2600), 1800);
      });
    }
    const s = g.net;
    if (s) this.nextOpts.set(g.id, g.nextOpts());
    if (s?.isHost) s.gameOver();

    window.setTimeout(() => {
      if (this.active !== g) return;
      this.hooks.onModal(true);
      const extra = { best: this.save.data.best[g.id] ?? r.score, isBest, ...prog };
      if (!s) {
        this.menus.showEnd(r, extra, { onRetry: () => this.retry(), onBack: () => this.quitFromCard(), backLabel: L('Balik sa barangay', 'Back to the barangay') });
      } else {
        const tt = this.tour;
        const nextName = tourNext ? this.gameById(tourNext)?.name ?? tourNext : '';
        let onRetry: (() => void) | null = null;
        let retryLabel: string | undefined;
        if (s.isHost) {
          if (tt && tourNext) {
            onRetry = () => this.tourStep({ id: tt.id, list: tt.list, i: tt.i + 1 });
            retryLabel = L(`Susunod: ${nextName} (${tt.i + 2}/${tt.list.length})`, `Next: ${nextName} (${tt.i + 2}/${tt.list.length})`);
          } else if (tt) {
            onRetry = () => this.startTour();
            retryLabel = L('Bagong Torneo', 'New Tournament');
          } else onRetry = () => s.startGame(g.nextOpts());
        }
        this.menus.showEnd(r, extra, {
          onRetry,
          retryLabel,
          retryNote: s.isHost ? '' : tourNext ? L(`Susunod sa Torneo: ${nextName}. Hintayin ang host.`, `Next in the tournament: ${nextName}. Waiting for the host.`) : L('Hintayin ang host para sa susunod na laro.', 'Waiting for the host to start the next game.'),
          onBack: () => {
            this.quitFromCard();
            this.showLobby();
          },
          backLabel: L('Balik sa lobby', 'Back to the lobby'),
        });
      }
    }, 1100);
  }

  /** The sorbetero: walk up to the cart during the event for a treat. */
  catchSorbetes(slot: number): void {
    const data = this.save.data;
    data.sorbetes++;
    data.sorbetesSlot = slot;
    data.barya += 15;
    this.save.addPoints(20);
    const badges = checkBadges(data, null);
    this.save.persist();
    this.ctx.hud.setPoints(data.tropaPoints);
    this.ctx.hud.setRank(this.progressText());
    this.ctx.hud.toast(L('Sorbetes! +20 Tropa Points, +15 Barya', 'Ice cream! +20 Tropa Points, +15 Barya'), 'good', 2000);
    this.ctx.audio.play('pickup');
    if (badges.length) this.hooks.onBadges(badges);
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
    touch.setActionLabel(L('Bato', 'Throw'));
    touch.setJumpVisible(true);
    this.active = null;
    this.ended = false;
    hud.setObjective(this.hubObjective());
  }
}
