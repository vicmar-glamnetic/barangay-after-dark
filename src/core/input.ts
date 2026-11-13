import { device } from './device';

export type Button = 'jump' | 'action' | 'interact';

/**
 * One input system for both platforms.
 *
 * Desktop feeds it from the keyboard + Pointer Lock mouse.
 * Touch feeds it from ui/mobileControls (joystick, look pad, buttons),
 * which call setJoystick / addLook / setButton.
 *
 * Game code only reads: moveX/moveY, run, lookDX/lookDY, down/pressed/released.
 * Edge flags (pressed/released) are cleared by endFrame() once per frame.
 */
export class Input {
  /** -1..1, +Y is forward. */
  moveX = 0;
  moveY = 0;
  run = false;
  /** Raw look delta this frame. Mouse: pixels. Touch: pixels (scaled differently by the player). */
  lookDX = 0;
  lookDY = 0;
  /** Was the look delta produced by touch? (touch and mouse use different scales) */
  lookFromTouch = false;
  pausePressed = false;
  /** A tap on the touch look-pad. Sipa uses it as an alternative kick. */
  tapPressed = false;

  usingTouch: boolean;
  locked = false;
  /** When false, game input is ignored (menus open). Pause/Esc still work. */
  enabled = true;

  private keys = new Set<string>();
  private held: Record<Button, boolean> = { jump: false, action: false, interact: false };
  private pressedF: Record<Button, boolean> = { jump: false, action: false, interact: false };
  private releasedF: Record<Button, boolean> = { jump: false, action: false, interact: false };
  private joyX = 0;
  private joyY = 0;
  private joyActive = false;
  private modeCbs: ((touch: boolean) => void)[] = [];
  private lockCbs: ((locked: boolean) => void)[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.usingTouch = device.prefersTouch;

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.clearAll());

    document.addEventListener('mousedown', (e) => {
      if (this.locked && e.button === 0) this.setButton('action', true);
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.setButton('action', false);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Some browsers spike movementX on lock; clamp outliers.
      this.lookDX += Math.max(-250, Math.min(250, e.movementX || 0));
      this.lookDY += Math.max(-250, Math.min(250, e.movementY || 0));
      this.lookFromTouch = false;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.setButton('action', false);
      for (const cb of this.lockCbs) cb(this.locked);
    });

    // Live HUD switching: a real touch switches to touch HUD, a mouse click back.
    window.addEventListener(
      'pointerdown',
      (e) => {
        const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
        if (e.pointerType === 'mouse' && this.usingTouch && new URLSearchParams(location.search).get('touch') === '1') return;
        if (touch !== this.usingTouch && (touch || e.pointerType === 'mouse')) {
          this.usingTouch = touch;
          for (const cb of this.modeCbs) cb(touch);
        }
      },
      { capture: true },
    );
  }

  onModeChange(cb: (touch: boolean) => void): void {
    this.modeCbs.push(cb);
  }
  onLockChange(cb: (locked: boolean) => void): void {
    this.lockCbs.push(cb);
  }

  requestLock(): void {
    if (this.usingTouch || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {
        /* Chrome refuses re-lock for ~1s after Esc; the "click to play" hint covers it */
      });
    } catch {
      /* unsupported */
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // --- feeders -------------------------------------------------------------

  setButton(b: Button, down: boolean): void {
    if (down && !this.held[b]) this.pressedF[b] = true;
    if (!down && this.held[b]) this.releasedF[b] = true;
    this.held[b] = down;
  }

  setJoystick(x: number, y: number, active: boolean): void {
    this.joyX = x;
    this.joyY = y;
    this.joyActive = active;
  }

  addLook(dx: number, dy: number): void {
    this.lookDX += dx;
    this.lookDY += dy;
    this.lookFromTouch = true;
  }

  // --- readers -------------------------------------------------------------

  down(b: Button): boolean {
    return this.enabled && this.held[b];
  }
  pressed(b: Button): boolean {
    return this.enabled && this.pressedF[b];
  }
  released(b: Button): boolean {
    return this.enabled && this.releasedF[b];
  }

  /** Call once per frame before game logic: resolves move vector from keys or joystick. */
  update(): void {
    if (!this.enabled) {
      this.moveX = this.moveY = 0;
      this.run = false;
      return;
    }
    if (this.joyActive) {
      this.moveX = this.joyX;
      this.moveY = this.joyY;
      this.run = Math.hypot(this.joyX, this.joyY) > 0.92;
      return;
    }
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.moveX = x;
    this.moveY = y;
    this.run = k.has('ShiftLeft') || k.has('ShiftRight');
  }

  /** Call at the very end of a frame. */
  endFrame(): void {
    this.lookDX = this.lookDY = 0;
    this.pausePressed = false;
    this.tapPressed = false;
    for (const b of ['jump', 'action', 'interact'] as Button[]) {
      this.pressedF[b] = false;
      this.releasedF[b] = false;
    }
  }

  clearAll(): void {
    this.keys.clear();
    for (const b of ['jump', 'action', 'interact'] as Button[]) {
      this.held[b] = this.pressedF[b] = this.releasedF[b] = false;
    }
    this.joyActive = false;
    this.joyX = this.joyY = 0;
    this.lookDX = this.lookDY = 0;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && (t as HTMLInputElement).type !== 'range') return;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'Escape' || e.code === 'KeyP') {
      // With pointer lock active the browser eats Esc and fires pointerlockchange instead.
      if (!e.repeat) this.pausePressed = true;
      return;
    }
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'Space') this.setButton('jump', true);
    if (e.code === 'KeyE') this.setButton('interact', true);
    if (e.code === 'KeyF' || e.code === 'Enter') this.setButton('action', true);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    if (e.code === 'Space') this.setButton('jump', false);
    if (e.code === 'KeyE') this.setButton('interact', false);
    if (e.code === 'KeyF' || e.code === 'Enter') this.setButton('action', false);
  };
}
