/**
 * Meta progression on top of stars / ranks / daily challenge (core/progression):
 *  - Badges (achievements) with Barya rewards
 *  - 3 daily quests ("Gawain ngayon")
 *  - Rivals: one named kid per game whose score grows each time you beat them
 *  - Tindahan (shop): tsinelas and name-tag titles bought with Barya
 *  - Night events, picked from the wall clock so every player sees the same one
 *
 * Everything here is pure logic (no DOM, no three.js) so it is easy to test.
 * Barya is a separate wallet from Tropa Points: spending never lowers your rank.
 */
import { RANKS, SLIPPERS, STAR_THRESHOLDS, rankIndex, today } from './progression';
import type { SaveData } from './save';

// ================================================================== badges

/** Facts about one finished game, used to check badges and quests. */
export interface Finish {
  gameId: string;
  score: number;
  won: boolean;
  stars: number;
  multiplayer: boolean;
  /** Extra feats a game reported, e.g. 'untouched' (see GameResult.feats). */
  feats: string[];
  event: EventId | null;
  tourWon: boolean;
  rivalBeaten: boolean;
  rivalLevel: number;
}

export interface Badge {
  id: string;
  name: string;
  desc: string;
  barya: number;
  /** Checked after every game (and after sorbetes / shop / streak changes). */
  test: (d: SaveData, f: Finish | null) => boolean;
}

const t3 = (id: string) => STAR_THRESHOLDS[id]?.[2] ?? Infinity;
const playedAll = (d: SaveData) => Object.keys(STAR_THRESHOLDS).every((id) => (d.plays[id] ?? 0) > 0);
const totalPlays = (d: SaveData) => Object.values(d.plays).reduce((a, b) => a + b, 0);
const is = (f: Finish | null, id: string) => !!f && f.gameId === id;

