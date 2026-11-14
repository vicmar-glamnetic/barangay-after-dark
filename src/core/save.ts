/**
 * Progress + settings persisted in localStorage.
 * Every storage access is wrapped in try/catch: Safari private mode, blocked
 * site data and embedded previews can all throw or return nothing. The game
 * keeps working in memory if storage is unavailable.
 */
export type Quality = 'low' | 'high';

export interface Settings {
  /** Look sensitivity multiplier, 0.2 to 3. */
  sensitivity: number;
  invertY: boolean;
  quality: Quality;
  /** Master volume 0 to 1. */
  volume: number;
  /** Auto FPS governor on (lowers effects/resolution when the frame rate drops). */
  autoFps: boolean;
  /** Show the FPS counter. */
  showFps: boolean;
  /** Bloom glow (desktop High only). Off by default: it costs ~4-7 ms per frame. */
  glow: boolean;
}

export interface SaveData {
  v: 1;
  tropaPoints: number;
  /** How many games (in gameManager order) are unlocked. Always at least 1. */
  unlocked: number;
  best: Record<string, number>;
  plays: Record<string, number>;
  settings: Settings;
}

const KEY = 'barangay-after-dark:save:v1';

const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export class SaveStore {
  data: SaveData;

  constructor(private defaultQuality: Quality) {
    this.data = this.defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = this.sanitize(JSON.parse(raw));
    } catch {
      /* storage unavailable or corrupt: keep defaults */
    }
  }

  private defaults(): SaveData {
    return {
      v: 1,
      tropaPoints: 0,
      unlocked: 1,
      best: {},
      plays: {},
      settings: { sensitivity: 1, invertY: false, quality: this.defaultQuality, volume: 0.8, autoFps: true, showFps: false, glow: false },
    };
  }

  /** Accept only well-formed fields from a stored blob. */
  private sanitize(raw: Partial<SaveData> | null): SaveData {
    const d = this.defaults();
    if (!raw || typeof raw !== 'object') return d;
    d.tropaPoints = num(raw.tropaPoints, 0, 0, 1e9);
    d.unlocked = Math.round(num(raw.unlocked, 1, 1, 99));
    const recs = (o: unknown) => {
      const out: Record<string, number> = {};
      if (o && typeof o === 'object')
        for (const [k, v] of Object.entries(o)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      return out;
    };
    d.best = recs(raw.best);
    d.plays = recs(raw.plays);
    const s = raw.settings as Partial<Settings> | undefined;
    if (s) {
      d.settings.sensitivity = num(s.sensitivity, 1, 0.2, 3);
      d.settings.invertY = s.invertY === true;
      d.settings.quality = s.quality === 'low' || s.quality === 'high' ? s.quality : this.defaultQuality;
      d.settings.volume = num(s.volume, 0.8, 0, 1);
      d.settings.autoFps = s.autoFps !== false;
      d.settings.showFps = s.showFps === true;
      d.settings.glow = s.glow === true;
    }
    return d;
  }

  persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* quota or privacy mode: ignore */
    }
  }

  addPoints(n: number): void {
    this.data.tropaPoints += Math.max(0, Math.round(n));
    this.persist();
  }

  /** Returns true when the score beats the stored best. */
  recordScore(gameId: string, score: number): boolean {
    this.data.plays[gameId] = (this.data.plays[gameId] ?? 0) + 1;
    const prev = this.data.best[gameId];
    const isBest = prev === undefined || score > prev;
    if (isBest) this.data.best[gameId] = score;
    this.persist();
    return isBest;
  }

  unlockUpTo(count: number): boolean {
    if (count <= this.data.unlocked) return false;
    this.data.unlocked = count;
    this.persist();
    return true;
  }

  resetProgress(): void {
    const settings = this.data.settings;
    this.data = this.defaults();
    this.data.settings = settings;
    this.persist();
  }
}
