/**
 * Auto FPS governor: keeps the game near the target frame rate by stepping
 * visual cost down (and back up) on top of the player's Low/High setting.
 *
 * Levels (each includes the ones before):
 *   0  full quality for the chosen setting
 *   1  bloom off
 *   2  render resolution x0.85
 *   3  resolution x0.7, clouds + fireflies off
 *   4  resolution x0.55
 *
 * Rules: sample the average FPS every second. Two slow seconds in a row
 * (< 83% of target) -> one level down. Eight good seconds (>= 97%) -> try one
 * level up. If a level-up fails within 5 s, that level is blocked for 60 s,
 * so it does not flicker back and forth.
 */
export interface PerfLevelEffects {
  bloom: boolean;
  resScale: number;
  extras: boolean; // clouds + fireflies
}

const LEVELS: PerfLevelEffects[] = [
  { bloom: true, resScale: 1, extras: true },
  { bloom: false, resScale: 1, extras: true },
  { bloom: false, resScale: 0.85, extras: true },
  { bloom: false, resScale: 0.7, extras: false },
  { bloom: false, resScale: 0.55, extras: false },
];

export class PerfGovernor {
  level = 0;
  enabled = true;
  target = 60;
  private acc = 0;
  private frames = 0;
  private slow = 0;
  private good = 0;
  private lastUpAt = -1e9;
  private blockedUntil = new Map<number, number>();
  private clock = 0;
  /** Seconds to wait after a change before judging again (lets the GPU settle). */
  private settle = 3;

  /**
   * @param headroom returns true when the GPU and CPU are clearly idle (measured).
   * Then a low frame rate is a browser/OS cap (battery saver), not lag, and we
   * do not downgrade.
   */
  constructor(private apply: (fx: PerfLevelEffects, level: number) => void, private headroom: () => boolean = () => false) {}

  get effects(): PerfLevelEffects {
    return LEVELS[this.enabled ? this.level : 0];
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.set(0);
  }

  reset(): void {
    this.slow = this.good = this.acc = this.frames = 0;
    this.settle = 3;
  }

  /** Call once per rendered frame with the real frame delta (seconds, unclamped). */
  frame(rawDt: number): void {
    if (!this.enabled) return;
    this.clock += rawDt;
    if (this.settle > 0) {
      this.settle -= rawDt;
      return;
    }
    // ignore hitches from tab switches etc.
    if (rawDt > 0.25) return;
    this.acc += rawDt;
    this.frames++;
    if (this.acc < 1) return;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;

    if (fps < this.target * 0.83) {
      this.good = 0;
      if (this.headroom()) {
        this.slow = 0;
        return;
      }
      if (++this.slow >= 2 && this.level < LEVELS.length - 1) {
        // a level-up that failed quickly gets blocked for a minute
        if (this.clock - this.lastUpAt < 5) this.blockedUntil.set(this.level, this.clock + 60);
        this.set(this.level + 1);
      }
    } else if (fps >= this.target * 0.97) {
      this.slow = 0;
      if (++this.good >= 8 && this.level > 0) {
        const next = this.level - 1;
        if ((this.blockedUntil.get(next) ?? 0) < this.clock) {
          this.lastUpAt = this.clock;
          this.set(next);
        } else this.good = 0;
      }
    } else {
      this.slow = this.good = 0;
    }
  }

  private set(level: number): void {
    if (level === this.level) return;
    this.level = level;
    this.slow = this.good = 0;
    this.settle = 2;
    this.apply(LEVELS[level], level);
  }
}