export const BADGES: Badge[] = [
  { id: 'first', name: 'Unang Laro', desc: 'Tapusin ang unang laro mo.', barya: 20, test: (d) => totalPlays(d) >= 1 },
  { id: 'allGames', name: 'Laro ng Lahi', desc: 'Laruin lahat ng 9 na laro.', barya: 80, test: playedAll },
  { id: 'star3', name: 'Tatlong Bituin', desc: 'Makakuha ng ★★★ sa kahit anong laro.', barya: 40, test: (d) => Object.values(d.stars).some((s) => s >= 3) },
  { id: 'star3All', name: 'Bituin ng Barangay', desc: 'Makakuha ng ★★★ sa lahat ng laro.', barya: 300, test: (d) => Object.keys(STAR_THRESHOLDS).every((id) => (d.stars[id] ?? 0) >= 3) },
  { id: 'untouched', name: 'Di Mahuli', desc: 'Tumbang Preso: tapusin nang hindi na-taya.', barya: 40, test: (_d, f) => is(f, 'tumbangPreso') && f!.feats.includes('untouched') && f!.score >= 20 },
  { id: 'sipa20', name: 'Paang Bakal', desc: 'Sipa: 20 sunod-sunod na sipa.', barya: 50, test: (_d, f) => is(f, 'sipa') && f!.score >= 20 },
  { id: 'lusot', name: 'Lusot!', desc: 'Patintero: makabalik nang walang nawalang buhay.', barya: 50, test: (_d, f) => is(f, 'patintero') && f!.feats.includes('flawless') },
  { id: 'multo', name: 'Multo', desc: 'Taguan: hindi ka nakita hanggang dulo.', barya: 50, test: (_d, f) => is(f, 'taguan') && f!.feats.includes('unseen') },
  { id: 'lawin', name: 'Mata ng Lawin', desc: 'Taguan: mahanap lahat bilang taya.', barya: 40, test: (_d, f) => is(f, 'taguan') && f!.feats.includes('foundAll') },
  { id: 'diAbot', name: 'Di Maabot', desc: 'Langit-Lupa: hindi ka nahuli.', barya: 40, test: (_d, f) => is(f, 'langitLupa') && f!.won },
  { id: 'piko3', name: 'Ballerina ng Kanto', desc: 'Piko: ★★★', barya: 50, test: (_d, f) => is(f, 'piko') && f!.score >= t3('piko') },
  { id: 'baka3', name: 'Lundag Kalabaw', desc: 'Luksong Baka: ★★★', barya: 50, test: (_d, f) => is(f, 'luksongBaka') && f!.score >= t3('luksongBaka') },
  { id: 'holen3', name: 'Asintado', desc: 'Holen: ★★★', barya: 50, test: (_d, f) => is(f, 'holen') && f!.score >= t3('holen') },
  { id: 'palayok3', name: 'Bulag pero Bihasa', desc: 'Pukpok Palayok: ★★★', barya: 50, test: (_d, f) => is(f, 'pukpokPalayok') && f!.score >= t3('pukpokPalayok') },
  { id: 'streak3', name: 'Tatlong Araw', desc: '3 araw sunod-sunod na Hamon.', barya: 40, test: (d) => d.streak >= 3 },
  { id: 'streak7', name: 'Isang Linggo', desc: '7 araw sunod-sunod na Hamon.', barya: 120, test: (d) => d.streak >= 7 },
  { id: 'streak30', name: 'Isang Buwan', desc: '30 araw sunod-sunod na Hamon.', barya: 500, test: (d) => d.streak >= 30 },
  { id: 'plays50', name: 'Laging Nasa Kanto', desc: 'Maglaro nang 50 beses.', barya: 80, test: (d) => totalPlays(d) >= 50 },
  { id: 'plays200', name: 'Tambay ng Taon', desc: 'Maglaro nang 200 beses.', barya: 250, test: (d) => totalPlays(d) >= 200 },
  { id: 'mpWin', name: 'Hari ng Tropa', desc: 'Manalo sa laro kasama ang tropa.', barya: 50, test: (_d, f) => !!f && f.multiplayer && f.won },
  { id: 'tourWin', name: 'Kampeon ng Torneo', desc: 'Manalo sa Torneo (3 laro).', barya: 120, test: (_d, f) => !!f && f.tourWon },
  { id: 'rival', name: 'Talo si Karibal', desc: 'Talunin ang isang karibal.', barya: 30, test: (_d, f) => !!f && f.rivalBeaten },
  { id: 'rivalMax', name: 'Wala nang Karibal', desc: 'Talunin ang isang karibal sa level 5.', barya: 200, test: (d) => Object.values(d.rivals).some((l) => l >= RIVAL_MAX) },
  { id: 'fiesta', name: 'Fiesta!', desc: 'Maglaro habang may Fiesta.', barya: 30, test: (_d, f) => !!f && f.event === 'fiesta' },
  { id: 'dilim', name: 'Sa Dilim', desc: 'Maglaro ng Taguan habang brownout.', barya: 50, test: (_d, f) => is(f, 'taguan') && f!.event === 'brownout' },
  { id: 'ulan', name: 'Basang Sisiw', desc: 'Maglaro habang umuulan.', barya: 30, test: (_d, f) => !!f && f.event === 'ulan' },
  { id: 'sorbetes', name: 'Sorbetero!', desc: 'Abutan ang sorbetero.', barya: 30, test: (d) => d.sorbetes >= 1 },
  { id: 'shop5', name: 'Mayaman', desc: 'Bumili ng 5 bagay sa Tindahan.', barya: 100, test: (d) => d.owned.length >= 5 },
  { id: 'hari', name: 'Hari ng Kanto', desc: `Abutin ang ranggong ${RANKS[RANKS.length - 1].name}.`, barya: 1000, test: (d) => rankIndex(d.tropaPoints) >= RANKS.length - 1 },
];

/** Award every newly earned badge. Returns the new ones (Barya already added). */
export function checkBadges(d: SaveData, f: Finish | null): Badge[] {
  const out: Badge[] = [];
  for (const b of BADGES) {
    if (d.badges[b.id]) continue;
    if (!b.test(d, f)) continue;
    d.badges[b.id] = today();
    d.barya += b.barya;
    out.push(b);
  }
  return out;
}

// ================================================================== daily quests

export type QuestKind = 'plays' | 'variety' | 'stars' | 'score' | 'tropa';

export interface Quest {
  kind: QuestKind;
  /** Game for 'stars' / 'score' quests. */
  gameId?: string;
  goal: number;
  text: string;
}

