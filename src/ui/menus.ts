import type { SaveStore, Settings } from '../core/save';
import type { GameResult } from '../games/types';
import { copyText, el, onTap } from './dom';

export interface MenuCallbacks {
  onStart: () => void;
  onResume: () => void;
  onQuitGame: () => void;
  onSettings: (s: Settings) => void;
  onResetProgress: () => void;
  onUiSound: () => void;
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
  private openKind: 'none' | 'pause' | 'settings' | 'end' = 'none';

  constructor(private parent: HTMLElement, private save: SaveStore, private cb: MenuCallbacks, private isTouch: () => boolean) {
    this.titleBtn = el('button.btn.start-btn', { text: 'Naglo-load...' });
    this.titleBtn.disabled = true;
    this.titleMeta = el('div.meta');
    const loading = el('div.loading-bar', {}, el('i'));
    this.title = el(
      'div.title.interactive',
      {},
      el('div.logo', {}, el('div.l1', { text: 'Barangay' }), el('div.l2', { text: 'AFTER DARK' })),
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
    this.titleMeta.textContent = pts > 0 ? `★ ${pts} Tropa Points` : 'Walk around. Find the kids. Laro tayo!';
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
    this.openKind = 'none';
    this.layer.classList.add('hidden');
    this.layer.replaceChildren();
  }

  private open(kind: 'pause' | 'settings' | 'end', card: HTMLElement): void {
    this.openKind = kind;
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

  showPause(inGame: boolean): void {
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
        this.button('Settings', '.alt', () => this.showSettings(() => this.showPause(inGame))),
        inGame ? this.button('Balik sa barangay', '.alt', () => this.cb.onQuitGame()) : null,
      ),
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
      el('label', {}, el('span', { text: 'Volume' }), vol),
      el('div.btns', {}, this.button('Balik', '', back), reset),
    );
    this.open('settings', card);
  }

  // --------------------------------------------------------------- end card

  showEnd(r: GameResult, extra: { best: number; isBest: boolean; unlocked?: string }, onRetry: () => void, onBack: () => void): void {
    const copyBtn = this.button('Copy score', '.alt', async () => {
      const ok = await copyText(r.shareText);
      copyBtn.textContent = ok ? 'Nakopya na!' : 'Hindi ma-copy';
      setTimeout(() => (copyBtn.textContent = 'Copy score'), 1600);
    });
    const card = el(
      'div.card',
      {},
      el(`h2.${r.won ? 'good' : 'bad'}` as 'h2', { text: r.won ? 'Panalo!' : 'Talo ka!' }),
      el('p', { text: r.gameName }),
      el('div.score', { text: String(r.score) }),
      el('p', { text: r.scoreLabel }),
      el('div.lines', {}, ...r.lines.map((l) => el('div', { text: l })),
        el('div', { text: `+${r.points} Tropa Points` }),
        el('div', { text: extra.isBest ? 'Bagong best score!' : `Best: ${extra.best}` }),
        extra.unlocked ? el('div', { text: `Na-unlock: ${extra.unlocked}!` }) : null),
      el('div.btns', {}, this.button('Ulit?', '', onRetry), this.button('Balik sa barangay', '.alt', onBack), copyBtn),
    );
    this.open('end', card);
  }
}
