import type { SaveStore, Settings } from '../core/save';
import type { GameResult } from '../games/types';
import { cleanCode, sanitizeName, type Session } from '../net/session';
import { device } from '../core/device';
import { loadSavedFace, processFaceFile, saveFace } from '../net/face';
import { RANKS, STAR_THRESHOLDS, rankIndex, starText } from '../core/progression';
import { BADGES, QUEST_ALL_BONUS, QUEST_BARYA, SHOP, buy, slipperChoices, type Quest } from '../core/meta';
import { copyText, el, onTap } from './dom';
import { shareResultImage } from './shareCard';
import { fetchTop } from '../net/leaderboard';

type Kind = 'none' | 'pause' | 'settings' | 'end' | 'game' | 'join' | 'lobby' | 'busy' | 'book';

/** What the Libro (book) screen needs from the game manager. */
export interface BookInfo {
  games: { id: string; name: string }[];
  quests: Quest[];
  daily: { name: string; target: number; done: boolean; streak: number; reward: number };
  rival: (id: string) => string;
}

/** Everything the end card can show besides the score. */
export interface EndExtra {
  best: number;
  isBest: boolean;
  prevBest?: number;
  stars?: number;
  newStars?: boolean;
  dailyMsg?: string;
  rankMsg?: string;
  nudge?: string;
  eventMsg?: string;
  rivalMsg?: string;
  questMsgs?: string[];
  tourLines?: string[];
  badges?: string[];
  recordRank?: number;
  barya?: number;
  rank?: string;
}
const NAME_KEY = 'barangay-after-dark:name';

export interface MenuCallbacks {
  onStart: () => void;
  onResume: () => void;
  onQuitGame: () => void;
  onSettings: (s: Settings) => void;
  onResetProgress: () => void;
  onUiSound: () => void;
  /** My custom face changed (null = removed). */
  onFace: (face: string | null) => void;
  /** Tsinelas color picked (index into slipperChoices). */
  onSlipper: (i: number) => void;
  /** Data for the Libro screen. */
  bookInfo: () => BookInfo;
  /** Something was bought or equipped in the Tindahan. */
  onShop: () => void;
}

/**
 * Title screen, pause menu, settings and the end-of-game card.
 * All text is Taglish and avoids em-dashes on purpose.
 */