export const QUEST_BARYA = 30;
export const QUEST_TROPA = 20;
export const QUEST_ALL_BONUS = 60;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Today's three quests (same for everyone on the same date). */
export function dailyQuests(gameIds: string[], names: Record<string, string>, date = today()): Quest[] {
  const h = hash('q' + date);
  const pool = gameIds.filter((id) => STAR_THRESHOLDS[id]);
  const g1 = pool[h % pool.length];
  let g2 = pool[(h >>> 8) % pool.length];
  if (g2 === g1) g2 = pool[(pool.indexOf(g1) + 3) % pool.length];
  const plays = 4 + (h % 3);
  const variety = 3 + ((h >>> 4) % 2);
  const quests: Quest[] = [
    (h >>> 12) % 2
      ? { kind: 'plays', goal: plays, text: `Maglaro nang ${plays} beses` }
      : { kind: 'variety', goal: variety, text: `Maglaro ng ${variety} magkakaibang laro` },
    { kind: 'stars', gameId: g1, goal: 2, text: `Makakuha ng ★★ sa ${names[g1] ?? g1}` },
    (h >>> 16) % 2
      ? { kind: 'score', gameId: g2, goal: STAR_THRESHOLDS[g2][0], text: `Umabot ng ${STAR_THRESHOLDS[g2][0]} puntos sa ${names[g2] ?? g2}` }
      : { kind: 'tropa', goal: 150, text: 'Mag-ipon ng 150 Tropa ngayon' },
  ];
  return quests;
}

/** Reset quest progress when the day changes. */
export function rollQuests(d: SaveData): void {
  const t = today();
  if (d.quests.date === t) return;
  d.quests = { date: t, prog: [0, 0, 0], done: [false, false, false], games: [], tropa: 0, bonus: false };
}

/**
 * Advance quest progress after a game. Returns the quests completed just now
 * (rewards already added) and whether the all-three bonus was earned.
 */
export function advanceQuests(d: SaveData, qs: Quest[], f: Finish, tropaEarned: number): { done: Quest[]; bonus: boolean } {
  rollQuests(d);
  const q = d.quests;
  if (!q.games.includes(f.gameId)) q.games.push(f.gameId);
  q.tropa += tropaEarned;
  const done: Quest[] = [];
  qs.forEach((quest, i) => {
    if (q.done[i]) return;
    switch (quest.kind) {
      case 'plays':
        q.prog[i]++;
        break;
      case 'variety':
        q.prog[i] = q.games.length;
        break;
      case 'stars':
        if (f.gameId === quest.gameId) q.prog[i] = Math.max(q.prog[i], f.stars);
        break;
      case 'score':
        if (f.gameId === quest.gameId) q.prog[i] = Math.max(q.prog[i], f.score);
        break;
      case 'tropa':
        q.prog[i] = q.tropa;
        break;
    }
    if (q.prog[i] >= quest.goal) {
      q.done[i] = true;
      d.barya += QUEST_BARYA;
      done.push(quest);
    }
  });
  let bonus = false;
  if (!q.bonus && q.done.every(Boolean)) {
    q.bonus = true;
    bonus = true;
    d.barya += QUEST_ALL_BONUS;
  }
  return { done, bonus };
}

// ================================================================== rivals

export const RIVAL_MAX = 5;

