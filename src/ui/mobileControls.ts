import type { Button, Input } from '../core/input';
import { el } from './dom';

const JOY_R = 56;

/**
 * Touch HUD built on Pointer Events (multi-touch via pointerId):
 * - left: floating virtual joystick (appears where the thumb lands)
 * - right: drag anywhere to look, tap to "tap" (Sipa kick)
 * - buttons: Action (throw/kick), Jump, Interact ("Laro!")
 */
export class MobileControls {
  readonly root = el('div.touch');
  private movePad = el('div.move-pad.interactive');
  private lookPad = el('div.look-pad.interactive');
  private base = el('div.joy-base');
  private knob = el('div.joy-knob');
  private btnAction = el('div.tbtn.action.interactive', { text: 'Bato' });
  private btnJump = el('div.tbtn.jump.interactive', { text: 'Talon' });
  private btnInteract = el('div.tbtn.interact.interactive', { text: 'Laro!' });

  private joyId = -1;
  private joyCx = 0;
  private joyCy = 0;
  private lookId = -1;
  private lookX = 0;
  private lookY = 0;
  private lookStart = 0;
  private lookMoved = 0;

  constructor(parent: HTMLElement, private input: Input) {
    this.base.append(this.knob);
    this.movePad.append(this.base);
    this.root.append(this.lookPad, this.movePad, this.btnJump, this.btnAction, this.btnInteract);
    parent.append(this.root);
    this.resetBase();
    window.addEventListener('resize', () => this.resetBase());

    // ---- joystick
    this.movePad.addEventListener('pointerdown', (e) => {
      if (this.joyId !== -1) return;
      e.preventDefault();
      this.joyId = e.pointerId;
      this.movePad.setPointerCapture(e.pointerId);
      const r = this.movePad.getBoundingClientRect();
      this.joyCx = e.clientX - r.left;
      this.joyCy = e.clientY - r.top;
      this.base.style.left = `${this.joyCx}px`;
      this.base.style.top = `${this.joyCy}px`;
      this.moveKnob(0, 0);
    });
    this.movePad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyId) return;
      const r = this.movePad.getBoundingClientRect();
      this.moveKnob(e.clientX - r.left - this.joyCx, e.clientY - r.top - this.joyCy);
    });
    const endJoy = (e: PointerEvent) => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = -1;
      this.input.setJoystick(0, 0, false);
      this.resetBase();
    };
    this.movePad.addEventListener('pointerup', endJoy);
    this.movePad.addEventListener('pointercancel', endJoy);

    // ---- look pad
    this.lookPad.addEventListener('pointerdown', (e) => {
      if (this.lookId !== -1) return;
      e.preventDefault();
      this.lookId = e.pointerId;
      this.lookPad.setPointerCapture(e.pointerId);
      this.lookX = e.clientX;
      this.lookY = e.clientY;
      this.lookStart = performance.now();
      this.lookMoved = 0;
      this.input.tapPressed = true;
    });
    this.lookPad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      const dx = e.clientX - this.lookX;
      const dy = e.clientY - this.lookY;
      this.lookX = e.clientX;
      this.lookY = e.clientY;
      this.lookMoved += Math.abs(dx) + Math.abs(dy);
      this.input.addLook(dx, dy);
    });
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === this.lookId) this.lookId = -1;
    };
    this.lookPad.addEventListener('pointerup', endLook);
    this.lookPad.addEventListener('pointercancel', endLook);

    // ---- buttons
    this.bindButton(this.btnAction, 'action');
    this.bindButton(this.btnJump, 'jump');
    this.bindButton(this.btnInteract, 'interact');
  }

  private bindButton(node: HTMLElement, b: Button): void {
    let id = -1;
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      id = e.pointerId;
      node.setPointerCapture(e.pointerId);
      node.classList.add('down');
      this.input.setButton(b, true);
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      node.classList.remove('down');
      this.input.setButton(b, false);
    };
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private moveKnob(dx: number, dy: number): void {
    const len = Math.hypot(dx, dy);
    if (len > JOY_R) {
      dx *= JOY_R / len;
      dy *= JOY_R / len;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // small dead zone
    const nx = dx / JOY_R, ny = -dy / JOY_R;
    const m = Math.hypot(nx, ny);
    const k = m < 0.12 ? 0 : (m - 0.12) / 0.88 / (m || 1);
    this.input.setJoystick(nx * k, ny * k, true);
  }

  private resetBase(): void {
    const h = this.movePad.clientHeight || window.innerHeight * 0.7;
    this.base.style.left = `${Math.max(90, window.innerWidth * 0.12)}px`;
    this.base.style.top = `${h - 100}px`;
    this.knob.style.transform = 'translate(0px, 0px)';
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
    if (!v) {
      this.joyId = this.lookId = -1;
      this.input.setJoystick(0, 0, false);
    }
  }

  setInteractReady(ready: boolean): void {
    this.btnInteract.classList.toggle('ready', ready);
  }

  setActionLabel(text: string): void {
    if (this.btnAction.textContent !== text) this.btnAction.textContent = text;
  }

  /** Hide jump + joystick while a game locks movement (Sipa). */
  setJumpVisible(v: boolean): void {
    this.btnJump.classList.toggle('hidden', !v);
    this.movePad.classList.toggle('hidden', !v);
  }
}