export class Menus {
  private title: HTMLElement;
  private titleBtn: HTMLButtonElement;
  private titleMeta: HTMLElement;
  private layer = el('div.screen.dim.interactive.hidden');
  private openKind: Kind = 'none';
  private lobbyRefresh: (() => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private name = '';

  constructor(private parent: HTMLElement, private save: SaveStore, private cb: MenuCallbacks, private isTouch: () => boolean) {
    this.titleBtn = el('button.btn.start-btn', { text: 'Naglo-load...' });
    this.titleBtn.disabled = true;
    this.titleMeta = el('div.meta');
    const loading = el('div.loading-bar', {}, el('i'));
    this.title = el(
      'div.title.interactive',
      {},
      el('div.logo', {}, el('div.crown', { text: '♛' }), el('div.l1', { text: 'Hari ng' }), el('div.l2', { text: 'KANTO' })),
      el('div.tagline', { text: 'Laro ng Lahi sa ilalim ng buwan' }),
      loading,
      this.titleBtn,
      this.titleMeta,
    );
    onTap(this.titleBtn, () => {
      if (!this.titleBtn.disabled) this.cb.onStart();
    });
    parent.append(this.title, this.layer);
    // Prevent taps on menus from reaching the game canvas
    this.layer.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  // --------------------------------------------------------------- title

  setTitleReady(): void {
    this.title.querySelector('.loading-bar')?.remove();
    this.titleBtn.disabled = false;
    this.refreshTitle();
  }

  refreshTitle(): void {
    if (!this.titleBtn.disabled) this.titleBtn.textContent = this.isTouch() ? 'Tap to start' : 'Click to start';
    const pts = this.save.data.tropaPoints;
    this.titleMeta.textContent = pts > 0 ? `★ ${pts} Tropa Points  ·  ${RANKS[rankIndex(pts)].name}${this.save.data.streak > 1 ? `  ·  ${this.save.data.streak} araw sunod-sunod` : ''}` : 'Walk around. Find the kids. Laro tayo!';
  }

  showTitle(v: boolean): void {
    this.title.classList.toggle('hidden', !v);
    if (v) this.refreshTitle();
  }

  // --------------------------------------------------------------- layer helpers

  get isOpen(): boolean {
    return this.openKind !== 'none';
  }
  get kind(): string {
    return this.openKind;
  }

  close(): void {
    this.setKeys(null);
    this.openKind = 'none';
    this.lobbyRefresh = null;
    this.layer.classList.add('hidden');
    this.layer.replaceChildren();
  }

  /** Keyboard shortcuts for the open card (removed on close / next card). */
  private setKeys(fn: ((e: KeyboardEvent) => void) | null): void {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = fn;
    if (fn) window.addEventListener('keydown', fn);
  }

  private open(kind: Exclude<Kind, 'none'>, card: HTMLElement): void {
    this.setKeys(null);
    this.openKind = kind;
    this.lobbyRefresh = null;
    this.layer.replaceChildren(card);
    this.layer.classList.remove('hidden');
  }

  private button(text: string, cls: string, fn: () => void): HTMLButtonElement {
    const b = el(`button.btn${cls}` as 'button', { text });
    onTap(b, () => {
      this.cb.onUiSound();
      fn();
    });
    return b;
  }

  // --------------------------------------------------------------- pause

  showPause(inGame: boolean, net: { inLobby: boolean; inNetGame: boolean; onJoin: () => void; onLobby: () => void } | null = null): void {
    const help = this.isTouch()
      ? '<b>Kaliwa:</b> joystick para lumakad (itulak nang todo para tumakbo)<br><b>Kanan:</b> i-drag para tumingin<br><b>Laro!</b> para makipaglaro, <b>Bato/Sipa</b> para sa aksyon'
      : '<b>WASD</b> lakad, <b>Shift</b> takbo, <b>Space</b> talon<br><b>Mouse</b> tingin, <b>Left click</b> bato o sipa<br><b>E</b> makipaglaro, <b>Esc</b> pause';
    const card = el(
      'div.card',
      {},
      el('h2', { text: 'Pahinga muna' }),
      el('p', { text: inGame ? 'Naka-pause ang laro.' : 'Nasa barangay ka.' }),
      el(
        'div.btns',
        {},
        this.button('Tuloy', '', () => this.cb.onResume()),
        this.button('Libro ng Barangay', '.alt', () => this.showBook('hamon', () => this.showPause(inGame, net))),
        this.button('Settings', '.alt', () => this.showSettings(() => this.showPause(inGame, net))),
        inGame ? this.button(net?.inNetGame ? 'Umalis sa laro' : 'Balik sa barangay', '.alt', () => this.cb.onQuitGame()) : null,
        !inGame && net && !net.inLobby ? this.button('Sumali sa lobby', '.alt', net.onJoin) : null,
        !inGame && net?.inLobby ? this.button('Lobby', '.alt', net.onLobby) : null,
      ),
      net?.inNetGame ? el('p', { text: 'Tuloy pa rin ang laro habang naka-pause.' }) : null,
      el('div.help', { html: help }),
    );
    this.open('pause', card);
  }

  // --------------------------------------------------------------- settings

  showSettings(back: () => void): void {
    const s = this.save.data.settings;
    const apply = () => {
      this.save.persist();
      this.cb.onSettings(s);
    };

    const sens = el('input', { attrs: { type: 'range', min: '0.2', max: '3', step: '0.05' } }) as HTMLInputElement;
    sens.value = String(s.sensitivity);
    const sensVal = el('span', { text: s.sensitivity.toFixed(2) });
    sens.addEventListener('input', () => {
      s.sensitivity = parseFloat(sens.value);
      sensVal.textContent = s.sensitivity.toFixed(2);
      apply();
    });

    const vol = el('input', { attrs: { type: 'range', min: '0', max: '1', step: '0.05' } }) as HTMLInputElement;
    vol.value = String(s.volume);
    vol.addEventListener('input', () => {
      s.volume = parseFloat(vol.value);
      apply();
    });

    const seg = (opts: [string, () => boolean, () => void][]) => {
      const wrap = el('div.seg');
      const btns = opts.map(([label, isOn, set]) => {
        const b = el('button', { text: label });
        b.classList.toggle('on', isOn());
        onTap(b, () => {
          set();
          apply();
          btns.forEach((x, i) => x.classList.toggle('on', opts[i][1]()));
        });
        return b;
      });
      wrap.append(...btns);
      return wrap;
    };

    let resetArmed = false;
    const reset = this.button('Burahin ang progress', '.danger.small', () => {
      if (!resetArmed) {
        resetArmed = true;
        reset.textContent = 'Sigurado ka? Pindot ulit';
        return;
      }
      this.cb.onResetProgress();
      reset.textContent = 'Nabura na';
      reset.disabled = true;
    });

    const card = el(
      'div.card.settings',
      {},
      el('h2', { text: 'Settings' }),
      el('label', {}, el('span', {}, document.createTextNode('Sensitivity '), sensVal), sens),
      el('label', {}, el('span', { text: 'Invert Y' }), seg([
        ['Off', () => !s.invertY, () => (s.invertY = false)],
        ['On', () => s.invertY, () => (s.invertY = true)],
      ])),
      el('label', {}, el('span', { text: 'Quality' }), seg([
        ['Low', () => s.quality === 'low', () => (s.quality = 'low')],
        ['High', () => s.quality === 'high', () => (s.quality = 'high')],
      ])),
      device.isMobile ? null : el('label', {}, el('span', { text: 'Glow (mabigat sa GPU)' }), seg([
        ['Off', () => !s.glow, () => (s.glow = false)],
        ['On', () => s.glow, () => (s.glow = true)],
      ])),
      el('label', {}, el('span', { text: 'Auto FPS' }), seg([
        ['Off', () => !s.autoFps, () => (s.autoFps = false)],
        ['On', () => s.autoFps, () => (s.autoFps = true)],
      ])),
      el('label', {}, el('span', { text: 'Ipakita ang FPS' }), seg([
        ['Off', () => !s.showFps, () => (s.showFps = false)],
        ['On', () => s.showFps, () => (s.showFps = true)],
      ])),
      el('label', {}, el('span', { text: 'Volume' }), vol),
      el('label', {}, el('span', { text: 'Online ranking' }), seg([
        ['Off', () => !s.onlineScores, () => (s.onlineScores = false)],
        ['On', () => s.onlineScores, () => (s.onlineScores = true)],
      ])),
      this.slipperField(),
      this.faceField(),
      el('div.btns', {}, this.button('Balik', '', back), reset),
    );
    this.open('settings', card);
  }

  // --------------------------------------------------------------- end card

  showEnd(
    r: GameResult,
    extra: EndExtra,
    o: { onRetry: (() => void) | null; retryLabel?: string; retryNote?: string; onBack: () => void; backLabel: string },
  ): void {
    const copyBtn = this.button('Copy', '.alt.small', async () => {
      const ok = await copyText(`${r.shareText} Kaya mo bang talunin? ${location.origin}${location.pathname}`);
      copyBtn.textContent = ok ? 'Nakopya na!' : 'Hindi ma-copy';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1600);
    });
    const shareBtn = this.button('I-share', '.alt', async () => {
      shareBtn.textContent = 'Sandali...';
      const res = await shareResultImage({
        game: r.gameName, score: r.score, label: r.scoreLabel, stars: extra.stars ?? 0, name: this.playerName,
        rank: extra.rank ?? '', line: extra.isBest ? 'Bagong best score!' : extra.badges?.[0] ? `Badge: ${extra.badges[0].replace(/ \(.*$/, '')}` : '',
        text: `${r.shareText} Kaya mo bang talunin?`, url: `${location.origin}${location.pathname}`, face: this.playerFace,
      });
      shareBtn.textContent = res === 'shared' ? 'Na-share!' : res === 'saved' ? 'Na-save ang larawan!' : 'Hindi ma-share';
      setTimeout(() => (shareBtn.textContent = 'I-share'), 2000);
    });
    // best line: show the jump when you beat your old best
    const bestLine = extra.isBest
      ? extra.prevBest !== undefined
        ? `Bagong best! ${extra.prevBest} → ${r.score}`
        : 'Unang score mo dito!'
      : `Best: ${extra.best}`;
    const retryBtn = o.onRetry ? this.button(o.retryLabel ?? 'Ulit!', '', o.onRetry) : null;
    const card = el(
      'div.card.end',
      {},
      // endless games rarely "win": earning stars still deserves praise
      el(`h2.${r.won || (extra.stars ?? 0) >= 1 ? 'good' : 'bad'}` as 'h2', { text: r.won ? 'Panalo!' : (extra.stars ?? 0) >= 1 ? 'Ayos!' : 'Talo ka!' }),
      el('p', { text: r.gameName }),
      el('div.score', { text: String(r.score) }),
      el('p', { text: r.scoreLabel }),
      extra.stars !== undefined
        ? el((extra.newStars ? 'div.stars.new' : 'div.stars') as 'div', {}, ...[0, 1, 2].map((i) => el((i < (extra.stars ?? 0) ? 'span.on' : 'span') as 'span', { text: '★', attrs: { style: `animation-delay:${0.25 + i * 0.22}s` } })))
        : null,
      el((extra.isBest ? 'div.best.up' : 'div.best') as 'div', { text: bestLine + (extra.recordRank && !extra.isBest && extra.recordRank <= 3 ? `  ·  #${extra.recordRank} sa rekord mo` : '') }),
      extra.rankMsg ? el('div.badge.rankup', { text: extra.rankMsg }) : null,
      ...(extra.badges ?? []).map((b) => el('div.badge.ach', { text: `Bagong Badge: ${b}` })),
      extra.dailyMsg ? el('div.badge.daily', { text: extra.dailyMsg }) : null,
      ...(extra.questMsgs ?? []).map((q) => el('div.badge.daily', { text: q })),
      extra.rivalMsg ? el('div.badge.rival', { text: extra.rivalMsg }) : null,
      extra.eventMsg ? el('div.badge.event', { text: extra.eventMsg }) : null,
      extra.tourLines ? el('div.tour', {}, ...extra.tourLines.map((l, i) => el(i ? 'div' : 'b', { text: l }))) : null,
      el('div.lines', {}, ...r.lines.map((l) => el('div', { text: l })),
        el('div', { text: `+${r.points} Tropa Points${extra.barya !== undefined ? `  ·  ${extra.barya} Barya` : ''}` }),
        extra.nudge ? el('div.nudge', { text: extra.nudge }) : null),
      el('div.btns', {}, retryBtn, this.button(o.backLabel, '.alt', o.onBack), shareBtn, copyBtn),
      o.retryNote ? el('p', { text: o.retryNote }) : null,
      retryBtn && !this.isTouch() ? el('p.hint', { text: 'Pindutin ang R o Enter para umulit' }) : null,
    );
    this.open('end', card);
    if (o.onRetry) {
      const go = o.onRetry;
      this.setKeys((e) => {
        if (e.repeat) return;
        if (e.key === 'r' || e.key === 'R' || e.key === 'Enter') {
          e.preventDefault();
          this.cb.onUiSound();
          go();
        }
      });
    }
  }

  // --------------------------------------------------------------- libro (quests, badges, shop, records)

  private topGame = '';
  private topPeriod: 'week' | 'all' = 'week';

  showBook(tab: 'hamon' | 'badges' | 'tindahan' | 'rekord' | 'top', back: () => void): void {
    const d = this.save.data;
    const info = this.cb.bookInfo();
    const tabs: [typeof tab, string][] = [['hamon', 'Hamon'], ['top', 'Top'], ['badges', 'Badges'], ['tindahan', 'Tindahan'], ['rekord', 'Rekord']];
    const tabRow = el('div.seg.tabs', {}, ...tabs.map(([id, label]) => {
      const b = el((id === tab ? 'button.on' : 'button') as 'button', { text: label });
      onTap(b, () => {
        this.cb.onUiSound();
        this.showBook(id, back);
      });
      return b;
    }));
    const wallet = el('div.wallet', { text: `${d.barya} Barya  ·  ${d.tropaPoints} Tropa  ·  ${RANKS[rankIndex(d.tropaPoints)].name}` });
    let body: HTMLElement;

    if (tab === 'hamon') {
      body = el('div.list', {},
        el('div.item' + (info.daily.done ? '.done' : '') as 'div', {},
          el('b', { text: 'Hamon ng Araw' }),
          el('span', { text: info.daily.done ? 'Tapos na! Balik bukas.' : `${info.daily.name}: ${info.daily.target}+ puntos  ·  +${info.daily.reward} Tropa` }),
          el('small', { text: info.daily.streak > 0 ? `${info.daily.streak} araw sunod-sunod` : 'Simulan ang streak mo!' })),
        el('h3', { text: 'Gawain ngayon' }),
        ...info.quests.map((q, i) => {
          const done = d.quests.done[i];
          const prog = Math.min(q.goal, d.quests.prog[i] ?? 0);
          return el('div.item' + (done ? '.done' : '') as 'div', {},
            el('b', { text: q.text }),
            el('span.bar', {}, el('i', { attrs: { style: `width:${(prog / q.goal) * 100}%` } })),
            el('small', { text: done ? `Tapos! +${QUEST_BARYA} Barya` : `${prog}/${q.goal}  ·  +${QUEST_BARYA} Barya` }));
        }),
        el('p.hint', { text: `Tapusin lahat ng tatlo para sa bonus na ${QUEST_ALL_BONUS} Barya. Bagong gawain bawat araw.` }),
      );
    } else if (tab === 'badges') {
      const got = BADGES.filter((b) => d.badges[b.id]).length;
      body = el('div.list', {},
        el('p', { text: `${got} sa ${BADGES.length} na badge` }),
        el('div.grid', {}, ...BADGES.map((b) => el(('div.bdg' + (d.badges[b.id] ? '.got' : '')) as 'div', {},
          el('b', { text: d.badges[b.id] ? b.name : '???' }),
          el('small', { text: b.desc }),
          el('i', { text: d.badges[b.id] ? `Nakuha ${d.badges[b.id]}` : `+${b.barya} Barya` })))),
      );
    } else if (tab === 'tindahan') {
      const msg = el('p.err');
      const item = (it: (typeof SHOP)[number]) => {
        const owned = d.owned.includes(it.id);
        const equipped = it.kind === 'title' ? d.title === it.id : (() => {
          const idx = slipperChoices(d).findIndex((c) => c.name === it.name);
          return idx === d.slipper;
        })();
        const sw = it.colors
          ? el('span.swatch', { attrs: { style: `background:linear-gradient(135deg,#${it.colors[1].toString(16).padStart(6, '0')} 50%,#${it.colors[0].toString(16).padStart(6, '0')} 50%)` } })
          : el('span.tag', { text: it.name });
        const btn = owned
          ? equipped
            ? el('button.btn.small.alt', { text: 'Suot' })
            : this.button('Gamitin', '.small', () => {
                if (it.kind === 'title') d.title = it.id;
                else d.slipper = slipperChoices(d).findIndex((c) => c.name === it.name);
                this.save.persist();
                this.cb.onShop();
                this.showBook('tindahan', back);
              })
          : this.button(`${it.price}`, '.small' + (d.barya < it.price ? '.alt' : ''), () => {
              const err = buy(d, it.id);
              if (err) {
                msg.textContent = err;
                return;
              }
              if (it.kind === 'title') d.title = it.id;
              else d.slipper = slipperChoices(d).findIndex((c) => c.name === it.name);
              this.save.persist();
              this.cb.onShop();
              this.showBook('tindahan', back);
            });
        return el('div.shop-row', {}, sw, el('span', { text: it.kind === 'title' ? 'Titulo sa name tag' : it.name }), btn);
      };
      body = el('div.list', {},
        el('p.hint', { text: 'Barya: kinikita sa bawat laro, badge, gawain at karibal. Hindi bumababa ang ranggo mo kapag gumastos.' }),
        msg,
        el('h3', { text: 'Tsinelas' }),
        ...SHOP.filter((x) => x.kind === 'slipper').map(item),
        el('h3', { text: 'Titulo (makikita ng tropa sa lobby)' }),
        ...SHOP.filter((x) => x.kind === 'title').map(item),
        d.title
          ? this.button('Ranggo na lang ang ipakita', '.alt.small', () => {
              d.title = '';
              this.save.persist();
              this.cb.onShop();
              this.showBook('tindahan', back);
            })
          : null,
      );
    } else if (tab === 'top') {
      if (!info.games.some((g) => g.id === this.topGame)) this.topGame = info.games[0]?.id ?? '';
      const sel = el('select.text-in.game-sel', { attrs: { 'aria-label': 'Laro' } }) as HTMLSelectElement;
      for (const g of info.games) sel.append(el('option', { text: g.name, attrs: { value: g.id } }));
      sel.value = this.topGame;
      sel.addEventListener('change', () => {
        this.topGame = sel.value;
        this.showBook('top', back);
      });
      const period = el('div.seg', {}, ...([['week', 'Ngayong linggo'], ['all', 'Lahat ng panahon']] as const).map(([id, label]) => {
        const b = el((this.topPeriod === id ? 'button.on' : 'button') as 'button', { text: label });
        onTap(b, () => {
          this.topPeriod = id;
          this.showBook('top', back);
        });
        return b;
      }));
      const list = el('div.board', {}, el('p', { text: 'Naglo-load...' }));
      const want = `${this.topGame}:${this.topPeriod}`;
      fetchTop(this.topGame, this.topPeriod).then((rows) => {
        if (this.openKind !== 'book' || `${this.topGame}:${this.topPeriod}` !== want) return;
        if (!rows) list.replaceChildren(el('p', { text: 'Hindi ma-load ang ranking. Check ang internet mo.' }));
        else if (!rows.length) list.replaceChildren(el('p', { text: 'Wala pang score dito. Ikaw na ang mauna!' }));
        else
          list.replaceChildren(...rows.map((r, i) =>
            el((r.name === this.playerName ? 'div.brow.me' : 'div.brow') as 'div', {},
              el('b', { text: `${i + 1}` }), el('span', { text: r.name }), el('i', { text: String(r.score) }))));
      });
      body = el('div.list', {},
        el('div.top-ctl', {}, sel, period),
        list,
        el('p.hint', { text: d.settings.onlineScores
          ? `Lumalabas ka bilang "${this.playerName}". Palitan ang pangalan sa lobby menu. Pwedeng i-off sa Settings.`
          : 'Naka-off ang online ranking mo sa Settings.' }),
      );
    } else {
      body = el('div.list', {}, ...info.games.map((g) => {
        const h = d.history[g.id] ?? [];
        const st = d.stars[g.id] ?? 0;
        return el('div.item', {},
          el('b', { text: `${g.name}  ${starText(st)}` }),
          el('span', { text: h.length ? h.map((x, i) => `${i + 1}. ${x.s}`).join('   ') : 'Wala pang laro' }),
          el('small', { text: `${d.plays[g.id] ?? 0} laro  ·  ★★★ sa ${STAR_THRESHOLDS[g.id]?.[2] ?? '?'}  ·  ${info.rival(g.id)}` }));
      }));
    }

    const card = el('div.card.book', {}, el('h2', { text: 'Libro ng Barangay' }), wallet, tabRow, body, el('div.btns', {}, this.button('Balik', '', back)));
    this.open('book', card);
  }

  // --------------------------------------------------------------- multiplayer

  /** Player name for lobbies (remembered on this device). */
  get playerName(): string {
    if (!this.name) {
      try {
        this.name = localStorage.getItem(NAME_KEY) ?? '';
      } catch {
        /* ignore */
      }
      if (!this.name) this.name = 'Bata' + Math.floor(100 + Math.random() * 900);
    }
    return this.name;
  }

  set playerName(v: string) {
    this.name = sanitizeName(v);
    try {
      localStorage.setItem(NAME_KEY, this.name);
    } catch {
      /* ignore */
    }
  }

  private face: string | null | undefined = undefined;

  /** My custom face (small JPEG data URL), remembered on this device only. */
  get playerFace(): string | null {
    if (this.face === undefined) this.face = loadSavedFace();
    return this.face;
  }

  private setFace(f: string | null): void {
    this.face = f;
    saveFace(f);
    this.cb.onFace(f);
  }

  /** Tsinelas colors: unlocked by rank or bought in the Tindahan. */
  private slipperField(): HTMLElement {
    const row = el('span.swatches');
    const note = el('p.hint');
    const render = () => {
      row.replaceChildren(
        ...slipperChoices(this.save.data).map((s, i) => {
          const locked = !s.unlocked;
          const b = el(`button.swatch${i === this.save.data.slipper ? '.on' : ''}${locked ? '.locked' : ''}` as 'button', {
            attrs: { style: `background:linear-gradient(135deg,#${s.top.toString(16).padStart(6, '0')} 50%,#${s.strap.toString(16).padStart(6, '0')} 50%)`, 'aria-label': s.name, title: s.name },
          });
          onTap(b, () => {
            if (locked) {
              note.textContent = `${s.name}: ${s.need}`;
              return;
            }
            this.save.data.slipper = i;
            this.save.persist();
            this.cb.onSlipper(i);
            note.textContent = `Tsinelas: ${s.name}`;
            render();
          });
          return b;
        }),
      );
    };
    render();
    return el('div.field', {}, el('div.lbl', {}, el('span', { text: 'Tsinelas' }), row), note);
  }

  /** Pick / preview / remove a custom face picture. */
  private faceField(): HTMLElement {
    const preview = el('span.face-prev');
    const fileIn = el('input', { attrs: { type: 'file', accept: 'image/*', 'aria-label': 'Larawan ng mukha' } }) as HTMLInputElement;
    fileIn.style.display = 'none';
    const err = el('p.err');
    const remove = this.button('Alisin', '.alt.small', () => {
      this.setFace(null);
      render();
    });
    const pick = this.button('Pumili', '.alt.small', () => fileIn.click());
    const render = () => {
      const f = this.playerFace;
      preview.style.backgroundImage = f ? `url("${f}")` : '';
      preview.classList.toggle('empty', !f);
      remove.classList.toggle('hidden', !f);
      pick.textContent = f ? 'Palitan' : 'Pumili';
    };
    fileIn.addEventListener('change', async () => {
      const file = fileIn.files?.[0];
      fileIn.value = '';
      if (!file) return;
      try {
        this.setFace(await processFaceFile(file));
        err.textContent = '';
      } catch (e) {
        err.textContent = (e as Error).message;
      }
      render();
    });
    render();
    return el(
      'div.field',
      {},
      el('div.lbl', {}, el('span', { text: 'Mukha mo' }), el('span.face-ctl', {}, preview, pick, remove, fileIn)),
      el('p.hint', { text: 'Makikita ng tropa mo sa lobby. Hindi ito ina-upload sa server.' }),
      err,
    );
  }

  private nameField(): HTMLElement {
    const input = el('input.text-in', { attrs: { maxlength: '14', value: this.playerName, 'aria-label': 'Pangalan', autocomplete: 'off' } }) as HTMLInputElement;
    input.value = this.playerName;
    input.addEventListener('change', () => (this.playerName = input.value));
    input.addEventListener('blur', () => (this.playerName = input.value));
    return el('label', {}, el('span', { text: 'Pangalan mo' }), input);
  }

  /** Choice card at a game spot: solo, create a lobby, or join one. */
  showGameMenu(o: {
    name: string;
    canSolo: boolean;
    lockedMsg: string;
    inLobby: boolean;
    onSolo: () => void;
    onCreate: () => void;
    onJoin: () => void;
    onLobby: () => void;
    onClose: () => void;
  }): void {
    const card = el(
      'div.card.settings',
      {},
      el('h2', { text: o.name }),
      el('p', { text: 'Mag-isa o kasama ang tropa?' }),
      o.lockedMsg ? el('p', { text: o.lockedMsg }) : null,
      this.nameField(),
      this.faceField(),
      el(
        'div.btns.col',
        {},
        o.canSolo ? this.button('Mag-isa', '', o.onSolo) : null,
        o.inLobby ? this.button('Laruin ito sa lobby', '.alt', o.onCreate) : this.button('Gumawa ng lobby', '.alt', o.onCreate),
        o.inLobby ? null : this.button('Sumali gamit ang code', '.alt', o.onJoin),
        this.button('Isara', '.alt.small', o.onClose),
      ),
    );
    this.open('game', card);
  }

  showBusy(text: string): void {
    this.open('busy', el('div.card', {}, el('h2', { text: 'Sandali...' }), el('p', { text }), el('div.loading-bar.center', {}, el('i'))));
  }

  showMessage(text: string, onOk: () => void): void {
    this.open('busy', el('div.card', {}, el('h2.bad', { text: 'Ay!' }), el('p', { text }), el('div.btns', {}, this.button('Sige', '', onOk))));
  }

  /** Enter a 4-letter room code. onJoin resolves to an error message or null. */
  showJoin(onJoin: (code: string) => Promise<string | null>, onBack: () => void): void {
    const input = el('input.text-in.code-in', { attrs: { maxlength: '4', placeholder: 'KAPE', autocapitalize: 'characters', autocomplete: 'off', 'aria-label': 'Code' } }) as HTMLInputElement;
    const err = el('p.err');
    input.addEventListener('input', () => (input.value = cleanCode(input.value)));
    const go = async () => {
      const code = cleanCode(input.value);
      if (code.length !== 4) {
        err.textContent = 'Apat na letra ang code.';
        return;
      }
      joinBtn.disabled = true;
      joinBtn.textContent = 'Kumokonekta...';
      const msg = await onJoin(code);
      if (msg && this.openKind === 'join') {
        err.textContent = msg;
        joinBtn.disabled = false;
        joinBtn.textContent = 'Sumali';
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
    const joinBtn = this.button('Sumali', '', go);
    const card = el(
      'div.card.settings',
      {},
      el('h2', { text: 'Sumali sa lobby' }),
      el('p', { text: 'I-type ang 4 na letrang code na binigay ng tropa mo.' }),
      input,
      err,
      this.nameField(),
      this.faceField(),
      el('div.btns', {}, joinBtn, this.button('Balik', '.alt', onBack)),
    );
    this.open('join', card);
    setTimeout(() => input.focus(), 50);
  }

  /** Lobby roster with the room code. Refreshes live as people join and leave. */
  showLobby(s: Session, gameName: (id: string) => string, o: { onStart: () => void; onTour: () => void; onLeave: () => void; onClose: () => void }): void {
    const list = el('div.roster');
    const status = el('p');
    const startBtn = this.button('Simulan!', '', o.onStart);
    const code = el('div.code', { text: s.code });
    const copyBtn = this.button('Copy code', '.alt.small', async () => {
      const ok = await copyText(`Laro tayo sa Hari ng Kanto! Code: ${s.code}  ${location.origin}${location.pathname}`);
      copyBtn.textContent = ok ? 'Nakopya!' : 'Hindi ma-copy';
      setTimeout(() => (copyBtn.textContent = 'Copy code'), 1500);
    });
    const title = el('h2');
    const render = () => {
      title.textContent = `Lobby: ${gameName(s.gameId)}`;
      list.replaceChildren(
        ...s.players.map((p) =>
          el('div.row', {}, p.face
            ? el('img.face-thumb', { attrs: { src: p.face, alt: '', style: `border-color:#${p.color.toString(16).padStart(6, '0')}` } })
            : el('i', { attrs: { style: `background:#${p.color.toString(16).padStart(6, '0')}` } }),
            el('span', { text: p.name + (p.id === s.selfId ? ' (ikaw)' : '') + (p.id === s.hostId ? '  host' : '') }),
            p.sub ? el('small.sub', { text: p.sub }) : null),
        ),
      );
      status.textContent = s.isHost
        ? s.players.length < 2
          ? 'Hinihintay ang tropa... I-share ang code. (Pwede ring simulan mag-isa.)'
          : `${s.players.length} na kayo. Simulan na!`
        : 'Hinihintay na simulan ng host...';
    };
    render();
    const card = el(
      'div.card',
      {},
      title,
      el('p', { text: 'Code ng lobby' }),
      code,
      el('div.btns', {}, copyBtn),
      list,
      status,
      this.faceField(),
      el('div.btns', {}, s.isHost ? startBtn : null, s.isHost ? this.button('Torneo (3 laro)', '.alt', o.onTour) : null),
      s.isHost ? el('p.hint', { text: 'Torneo: 3 random na laro, sunod-sunod. Puntos ayon sa puwesto: 5, 3, 2, 1.' }) : null,
      el('div.btns', {}, this.button('Isara', '.alt', o.onClose), this.button('Umalis sa lobby', '.danger.small', o.onLeave)),
    );
    this.open('lobby', card);
    this.lobbyRefresh = render;
  }

  refreshLobby(): void {
    this.lobbyRefresh?.();
  }
}