export const RIVALS: Record<string, { name: string; taunts: string[]; lose: string; win: string }> = {
  tumbangPreso: { name: 'Jun-jun', taunts: ['Tsinelas mo, pang-bahay lang!', 'Hindi mo matutumba ang lata ko!'], lose: 'Swerte mo lang yan!', win: 'Hehe, ulit ka na lang!' },
  sipa: { name: 'Bunso', taunts: ['Sampu lang? Kaya ko yan nang nakapikit!', 'Sipa pa more!'], lose: 'Huy, ang galing mo pala!', win: 'Pang-baguhan pa lang yan!' },
  patintero: { name: 'Totoy', taunts: ['Walang lumulusot sa linya ko!', 'Bilis mo, pero mas mabilis ako.'], lose: 'Paano ka nakalusot?!', win: 'Taya ka na naman!' },
  taguan: { name: 'Ising', taunts: ['Kahit saan ka magtago, kita kita!', 'Ako ang reyna ng taguan.'], lose: 'Saan ka nagtago?!', win: 'Nakita na kita, hehe.' },
  langitLupa: { name: 'Bebang', taunts: ['Langit ka man, maaabot kita!', 'Bilisan mo ang paa mo!'], lose: 'Hay, pagod na ako.', win: 'Huli ka!' },
  piko: { name: 'Nene', taunts: ['Huwag kang tatapak sa linya, ha!', 'Piko queen ako dito.'], lose: 'Ang ganda ng talon mo!', win: 'Natapakan mo ang linya!' },
  luksongBaka: { name: 'Kulot', taunts: ['Mataas ang baka ko ngayon!', 'Kaya mo bang lumundag nang ganito?'], lose: 'Ang taas ng lundag mo!', win: 'Bumagsak ka sa baka, hehe.' },
  holen: { name: 'Dodong', taunts: ['Akin lahat ng holen dito!', 'Tirador ako ng barangay.'], lose: 'Ubos ang holen ko!', win: 'Akin na ang holen mo!' },
  pukpokPalayok: { name: 'Inday', taunts: ['Basagin mo kung kaya mo!', 'Mag-ingat ka, baka ulo ko ang tamaan mo!'], lose: 'Wow, basag lahat!', win: 'Mali ang palo mo!' },
};

/** Score the rival posts at a level (0..RIVAL_MAX-1). Climbs from 1★ to past 3★. */
export function rivalTarget(gameId: string, level: number): number {
  const t = STAR_THRESHOLDS[gameId];
  if (!t) return 0;
  const lo = Math.max(1, Math.round(t[0] * 1.1));
  const hi = Math.round(t[2] * 1.15);
  return Math.round(lo + ((hi - lo) * Math.min(level, RIVAL_MAX - 1)) / (RIVAL_MAX - 1));
}

export const rivalReward = (level: number) => 25 + level * 20;

// ================================================================== shop

export interface ShopItem {
  id: string;
  kind: 'slipper' | 'title';
  name: string;
  price: number;
  /** slipper: [strap, top] colors. */
  colors?: [number, number];
}

export const SHOP: ShopItem[] = [
  { id: 's-itim', kind: 'slipper', name: 'Itim na Tsinelas', price: 120, colors: [0x1b1b1f, 0x3a3a44] },
  { id: 's-pink', kind: 'slipper', name: 'Pink na Tsinelas', price: 150, colors: [0xff4d8d, 0xffa3c4] },
  { id: 's-kahel', kind: 'slipper', name: 'Kahel na Tsinelas', price: 150, colors: [0xe8590c, 0xffa94d] },
  { id: 's-puti', kind: 'slipper', name: 'Puting Tsinelas', price: 200, colors: [0xd0d0d0, 0xffffff] },
  { id: 's-army', kind: 'slipper', name: 'Pang-army', price: 260, colors: [0x4b5320, 0x8a9a5b] },
  { id: 's-neon', kind: 'slipper', name: 'Neon', price: 400, colors: [0x39ff14, 0xf72585] },
  { id: 't-lodi', kind: 'title', name: 'Lodi', price: 100 },
  { id: 't-petmalu', kind: 'title', name: 'Petmalu', price: 120 },
  { id: 't-werpa', kind: 'title', name: 'Werpa', price: 120 },
  { id: 't-sipa', kind: 'title', name: 'Sipa King', price: 180 },
  { id: 't-taya', kind: 'title', name: 'Forever Taya', price: 180 },
  { id: 't-tambay', kind: 'title', name: 'Tambay Pro', price: 220 },
  { id: 't-90s', kind: 'title', name: 'Batang 90s', price: 250 },
  { id: 't-alamat', kind: 'title', name: 'Alamat', price: 600 },
];

export const shopItem = (id: string) => SHOP.find((s) => s.id === id);

export function buy(d: SaveData, id: string): string | null {
  const it = shopItem(id);
  if (!it) return 'Wala nito sa tindahan.';
  if (d.owned.includes(id)) return 'Nasa iyo na ito.';
  if (d.barya < it.price) return `Kulang ang Barya mo (${it.price - d.barya} pa).`;
  d.barya -= it.price;
  d.owned.push(id);
  return null;
}

/** Text shown under your name on lobby name tags: title (if equipped) or rank. */
export function nameTagSub(d: SaveData): string {
  const t = d.title ? shopItem(d.title) : null;
  return t && d.owned.includes(t.id) ? t.name : RANKS[rankIndex(d.tropaPoints)].name;
}

