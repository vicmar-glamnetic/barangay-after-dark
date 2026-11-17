import type { SaveStore, Settings } from '../core/save';
import type { GameResult } from '../games/types';
import { cleanCode, sanitizeName, type Session } from '../net/session';
import { device } from '../core/device';
import { loadSavedFace, processFaceFile, saveFace } from '../net/face';
import { RANKS, STAR_THRESHOLDS, rankIndex, starText } from '../core/progression';
import { BADGES, QUEST_ALL_BONUS, QUEST_BARYA, SHOP, TREAT_MULT, buy, itemName, slipperChoices, type Quest, type ShopItem } from '../core/meta';
import { L, getLang, setLang } from '../core/i18n';
import { copyText, el, onTap } from './dom';
import { shareResultImage } from './shareCard';
import { fetchTop } from '../net/leaderboard';

type Kind = 'none' | 'pause' | 'settings' | 'end' | 'game' | 'join' | 'lobby' | 'busy' | 'book' | 'store';

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
  /** An item was just bought (sound, badge check). */
  onPurchase?: (it: ShopItem) => void;
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
  private tagline = el('div.tagline');

  /** Filipino / English switch. onChange re-renders whatever is on screen. */
  private langSwitch(onChange: () => void): HTMLElement {
    const wrap = el('div.seg.lang-switch');
    const btns = (['fil', 'en'] as const).map((l) => {
      const b = el((getLang() === l ? 'button.on' : 'button') as 'button', { text: l === 'fil' ? 'Filipino' : 'English' });
      onTap(b, () => {
        setLang(l);
        btns.forEach((x, i) => x.classList.toggle('on', (['fil', 'en'] as const)[i] === l));
        this.cb.onUiSound();
        onChange();
      });
      return b;
    });
    wrap.append(...btns);
    return wrap;
  }
  private name = '';

  constructor(private parent: HTMLElement, private save: SaveStore, private cb: MenuCallbacks, private isTouch: () => boolean) {
    this.titleBtn = el('button.btn.start-btn', { text: L('Naglo-load...', 'Loading...') });
    this.titleBtn.disabled = true;
    this.titleMeta = el('div.meta');
    const loading = el('div.loading-bar', {}, el('i'));
    this.title = el(
      'div.title.interactive',
      {},
      el('div.logo', {}, el('div.crown', { text: '♛' }), el('div.l1', { text: 'Hari ng' }), el('div.l2', { text: 'KANTO' })),
      this.tagline,
      loading,
      this.titleBtn,
      this.titleMeta,
      this.langSwitch(() => this.refreshTitle()),
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
    if (!this.titleBtn.disabled) this.titleBtn.textContent = this.isTouch() ? L('I-tap para magsimula', 'Tap to start') : L('I-click para magsimula', 'Click to start');
    this.tagline.textContent = L('Laro ng Lahi sa ilalim ng buwan', 'Classic Filipino street games under the moon');
    const pts = this.save.data.tropaPoints;
    this.titleMeta.textContent = pts > 0
      ? `★ ${pts} Tropa Points  ·  ${RANKS[rankIndex(pts)].name}${this.save.data.streak > 1 ? `  ·  ${L(`${this.save.data.streak} araw sunod-sunod`, `${this.save.data.streak}-day streak`)}` : ''}`
      : L('Maglakad-lakad. Hanapin ang mga bata. Laro tayo!', "Walk around the barangay. Find the kids. Let's play!");
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
      ? L(
          '<b>Kaliwa:</b> joystick para lumakad (itulak nang todo para tumakbo)<br><b>Kanan:</b> i-drag para tumingin<br><b>Laro!</b> para makipaglaro, <b>Bato/Sipa</b> para sa aksyon',
          '<b>Left side:</b> joystick to walk (push all the way to run)<br><b>Right side:</b> drag to look around<br><b>Play!</b> to join a game, <b>Throw/Kick</b> for the action',
        )
      : L(
          '<b>WASD</b> lakad, <b>Shift</b> takbo, <b>Space</b> talon<br><b>Mouse</b> tingin, <b>Left click</b> bato o sipa<br><b>E</b> makipaglaro, <b>Esc</b> pause',
          '<b>WASD</b> walk, <b>Shift</b> run, <b>Space</b> jump<br><b>Mouse</b> look, <b>Left click</b> throw or kick<br><b>E</b> talk / play, <b>Esc</b> pause',
        );
    const card = el(
      'div.card',
      {},
      el('h2', { text: L('Pahinga muna', 'Paused') }),
      el('p', { text: inGame ? L('Naka-pause ang laro.', 'The game is paused.') : L('Nasa barangay ka.', "You're out in the barangay.") }),
      el(
        'div.btns',
        {},
        this.button(L('Tuloy', 'Resume'), '', () => this.cb.onResume()),
        this.button(L('Libro ng Barangay', 'Barangay Book'), '.alt', () => this.showBook('hamon', () => this.showPause(inGame, net))),
        this.button('Settings', '.alt', () => this.showSettings(() => this.showPause(inGame, net))),
        inGame ? this.button(net?.inNetGame ? L('Umalis sa laro', 'Leave game') : L('Balik sa barangay', 'Back to the barangay'), '.alt', () => this.cb.onQuitGame()) : null,
        !inGame && net && !net.inLobby ? this.button(L('Sumali sa lobby', 'Join a lobby'), '.alt', net.onJoin) : null,
        !inGame && net?.inLobby ? this.button('Lobby', '.alt', net.onLobby) : null,
      ),
      net?.inNetGame ? el('p', { text: L('Tuloy pa rin ang laro habang naka-pause.', 'Multiplayer games keep running while you are paused.') }) : null,
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
    const reset = this.button(L('Burahin ang progress', 'Erase progress'), '.danger.small', () => {
      if (!resetArmed) {
        resetArmed = true;
        reset.textContent = L('Sigurado ka? Pindot ulit', 'Are you sure? Tap again');
        return;
      }
      this.cb.onResetProgress();
      reset.textContent = L('Nabura na', 'Erased');
      reset.disabled = true;
    });

    const card = el(
      'div.card.settings',
      {},
      el('h2', { text: 'Settings' }),
      el('label', {}, el('span', { text: L('Wika', 'Language') }), this.langSwitch(() => this.showSettings(back))),
      el('label', {}, el('span', {}, document.createTextNode('Sensitivity '), sensVal), sens),
      el('label', {}, el('span', { text: 'Invert Y' }), seg([
        ['Off', () => !s.invertY, () => (s.invertY = false)],
        ['On', () => s.invertY, () => (s.invertY = true)],
      ])),
      el('label', {}, el('span', { text: 'Quality' }), seg([
        ['Low', () => s.quality === 'low', () => (s.quality = 'low')],
        ['High', () => s.quality === 'high', () => (s.quality = 'high')],
      ])),
      device.isMobile ? null : el('label', {}, el('span', { text: L('Glow (mabigat sa GPU)', 'Glow (heavy on the GPU)') }), seg([
        ['Off', () => !s.glow, () => (s.glow = false)],
        ['On', () => s.glow, () => (s.glow = true)],
      ])),
      el('label', {}, el('span', { text: 'Auto FPS' }), seg([
        ['Off', () => !s.autoFps, () => (s.autoFps = false)],
        ['On', () => s.autoFps, () => (s.autoFps = true)],
      ])),
      el('label', {}, el('span', { text: L('Ipakita ang FPS', 'Show FPS') }), seg([
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
      el('div.btns', {}, this.button(L('Balik', 'Back'), '', back), reset),
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
      const ok = await copyText(`${r.shareText} ${L('Kaya mo bang talunin?', 'Think you can beat that?')} ${location.origin}${location.pathname}`);
      copyBtn.textContent = ok ? L('Nakopya na!', 'Copied!') : L('Hindi ma-copy', "Couldn't copy");
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1600);
    });
    const shareBtn = this.button(L('I-share', 'Share'), '.alt', async () => {
      shareBtn.textContent = L('Sandali...', 'One moment...');
      const res = await shareResultImage({
        game: r.gameName, score: r.score, label: r.scoreLabel, stars: extra.stars ?? 0, name: this.playerName,
        rank: extra.rank ?? '', line: extra.isBest ? L('Bagong best score!', 'New best score!') : extra.badges?.[0] ? `Badge: ${extra.badges[0].replace(/ \(.*$/, '')}` : '',
        text: `${r.shareText} ${L('Kaya mo bang talunin?', 'Think you can beat that?')}`, url: `${location.origin}${location.pathname}`, face: this.playerFace,
      });
      shareBtn.textContent = res === 'shared' ? L('Na-share!', 'Shared!') : res === 'saved' ? L('Na-save ang larawan!', 'Image saved!') : L('Hindi ma-share', "Couldn't share");
      setTimeout(() => (shareBtn.textContent = L('I-share', 'Share')), 2000);
    });
    // best line: show the jump when you beat your old best
    const bestLine = extra.isBest
      ? extra.prevBest !== undefined
        ? L(`Bagong best! ${extra.prevBest} → ${r.score}`, `New best! ${extra.prevBest} → ${r.score}`)
        : L('Unang score mo dito!', 'Your first score here!')
      : `Best: ${extra.best}`;
    const retryBtn = o.onRetry ? this.button(o.retryLabel ?? L('Ulit!', 'Again!'), '', o.onRetry) : null;
    const card = el(
      'div.card.end',
      {},
      // endless games rarely "win": earning stars still deserves praise
      el(`h2.${r.won || (extra.stars ?? 0) >= 1 ? 'good' : 'bad'}` as 'h2', { text: r.won ? L('Panalo!', 'You win!') : (extra.stars ?? 0) >= 1 ? L('Ayos!', 'Nice!') : L('Talo ka!', 'You lost!') }),
      el('p', { text: r.gameName }),
      el('div.score', { text: String(r.score) }),
      el('p', { text: r.scoreLabel }),
      extra.stars !== undefined
        ? el((extra.newStars ? 'div.stars.new' : 'div.stars') as 'div', {}, ...[0, 1, 2].map((i) => el((i < (extra.stars ?? 0) ? 'span.on' : 'span') as 'span', { text: '★', attrs: { style: `animation-delay:${0.25 + i * 0.22}s` } })))
        : null,
      el((extra.isBest ? 'div.best.up' : 'div.best') as 'div', { text: bestLine + (extra.recordRank && !extra.isBest && extra.recordRank <= 3 ? L(`  ·  #${extra.recordRank} sa rekord mo`, `  ·  #${extra.recordRank} in your records`) : '') }),
      extra.rankMsg ? el('div.badge.rankup', { text: extra.rankMsg }) : null,
      ...(extra.badges ?? []).map((b) => el('div.badge.ach', { text: `${L('Bagong Badge', 'New Badge')}: ${b}` })),
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
      retryBtn && !this.isTouch() ? el('p.hint', { text: L('Pindutin ang R o Enter para umulit', 'Press R or Enter to play again') }) : null,
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

  // --------------------------------------------------------------- tindahan (the sari-sari store counter)

  private storeTab: 'treat' | 'slipper' | 'title' = 'treat';
  private storeNote = '';

  showStore(back: () => void, greet = true): void {
    const d = this.save.data;
    const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
    const slipperIndex = (it: ShopItem) => slipperChoices(d).findIndex((c) => c.id === it.id);
    const after = (note: string) => {
      this.save.persist();
      this.cb.onShop();
      this.storeNote = note;
      this.showStore(back, false);
    };
    const coin = (n: number | string) => el('span.coin-amt', {}, el('i.coin'), document.createTextNode(String(n)));

    // ---- one item card
    const card = (it: ShopItem) => {
      const owned = it.kind !== 'treat' && d.owned.includes(it.id);
      const equipped = it.kind === 'title' ? d.title === it.id : it.kind === 'slipper' && slipperIndex(it) === d.slipper;
      const short = d.barya < it.price;
      const art = it.colors
        ? el('span.art.slip', { attrs: { style: `background:linear-gradient(135deg,${hex(it.colors[1])} 50%,${hex(it.colors[0])} 50%)` } })
        : it.tint !== undefined
          ? el('span.art.cup', {}, el('i', { attrs: { style: `background:${hex(it.tint)}` } }))
          : el('span.art.tagprev', {}, el('b', { text: this.playerName }), el('small', { text: it.name }));
      // only drinks need a line of their own (what they do); the tab hint covers the rest
      const sub = it.kind === 'treat'
        ? L(`x${TREAT_MULT} Tropa Points sa ${it.games} laro`, `x${TREAT_MULT} Tropa Points for ${it.games} game${it.games === 1 ? '' : 's'}`)
        : '';

      let btn: HTMLElement;
      if (equipped) btn = el('button.btn.small.price.on', { text: L('Suot ✓', 'Wearing ✓') });
      else if (owned)
        btn = this.button(L('Gamitin', 'Use'), '.small.price.use', () => {
          if (it.kind === 'title') d.title = it.id;
          else d.slipper = slipperIndex(it);
          after(L(`Suot mo na ang ${itemName(it)}.`, `Now using ${itemName(it)}.`));
        });
      else if (short) {
        btn = el('button.btn.small.price.short', {}, el('small', { text: L(`Kulang ${it.price - d.barya}`, `Need ${it.price - d.barya} more`) }));
        (btn as HTMLButtonElement).disabled = true;
      } else {
        // two taps to buy: the first one asks "Sure?"
        let armed = false;
        btn = this.button('', '.small.price.buy', () => {
          if (!armed) {
            armed = true;
            btn.replaceChildren(document.createTextNode(L('Bilhin?', 'Buy?')));
            btn.classList.add('armed');
            window.setTimeout(() => {
              if (!btn.isConnected) return;
              armed = false;
              btn.classList.remove('armed');
              btn.replaceChildren(coin(it.price));
            }, 2500);
            return;
          }
          const err = buy(d, it.id);
          if (err) {
            this.storeNote = err;
            this.showStore(back, false);
            return;
          }
          if (it.kind === 'title') d.title = it.id;
          else if (it.kind === 'slipper') d.slipper = slipperIndex(it);
          this.cb.onPurchase?.(it);
          after(it.kind === 'treat'
            ? L(`Salamat! Boost para sa susunod na ${d.boost} laro.`, `Enjoy! Boost active for your next ${d.boost} game${d.boost === 1 ? '' : 's'}.`)
            : L(`Nabili mo ang ${itemName(it)}! Suot mo na.`, `You bought ${itemName(it)}! It's on.`));
        });
        btn.replaceChildren(coin(it.price));
      }
      return el((equipped ? 'div.item-card.on' : 'div.item-card') as 'div', {}, art, it.kind === 'title' ? null : el('b', { text: itemName(it) }), sub ? el('small', { text: sub }) : null, btn);
    };

    // ---- header: who's talking, wallet, close
    const lines = [
      L('Ano sa iyo, iho/iha?', 'What can I get you, dear?'),
      L('Bili na, bili na! Bagong dating ang tsinelas!', 'Come, come! New flip-flops just arrived!'),
      L('Pampalamig muna bago maglaro!', 'Something cold before you play?'),
    ];
    const say = this.storeNote || (greet ? lines[Math.floor(Math.random() * lines.length)] : L('Salamat! Balik ka ha.', 'Thank you! Come back soon.'));
    this.storeNote = '';
    const close = el('button.icon-btn.close', { text: '✕', attrs: { 'aria-label': L('Isara', 'Close') } });
    onTap(close, () => {
      this.cb.onUiSound();
      back();
    });
    const tabs: [typeof this.storeTab, string][] = [
      ['treat', L('Pampalamig', 'Drinks')],
      ['slipper', L('Tsinelas', 'Flip-flops')],
      ['title', L('Titulo', 'Titles')],
    ];
    const tabRow = el('div.seg.tabs', {}, ...tabs.map(([id, label]) => {
      const b = el((id === this.storeTab ? 'button.on' : 'button') as 'button', { text: label });
      onTap(b, () => {
        this.cb.onUiSound();
        this.storeTab = id;
        this.showStore(back, false);
      });
      return b;
    }));
    const head = el('div.store-head', {},
      el('div.store-top', {}, el('h2', { text: L('Sari-sari Store', 'Sari-sari Store') }), close),
      el('p.tindera', { text: `Aling Nena: "${say}"` }),
      el('div.wallet-row', {},
        el('span.wallet-pill', {}, el('i.coin'), document.createTextNode(`${d.barya} Barya`)),
        d.boost > 0 ? el('span.wallet-pill.boost', { text: L(`Boost: ${d.boost} laro pa`, `Boost: ${d.boost} game${d.boost === 1 ? '' : 's'} left`) }) : null),
      tabRow,
    );

    const help: Record<typeof this.storeTab, string> = {
      treat: L(`Dagdag x${TREAT_MULT} Tropa Points sa susunod mong mga laro. Nagsasama-sama ang boost.`, `Earn x${TREAT_MULT} Tropa Points in your next games. Boosts stack up.`),
      slipper: L('Makikita sa kamay mo at sa ibinabato mong tsinelas. May iba pang kulay na nakukuha sa ranggo (Settings).', 'Shows in your hand and on every throw. More colors unlock with your rank (in Settings).'),
      title: L('Makikita ng tropa mo sa ilalim ng pangalan mo sa lobby.', 'Your friends see it under your name in multiplayer.'),
    };
    const items = SHOP.filter((x) => x.kind === this.storeTab);
    const body = el('div.store-body', {},
      el('p.hint', { text: help[this.storeTab] }),
      el('div.store-grid', {}, ...items.map(card)),
      this.storeTab === 'title' && d.title
        ? this.button(L('Ranggo na lang ang ipakita', 'Show my rank instead'), '.alt.small', () => {
            d.title = '';
            after(L('Ranggo mo na ang ipinapakita.', 'Showing your rank again.'));
          })
        : null,
      el('p.hint', { text: L('Barya: kinikita sa bawat laro, badge, gawain at karibal. Hindi bumababa ang ranggo mo kapag gumastos.', 'Barya (coins) come from games, badges, quests and rivals. Spending never lowers your rank.') }),
    );
    this.open('store', el('div.card.store', {}, head, body));
    this.setKeys((e) => {
      if (e.key === 'Escape') back();
    });
  }

  // --------------------------------------------------------------- libro (quests, badges, records)

  private topGame = '';
  private topPeriod: 'week' | 'all' = 'week';

  showBook(tab: 'hamon' | 'badges' | 'rekord' | 'top', back: () => void): void {
    const d = this.save.data;
    const info = this.cb.bookInfo();
    const tabs: [typeof tab, string][] = [['hamon', L('Hamon', 'Today')], ['top', 'Top'], ['badges', 'Badges'], ['rekord', L('Rekord', 'Records')]];
    const tabRow = el('div.seg.tabs', {}, ...tabs.map(([id, label]) => {
      const b = el((id === tab ? 'button.on' : 'button') as 'button', { text: label });
      onTap(b, () => {
        this.cb.onUiSound();
        this.showBook(id, back);
      });
      return b;
    }));
    const wallet = el('div.wallet', { text: `${d.barya} Barya  ·  ${d.tropaPoints} Tropa Points  ·  ${RANKS[rankIndex(d.tropaPoints)].name}` });
    let body: HTMLElement;

    if (tab === 'hamon') {
      body = el('div.list', {},
        el('div.item' + (info.daily.done ? '.done' : '') as 'div', {},
          el('b', { text: L('Hamon ng Araw', 'Daily Challenge') }),
          el('span', { text: info.daily.done ? L('Tapos na! Balik bukas.', 'Done! Come back tomorrow.') : L(`${info.daily.name}: ${info.daily.target}+ puntos  ·  +${info.daily.reward} Tropa Points`, `${info.daily.name}: score ${info.daily.target}+  ·  +${info.daily.reward} Tropa Points`) }),
          el('small', { text: info.daily.streak > 0 ? L(`${info.daily.streak} araw sunod-sunod`, `${info.daily.streak}-day streak`) : L('Simulan ang streak mo!', 'Start your streak today!') })),
        el('h3', { text: L('Gawain ngayon', "Today's quests") }),
        ...info.quests.map((q, i) => {
          const done = d.quests.done[i];
          const prog = Math.min(q.goal, d.quests.prog[i] ?? 0);
          return el('div.item' + (done ? '.done' : '') as 'div', {},
            el('b', { text: q.text }),
            el('span.bar', {}, el('i', { attrs: { style: `width:${(prog / q.goal) * 100}%` } })),
            el('small', { text: done ? L(`Tapos! +${QUEST_BARYA} Barya`, `Done! +${QUEST_BARYA} Barya`) : `${prog}/${q.goal}  ·  +${QUEST_BARYA} Barya` }));
        }),
        el('p.hint', { text: L(`Tapusin lahat ng tatlo para sa bonus na ${QUEST_ALL_BONUS} Barya. Bagong gawain bawat araw.`, `Finish all three for a ${QUEST_ALL_BONUS} Barya bonus. New quests every day.`) }),
      );
    } else if (tab === 'badges') {
      const got = BADGES.filter((b) => d.badges[b.id]).length;
      body = el('div.list', {},
        el('p', { text: L(`${got} sa ${BADGES.length} na badge`, `${got} of ${BADGES.length} badges`) }),
        el('div.grid', {}, ...BADGES.map((b) => el(('div.bdg' + (d.badges[b.id] ? '.got' : '')) as 'div', {},
          el('b', { text: d.badges[b.id] ? b.name : '???' }),
          el('small', { text: b.desc }),
          el('i', { text: d.badges[b.id] ? L(`Nakuha ${d.badges[b.id]}`, `Earned ${d.badges[b.id]}`) : `+${b.barya} Barya` })))),
      );
    } else if (tab === 'top') {
      if (!info.games.some((g) => g.id === this.topGame)) this.topGame = info.games[0]?.id ?? '';
      const sel = el('select.text-in.game-sel', { attrs: { 'aria-label': L('Laro', 'Game') } }) as HTMLSelectElement;
      for (const g of info.games) sel.append(el('option', { text: g.name, attrs: { value: g.id } }));
      sel.value = this.topGame;
      sel.addEventListener('change', () => {
        this.topGame = sel.value;
        this.showBook('top', back);
      });
      const period = el('div.seg', {}, ...([['week', L('Ngayong linggo', 'This week')], ['all', L('Lahat ng panahon', 'All time')]] as const).map(([id, label]) => {
        const b = el((this.topPeriod === id ? 'button.on' : 'button') as 'button', { text: label });
        onTap(b, () => {
          this.topPeriod = id;
          this.showBook('top', back);
        });
        return b;
      }));
      const list = el('div.board', {}, el('p', { text: L('Naglo-load...', 'Loading...') }));
      const want = `${this.topGame}:${this.topPeriod}`;
      fetchTop(this.topGame, this.topPeriod).then((rows) => {
        if (this.openKind !== 'book' || `${this.topGame}:${this.topPeriod}` !== want) return;
        if (!rows) list.replaceChildren(el('p', { text: L('Hindi ma-load ang ranking. Check ang internet mo.', "Couldn't load the rankings. Check your connection.") }));
        else if (!rows.length) list.replaceChildren(el('p', { text: L('Wala pang score dito. Ikaw na ang mauna!', 'No scores yet. Be the first!') }));
        else
          list.replaceChildren(...rows.map((r, i) =>
            el((r.name === this.playerName ? 'div.brow.me' : 'div.brow') as 'div', {},
              el('b', { text: `${i + 1}` }), el('span', { text: r.name }), el('i', { text: String(r.score) }))));
      });
      body = el('div.list', {},
        el('div.top-ctl', {}, sel, period),
        list,
        el('p.hint', { text: d.settings.onlineScores
          ? L(`Lumalabas ka bilang "${this.playerName}". Palitan ang pangalan sa lobby menu. Pwedeng i-off sa Settings.`, `You show up as "${this.playerName}". Change your name in any game menu, or turn this off in Settings.`)
          : L('Naka-off ang online ranking mo sa Settings.', 'Your online ranking is turned off in Settings.') }),
      );
    } else {
      body = el('div.list', {}, ...info.games.map((g) => {
        const h = d.history[g.id] ?? [];
        const st = d.stars[g.id] ?? 0;
        return el('div.item', {},
          el('b', { text: `${g.name}  ${starText(st)}` }),
          el('span', { text: h.length ? h.map((x, i) => `${i + 1}. ${x.s}`).join('   ') : L('Wala pang laro', 'Not played yet') }),
          el('small', { text: L(`${d.plays[g.id] ?? 0} laro  ·  ★★★ sa ${STAR_THRESHOLDS[g.id]?.[2] ?? '?'}`, `${d.plays[g.id] ?? 0} plays  ·  ★★★ at ${STAR_THRESHOLDS[g.id]?.[2] ?? '?'}`) + `  ·  ${info.rival(g.id)}` }));
      }));
    }

    const card = el('div.card.book', {}, el('h2', { text: L('Libro ng Barangay', 'Barangay Book') }), wallet, tabRow, body, el('div.btns', {}, this.button(L('Balik', 'Back'), '', back)));
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
            note.textContent = `${L('Tsinelas', 'Flip-flops')}: ${s.name}`;
            render();
          });
          return b;
        }),
      );
    };
    render();
    return el('div.field', {}, el('div.lbl', {}, el('span', { text: L('Tsinelas', 'Flip-flops') }), row), note);
  }

  /** Pick / preview / remove a custom face picture. */
  private faceField(): HTMLElement {
    const preview = el('span.face-prev');
    const fileIn = el('input', { attrs: { type: 'file', accept: 'image/*', 'aria-label': L('Larawan ng mukha', 'Face picture') } }) as HTMLInputElement;
    fileIn.style.display = 'none';
    const err = el('p.err');
    const remove = this.button(L('Alisin', 'Remove'), '.alt.small', () => {
      this.setFace(null);
      render();
    });
    const pick = this.button(L('Pumili', 'Choose'), '.alt.small', () => fileIn.click());
    const render = () => {
      const f = this.playerFace;
      preview.style.backgroundImage = f ? `url("${f}")` : '';
      preview.classList.toggle('empty', !f);
      remove.classList.toggle('hidden', !f);
      pick.textContent = f ? L('Palitan', 'Change') : L('Pumili', 'Choose');
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
      el('div.lbl', {}, el('span', { text: L('Mukha mo', 'Your face') }), el('span.face-ctl', {}, preview, pick, remove, fileIn)),
      el('p.hint', { text: L('Makikita ng tropa mo sa lobby. Hindi ito ina-upload sa server.', 'Your friends see it in the lobby. It is never uploaded to a server.') }),
      err,
    );
  }

  private nameField(): HTMLElement {
    const input = el('input.text-in', { attrs: { maxlength: '14', value: this.playerName, 'aria-label': L('Pangalan', 'Name'), autocomplete: 'off' } }) as HTMLInputElement;
    input.value = this.playerName;
    input.addEventListener('change', () => (this.playerName = input.value));
    input.addEventListener('blur', () => (this.playerName = input.value));
    return el('label', {}, el('span', { text: L('Pangalan mo', 'Your name') }), input);
  }

  /** Choice card at a game spot: solo, create a lobby, or join one. */
  showGameMenu(o: {
    name: string;
    blurb: string;
    howTo: string[];
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
      el('p.blurb', { text: o.blurb }),
      el('details.howto', {}, el('summary', { text: L('Paano laruin?', 'How to play') }), el('ol', {}, ...o.howTo.map((x) => el('li', { text: x })))),
      el('p', { text: L('Mag-isa o kasama ang tropa?', 'Play solo or with friends?') }),
      o.lockedMsg ? el('p', { text: o.lockedMsg }) : null,
      this.nameField(),
      this.faceField(),
      el(
        'div.btns.col',
        {},
        o.canSolo ? this.button(L('Mag-isa', 'Play solo'), '', o.onSolo) : null,
        o.inLobby ? this.button(L('Laruin ito sa lobby', 'Play this in the lobby'), '.alt', o.onCreate) : this.button(L('Gumawa ng lobby', 'Create a lobby'), '.alt', o.onCreate),
        o.inLobby ? null : this.button(L('Sumali gamit ang code', 'Join with a code'), '.alt', o.onJoin),
        this.button(L('Isara', 'Close'), '.alt.small', o.onClose),
      ),
    );
    this.open('game', card);
  }

  showBusy(text: string): void {
    this.open('busy', el('div.card', {}, el('h2', { text: L('Sandali...', 'One moment...') }), el('p', { text }), el('div.loading-bar.center', {}, el('i'))));
  }

  showMessage(text: string, onOk: () => void): void {
    this.open('busy', el('div.card', {}, el('h2.bad', { text: 'Ay!' }), el('p', { text }), el('div.btns', {}, this.button(L('Sige', 'OK'), '', onOk))));
  }

  /** Enter a 4-letter room code. onJoin resolves to an error message or null. */
  showJoin(onJoin: (code: string) => Promise<string | null>, onBack: () => void): void {
    const input = el('input.text-in.code-in', { attrs: { maxlength: '4', placeholder: 'KAPE', autocapitalize: 'characters', autocomplete: 'off', 'aria-label': 'Code' } }) as HTMLInputElement;
    const err = el('p.err');
    input.addEventListener('input', () => (input.value = cleanCode(input.value)));
    const go = async () => {
      const code = cleanCode(input.value);
      if (code.length !== 4) {
        err.textContent = L('Apat na letra ang code.', 'The code has 4 letters.');
        return;
      }
      joinBtn.disabled = true;
      joinBtn.textContent = L('Kumokonekta...', 'Connecting...');
      const msg = await onJoin(code);
      if (msg && this.openKind === 'join') {
        err.textContent = msg;
        joinBtn.disabled = false;
        joinBtn.textContent = L('Sumali', 'Join');
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
    const joinBtn = this.button(L('Sumali', 'Join'), '', go);
    const card = el(
      'div.card.settings',
      {},
      el('h2', { text: L('Sumali sa lobby', 'Join a lobby') }),
      el('p', { text: L('I-type ang 4 na letrang code na binigay ng tropa mo.', 'Type the 4-letter code your friend gave you.') }),
      input,
      err,
      this.nameField(),
      this.faceField(),
      el('div.btns', {}, joinBtn, this.button(L('Balik', 'Back'), '.alt', onBack)),
    );
    this.open('join', card);
    setTimeout(() => input.focus(), 50);
  }

  /** Lobby roster with the room code. Refreshes live as people join and leave. */
  showLobby(s: Session, gameName: (id: string) => string, o: { onStart: () => void; onTour: () => void; onLeave: () => void; onClose: () => void }): void {
    const list = el('div.roster');
    const status = el('p');
    const startBtn = this.button(L('Simulan!', 'Start!'), '', o.onStart);
    const code = el('div.code', { text: s.code });
    const copyBtn = this.button('Copy code', '.alt.small', async () => {
      const ok = await copyText(L(`Laro tayo sa Hari ng Kanto! Code: ${s.code}  ${location.origin}${location.pathname}`, `Come play Hari ng Kanto with me! Code: ${s.code}  ${location.origin}${location.pathname}`));
      copyBtn.textContent = ok ? L('Nakopya!', 'Copied!') : L('Hindi ma-copy', "Couldn't copy");
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
            el('span', { text: p.name + (p.id === s.selfId ? L(' (ikaw)', ' (you)') : '') + (p.id === s.hostId ? '  host' : '') }),
            p.sub ? el('small.sub', { text: p.sub }) : null),
        ),
      );
      status.textContent = s.isHost
        ? s.players.length < 2
          ? L('Hinihintay ang tropa... I-share ang code. (Pwede ring simulan mag-isa.)', 'Waiting for friends... Share the code. (You can also start alone.)')
          : L(`${s.players.length} na kayo. Simulan na!`, `${s.players.length} players. Let's go!`)
        : L('Hinihintay na simulan ng host...', 'Waiting for the host to start...');
    };
    render();
    const card = el(
      'div.card',
      {},
      title,
      el('p', { text: L('Code ng lobby', 'Lobby code') }),
      code,
      el('div.btns', {}, copyBtn),
      list,
      status,
      this.faceField(),
      el('div.btns', {}, s.isHost ? startBtn : null, s.isHost ? this.button(L('Torneo (3 laro)', 'Tournament (3 games)'), '.alt', o.onTour) : null),
      s.isHost ? el('p.hint', { text: L('Torneo: 3 random na laro, sunod-sunod. Puntos ayon sa puwesto: 5, 3, 2, 1.', 'Tournament: 3 random games in a row. Points by placing: 5, 3, 2, 1.') }) : null,
      el('div.btns', {}, this.button(L('Isara', 'Close'), '.alt', o.onClose), this.button(L('Umalis sa lobby', 'Leave lobby'), '.danger.small', o.onLeave)),
    );
    this.open('lobby', card);
    this.lobbyRefresh = render;
  }

  refreshLobby(): void {
    this.lobbyRefresh?.();
  }
}
