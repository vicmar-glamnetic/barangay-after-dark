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

  constructor(private tick: (dt: number, time: number) => void) {}

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
