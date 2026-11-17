import { L } from '../core/i18n';
import { el } from './dom';

/**
 * Full-screen overlays:
 * - "rotate your phone" (CSS-driven: shows on touch devices in portrait)
 * - a black fade with text, used for transitions and Taguan's counting
 */
export class Overlays {
  private fadeEl = el('div.fade');
  private blindEl = el('div.blind');
  private shoutEl = el('div.shout');
  private shoutT = 0;
  readonly rotate = el(
    'div.rotate',
    {},
    el('div.phone'),
    el('h3', { text: L('Ikot mo ang phone mo', 'Turn your phone sideways') }),
    el('p', { text: L('Mas masaya maglaro nang naka-landscape.', 'The game plays best in landscape.') }),
  );

  constructor(parent: HTMLElement) {
    parent.prepend(this.blindEl, this.shoutEl); // under the HUD and menus
    parent.append(this.fadeEl, this.rotate);
  }

  /** Pukpok Palayok blindfold (the screen goes almost black). */
  blind(on: boolean): void {
    this.blindEl.classList.toggle('on', on);
    if (!on) this.shoutEl.classList.remove('on');
  }

  /** Big shouted hint ("Kaliwa!") shown over the blindfold. */
  shout(text: string, ms = 900): void {
    this.shoutEl.textContent = text;
    this.shoutEl.classList.add('on');
    clearTimeout(this.shoutT);
    this.shoutT = window.setTimeout(() => this.shoutEl.classList.remove('on'), ms);
  }

  fade(on: boolean, text = ''): void {
    this.fadeEl.textContent = text;
    this.fadeEl.classList.toggle('on', on);
  }

  /** Fade to black, run fn while hidden, fade back. */
  async transition(fn: () => void, text = ''): Promise<void> {
    this.fade(true, text);
    await new Promise((r) => setTimeout(r, 420));
    fn();
    await new Promise((r) => setTimeout(r, 120));
    this.fade(false);
  }
}
