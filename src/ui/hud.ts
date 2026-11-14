import { el, onTap } from './dom';

/**
 * In-game HUD: crosshair, Tropa Points, objective, interact prompt, toasts,
 * power bar, big counter, timer and the pause button. DOM writes only happen
 * when a value changes, so it is cheap to call every frame.
 */
export class Hud {
  readonly root = el('div.hud');
  private crosshair = el('div.crosshair');
  private pointsEl = el('div.points');
  private pointsNum = el('span', { text: '0' });
  private objective = el('div.objective');
  private stat = el('div.stat');
  private prompt = el('div.prompt.hidden');
  private toastEl = el('div.toast');
  private bigEl = el('div.big.hidden');
  private power = el('div.power.hidden');
  private powerFill = el('i');
  private timer = el('div.timer.hidden');
  private fps = el('div.fps.hidden');
  private clickHint = el('div.click-hint.hidden', { text: 'Click para maglaro' });
  readonly pauseBtn = el('button.icon-btn.interactive', { text: 'II', attrs: { 'aria-label': 'Pause' } });

  private toastTimer = 0;
  private cache = new Map<string, string>();

  constructor(parent: HTMLElement, onPause: () => void) {
    this.pointsEl.append(el('span.star', { text: '★' }), this.pointsNum, el('span', { text: 'Tropa' }));
    this.power.append(this.powerFill);
    this.root.append(this.crosshair, this.pointsEl, this.objective, this.stat, this.prompt, this.bigEl, this.power, this.timer, this.toastEl, this.fps, this.clickHint, this.pauseBtn);
    onTap(this.pauseBtn, onPause);
    parent.append(this.root);
    this.show(false);
  }

  private set(key: string, node: HTMLElement, text: string, html = false): void {
    if (this.cache.get(key) === text) return;
    this.cache.set(key, text);
    if (html) node.innerHTML = text;
    else node.textContent = text;
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  setPoints(n: number): void {
    this.set('pts', this.pointsNum, String(n));
  }

  setObjective(text: string): void {
    this.set('obj', this.objective, text);
  }

  setStat(text: string): void {
    this.set('stat', this.stat, text);
  }

  /** Interact prompt. `key` is shown as a keycap on desktop. */
  setPrompt(text: string | null, key?: string): void {
    this.prompt.classList.toggle('hidden', !text);
    if (text) this.set('prompt', this.prompt, key ? `<kbd>${key}</kbd>${text}` : text, true);
  }

  toast(text: string, kind: '' | 'good' | 'bad' | 'small' = '', ms = 1100): void {
    this.toastEl.textContent = text;
    this.toastEl.className = 'toast ' + kind;
    void this.toastEl.offsetWidth; // restart transition
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  setBig(text: string | null): void {
    this.bigEl.classList.toggle('hidden', text === null);
    if (text !== null && this.cache.get('big') !== text) {
      this.set('big', this.bigEl, text);
      // replay the pop animation on every change (Sipa streak counter)
      this.bigEl.style.animation = 'none';
      void this.bigEl.offsetWidth;
      this.bigEl.style.animation = '';
    }
  }

  setPower(v: number | null): void {
    this.power.classList.toggle('hidden', v === null);
    if (v !== null) this.powerFill.style.width = `${Math.round(v * 100)}%`;
  }

  setTimer(text: string | null): void {
    this.timer.classList.toggle('hidden', text === null);
    if (text !== null) this.set('timer', this.timer, text);
  }

  setCrosshair(v: boolean): void {
    this.crosshair.classList.toggle('hidden', !v);
  }

  setClickHint(v: boolean): void {
    this.clickHint.classList.toggle('hidden', !v);
  }

  setFps(text: string | null): void {
    this.fps.classList.toggle('hidden', text === null);
    if (text !== null) this.set('fps', this.fps, text);
  }

  /** Clear all mini-game widgets (keeps points + pause). */
  clearGameWidgets(): void {
    this.setBig(null);
    this.setPower(null);
    this.setTimer(null);
    this.setStat('');
  }
}
