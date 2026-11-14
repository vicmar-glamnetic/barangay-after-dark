/**
 * requestAnimationFrame loop with a clamped delta time.
 * Long frames (tab switch, GC hitch) are clamped so physics never explodes.
 */
export class Loop {
  fps = 60;
  private last = 0;
  private raf = 0;
  private running = false;
  private frames = 0;
  private fpsTime = 0;

  private bgTimer = 0;

  /**
   * @param background When this returns true and the tab is hidden, keep
   * ticking at ~10 Hz with setInterval (browsers pause rAF in hidden tabs).
   * Used so a multiplayer host does not freeze the game for everyone.
   */
  constructor(private tick: (dt: number, time: number) => void, private background: () => boolean = () => false) {
    document.addEventListener('visibilitychange', () => {
      clearInterval(this.bgTimer);
      if (document.hidden && this.running) {
        this.bgTimer = window.setInterval(() => {
          if (!this.background()) return;
          const now = performance.now();
          const dt = Math.min((now - this.last) / 1000, 0.25);
          this.last = now;
          this.tick(dt, now / 1000);
        }, 100);
      } else this.last = performance.now();
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 1 / 20);

    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.frames / this.fpsTime;
      this.frames = 0;
      this.fpsTime = 0;
    }
    this.tick(dt, now / 1000);
  };
}