// ================================================================== night events

export type EventId = 'fiesta' | 'brownout' | 'ulan' | 'sorbetero';

export interface NightEvent {
  id: EventId;
  name: string;
  /** Shown in the HUD chip while active. */
  chip: string;
  /** Toast when it starts. */
  start: string;
  /** Tropa multiplier for games finished during it (per game id, '*' = all). */
  mult: Record<string, number>;
}

export const EVENTS: Record<EventId, NightEvent> = {
  fiesta: { id: 'fiesta', name: 'Fiesta', chip: 'FIESTA: x2 Tropa', start: 'Fiesta sa barangay! Doble ang Tropa Points!', mult: { '*': 2 } },
  brownout: { id: 'brownout', name: 'Brownout', chip: 'BROWNOUT: Taguan x2', start: 'Brownout! Perfect sa Taguan. x2 doon!', mult: { taguan: 2, '*': 1.2 } },
  ulan: { id: 'ulan', name: 'Ulan', chip: 'UMUULAN: x1.5 Tropa', start: 'Umuulan! Basa pero masaya. x1.5 Tropa!', mult: { '*': 1.5 } },
  sorbetero: { id: 'sorbetero', name: 'Sorbetero', chip: 'SORBETERO: hanapin siya!', start: 'Ting-ting-ting! May sorbetero! Hanapin mo.', mult: {} },
};

/** Each slot is 4 minutes; an event runs for the first 3 minutes of about half the slots. */
export const EVENT_SLOT_MS = 4 * 60 * 1000;
export const EVENT_RUN_MS = 3 * 60 * 1000;

/** The event at a wall-clock time (same for every player), and how long it has left. */
export function eventAt(now = Date.now()): { ev: NightEvent; slot: number; leftMs: number } | null {
  const slot = Math.floor(now / EVENT_SLOT_MS);
  const into = now - slot * EVENT_SLOT_MS;
  if (into > EVENT_RUN_MS) return null;
  const h = hash('ev' + slot);
  if (h % 100 >= 55) return null;
  const ids: EventId[] = ['fiesta', 'brownout', 'ulan', 'sorbetero'];
  return { ev: EVENTS[ids[(h >>> 8) % ids.length]], slot, leftMs: EVENT_RUN_MS - into };
}

/** Deterministic pick in [0, n) for a slot (where the sorbetero parks, etc). */
export const slotPick = (slot: number, n: number) => hash('sp' + slot) % n;

export function eventMult(ev: NightEvent | null, gameId: string): number {
  if (!ev) return 1;
  return ev.mult[gameId] ?? ev.mult['*'] ?? 1;
}

// ================================================================== personal records

export interface RecordRow {
  s: number;
  d: string;
}

/** Keep each game's top 5 scores with dates. Returns the rank (1-5) of this score or 0. */
export function pushRecord(d: SaveData, gameId: string, score: number): number {
  const list = (d.history[gameId] ??= []);
  list.push({ s: score, d: today() });
  list.sort((a, b) => b.s - a.s);
  const idx = list.findIndex((r) => r.s === score);
  list.length = Math.min(list.length, 5);
  return idx >= 0 && idx < 5 ? idx + 1 : 0;
}

// ================================================================== tsinelas choices


export interface SlipperChoice {
  name: string;
  strap: number;
  top: number;
  unlocked: boolean;
  /** Why it is locked ("Ranggo: Tambay" / "Tindahan: 150 Barya"). */
  need: string;
}

/** Rank tsinelas first (indices kept stable for old saves), then shop tsinelas. */
export function slipperChoices(d: SaveData): SlipperChoice[] {
  const have = rankIndex(d.tropaPoints);
  return [
    ...SLIPPERS.map((s) => ({ name: s.name, strap: s.strap, top: s.top, unlocked: s.rank <= have, need: `Ranggo: ${RANKS[s.rank].name} (${RANKS[s.rank].at} Tropa)` })),
    ...SHOP.filter((it) => it.kind === 'slipper').map((it) => ({
      name: it.name, strap: it.colors![0], top: it.colors![1], unlocked: d.owned.includes(it.id), need: `Tindahan: ${it.price} Barya`,
    })),
  ];
}
