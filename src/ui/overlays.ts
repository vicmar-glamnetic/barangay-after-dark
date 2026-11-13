import { el } from './dom';

/**
 * Full-screen overlays:
 * - "rotate your phone" (CSS-driven: shows on touch devices in portrait)
 * - a black fade with text, used for transitions and Taguan's counting
 */
export class Overlays {
  private fadeEl = el('div.fade');
  readonly rotate = el(
    'div.rotate',
    {},
    el('div.phone'),
    el('h3', { text: 'Ikot mo ang phone mo' }),
    el('p', { text: 'Mas masaya maglaro nang naka-landscape.' }),
  );

  constructor(parent: HTMLElement) {
    parent.append(this.fadeEl, this.rotate);
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
