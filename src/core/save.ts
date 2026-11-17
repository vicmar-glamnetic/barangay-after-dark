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
  /** Send scores to the online leaderboard (name + score only). */
  onlineScores: boolean;
  /** Characters speak their lines out loud (recorded clip if there is one, else the browser voice). */
  voices: boolean;
}

export interface SaveData {
  v: 1;
  tropaPoints: number;
  /** How many games (in gameManager order) are unlocked. Always at least 1. */
  unlocked: number;
  best: Record<string, number>;
  plays: Record<string, number>;
  /** Best star count (0-3) per game. */
  stars: Record<string, number>;
  /** Day ("YYYY-MM-DD") the daily challenge was last completed, and the streak of days in a row. */
  dailyDone: string;
  streak: number;
  /** Chosen tsinelas color index (see core/progression SLIPPERS). */
  slipper: number;
  /** Barya: shop wallet, separate from Tropa Points (spending never lowers your rank). */
  barya: number;
  /** Shop item ids bought (see core/meta SHOP). */
  owned: string[];
  /** Equipped name-tag title (shop item id) or ''. */
  title: string;
  /** Badge id -> day earned. */
  badges: Record<string, string>;
  /** Daily quest progress (see core/meta). */
  quests: QuestState;
  /** Rival level per game (0..5). */
  rivals: Record<string, number>;
  /** Top 5 scores per game with dates. */
  history: Record<string, { s: number; d: string }[]>;
  /** Times the sorbetero was caught, and the last event slot it was caught in. */
  sorbetes: number;
  sorbetesSlot: number;
  /** Games left with a treat's Tropa boost (core/meta TREAT_MULT). */
  boost: number;
  settings: Settings;
}

export interface QuestState {
  date: string;
  prog: number[];
  done: boolean[];
  /** Game ids played today. */
  games: string[];
  /** Tropa earned today. */
  tropa: number;
  /** All-three bonus already paid. */
  bonus: boolean;
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
      stars: {},
      dailyDone: '',
      streak: 0,
      slipper: 0,
      barya: 0,
      owned: [],
      title: '',
      badges: {},
      quests: { date: '', prog: [0, 0, 0], done: [false, false, false], games: [], tropa: 0, bonus: false },
      rivals: {},
      history: {},
      sorbetes: 0,
      sorbetesSlot: -1,
      boost: 0,
      settings: { sensitivity: 1, invertY: false, quality: this.defaultQuality, volume: 0.8, autoFps: true, showFps: false, glow: false, onlineScores: true, voices: true },
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
    d.stars = recs(raw.stars);
    d.dailyDone = typeof raw.dailyDone === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dailyDone) ? raw.dailyDone : '';
    d.streak = Math.round(num(raw.streak, 0, 0, 9999));
    d.slipper = Math.round(num(raw.slipper, 0, 0, 99));
    d.barya = Math.round(num(raw.barya, 0, 0, 1e9));
    const strs = (o: unknown) => (Array.isArray(o) ? o.filter((x): x is string => typeof x === 'string').slice(0, 200) : []);
    d.owned = strs(raw.owned);
    d.title = typeof raw.title === 'string' ? raw.title : '';
    if (raw.badges && typeof raw.badges === 'object')
      for (const [k, v] of Object.entries(raw.badges)) if (typeof v === 'string') d.badges[k] = v;
    const q = raw.quests as Partial<QuestState> | undefined;
    if (q && typeof q === 'object' && typeof q.date === 'string') {
      const nums = (a: unknown) => [0, 1, 2].map((i) => (Array.isArray(a) ? num(a[i], 0, 0, 1e9) : 0));
      d.quests = {
        date: q.date,
        prog: nums(q.prog),
        done: [0, 1, 2].map((i) => Array.isArray(q.done) && q.done[i] === true),
        games: strs(q.games),
        tropa: num(q.tropa, 0, 0, 1e9),
        bonus: q.bonus === true,
      };
    }
    d.rivals = Object.fromEntries(Object.entries(recs(raw.rivals)).map(([k, v]) => [k, Math.round(Math.min(5, Math.max(0, v)))]));
    if (raw.history && typeof raw.history === 'object')
      for (const [k, v] of Object.entries(raw.history)) {
        if (!Array.isArray(v)) continue;
        d.history[k] = v
          .filter((x) => x && typeof x.s === 'number' && typeof x.d === 'string')
          .slice(0, 5)
          .map((x) => ({ s: x.s, d: x.d }));
      }
    d.sorbetes = Math.round(num(raw.sorbetes, 0, 0, 1e6));
    d.sorbetesSlot = Math.round(num(raw.sorbetesSlot, -1, -1, 1e12));
    d.boost = Math.round(num(raw.boost, 0, 0, 999));
    const s = raw.settings as Partial<Settings> | undefined;
    if (s) {
      d.settings.sensitivity = num(s.sensitivity, 1, 0.2, 3);
      d.settings.invertY = s.invertY === true;
      d.settings.quality = s.quality === 'low' || s.quality === 'high' ? s.quality : this.defaultQuality;
      d.settings.volume = num(s.volume, 0.8, 0, 1);
      d.settings.autoFps = s.autoFps !== false;
      d.settings.showFps = s.showFps === true;
      d.settings.glow = s.glow === true;
      d.settings.onlineScores = s.onlineScores !== false;
      d.settings.voices = s.voices !== false;
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
