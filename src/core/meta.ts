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
import { L } from './i18n';
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
  readonly name: string;
  readonly desc: string;
  barya: number;
  /** Checked after every game (and after sorbetes / shop / streak changes). */
  test: (d: SaveData, f: Finish | null) => boolean;
}

const t3 = (id: string) => STAR_THRESHOLDS[id]?.[2] ?? Infinity;
const playedAll = (d: SaveData) => Object.keys(STAR_THRESHOLDS).every((id) => (d.plays[id] ?? 0) > 0);
const totalPlays = (d: SaveData) => Object.values(d.plays).reduce((a, b) => a + b, 0);
const is = (f: Finish | null, id: string) => !!f && f.gameId === id;

const badge = (id: string, name: [string, string], desc: [string, string], barya: number, test: Badge['test']): Badge => ({
  id, barya, test,
  get name() { return L(name[0], name[1]); },
  get desc() { return L(desc[0], desc[1]); },
});

export const BADGES: Badge[] = [
  badge('first', ['Unang Laro', 'First Game'], ['Tapusin ang unang laro mo.', 'Finish your very first game.'], 20, (d) => totalPlays(d) >= 1),
  badge('allGames', ['Laro ng Lahi', 'Heritage Player'], ['Laruin lahat ng laro sa barangay.', 'Play every game in the barangay.'], 80, playedAll),
  badge('star3', ['Tatlong Bituin', 'Three Stars'], ['Makakuha ng ★★★ sa kahit anong laro.', 'Get ★★★ in any game.'], 40, (d) => Object.values(d.stars).some((s) => s >= 3)),
  badge('star3All', ['Bituin ng Barangay', 'Star of the Barangay'], ['Makakuha ng ★★★ sa lahat ng laro.', 'Get ★★★ in every game.'], 300, (d) => Object.keys(STAR_THRESHOLDS).every((id) => (d.stars[id] ?? 0) >= 3)),
  badge('untouched', ['Di Mahuli', 'Untouchable'], ['Tumbang Preso: tapusin nang hindi na-taya.', 'Tumbang Preso: finish without ever getting tagged.'], 40, (_d, f) => is(f, 'tumbangPreso') && f!.feats.includes('untouched') && f!.score >= 20),
  badge('sipa20', ['Paang Bakal', 'Iron Foot'], ['Sipa: 20 sunod-sunod na sipa.', 'Sipa: 20 kicks in a row.'], 50, (_d, f) => is(f, 'sipa') && f!.score >= 20),
  badge('lusot', ['Lusot!', 'Slipped Through!'], ['Patintero: makabalik nang walang nawalang buhay.', 'Patintero: make it there and back without losing a life.'], 50, (_d, f) => is(f, 'patintero') && f!.feats.includes('flawless')),
  badge('multo', ['Multo', 'Ghost'], ['Taguan: hindi ka nakita hanggang dulo.', 'Taguan: stay hidden until time runs out.'], 50, (_d, f) => is(f, 'taguan') && f!.feats.includes('unseen')),
  badge('lawin', ['Mata ng Lawin', 'Hawk Eyes'], ['Taguan: mahanap lahat bilang taya.', 'Taguan: find everyone as the seeker.'], 40, (_d, f) => is(f, 'taguan') && f!.feats.includes('foundAll')),
  badge('diAbot', ['Di Maabot', 'Out of Reach'], ['Langit-Lupa: hindi ka nahuli.', 'Langit-Lupa: never get caught.'], 40, (_d, f) => is(f, 'langitLupa') && f!.won),
  badge('piko3', ['Ballerina ng Kanto', 'Street Ballerina'], ['Piko: ★★★', 'Piko (hopscotch): ★★★'], 50, (_d, f) => is(f, 'piko') && f!.score >= t3('piko')),
  badge('baka3', ['Lundag Kalabaw', 'Carabao Leap'], ['Luksong Baka: ★★★', 'Luksong Baka (leapfrog): ★★★'], 50, (_d, f) => is(f, 'luksongBaka') && f!.score >= t3('luksongBaka')),
  badge('holen3', ['Asintado', 'Sharpshooter'], ['Holen: ★★★', 'Holen (marbles): ★★★'], 50, (_d, f) => is(f, 'holen') && f!.score >= t3('holen')),
  badge('palayok3', ['Bulag pero Bihasa', 'Blind but Brilliant'], ['Pukpok Palayok: ★★★', 'Pukpok Palayok (pot breaking): ★★★'], 50, (_d, f) => is(f, 'pukpokPalayok') && f!.score >= t3('pukpokPalayok')),
  badge('sungka3', ['Hari ng Sungka', 'Sungka Master'], ['Sungka: ★★★', 'Sungka (shell board game): ★★★'], 50, (_d, f) => is(f, 'sungka') && f!.score >= t3('sungka')),
  badge('trumpo3', ['Ikot Pa More', 'Spin Doctor'], ['Trumpo: ★★★', 'Trumpo (spinning top): ★★★'], 50, (_d, f) => is(f, 'trumpo') && f!.score >= t3('trumpo')),
  badge('streak3', ['Tatlong Araw', 'Three-Day Streak'], ['3 araw sunod-sunod na Hamon.', 'Finish the daily challenge 3 days in a row.'], 40, (d) => d.streak >= 3),
  badge('streak7', ['Isang Linggo', 'One-Week Streak'], ['7 araw sunod-sunod na Hamon.', 'Finish the daily challenge 7 days in a row.'], 120, (d) => d.streak >= 7),
  badge('streak30', ['Isang Buwan', 'One-Month Streak'], ['30 araw sunod-sunod na Hamon.', 'Finish the daily challenge 30 days in a row.'], 500, (d) => d.streak >= 30),
  badge('plays50', ['Laging Nasa Kanto', 'Always Outside'], ['Maglaro nang 50 beses.', 'Play 50 games.'], 80, (d) => totalPlays(d) >= 50),
  badge('plays200', ['Tambay ng Taon', 'Regular of the Year'], ['Maglaro nang 200 beses.', 'Play 200 games.'], 250, (d) => totalPlays(d) >= 200),
  badge('mpWin', ['Hari ng Tropa', 'King of the Crew'], ['Manalo sa laro kasama ang tropa.', 'Win a game against your friends.'], 50, (_d, f) => !!f && f.multiplayer && f.won),
  badge('tourWin', ['Kampeon ng Torneo', 'Tournament Champion'], ['Manalo sa Torneo (3 laro).', 'Win a 3-game Tournament.'], 120, (_d, f) => !!f && f.tourWon),
  badge('rival', ['Talo si Karibal', 'Rival Beaten'], ['Talunin ang isang karibal.', 'Beat one of the neighborhood rivals.'], 30, (_d, f) => !!f && f.rivalBeaten),
  badge('rivalMax', ['Wala nang Karibal', 'No Rivals Left'], ['Talunin ang isang karibal sa level 5.', 'Beat a rival at level 5.'], 200, (d) => Object.values(d.rivals).some((l) => l >= RIVAL_MAX)),
  badge('fiesta', ['Fiesta!', 'Fiesta!'], ['Maglaro habang may Fiesta.', 'Play a game during a Fiesta night.'], 30, (_d, f) => !!f && f.event === 'fiesta'),
  badge('dilim', ['Sa Dilim', 'In the Dark'], ['Maglaro ng Taguan habang brownout.', 'Play Taguan (hide and seek) during a brownout.'], 50, (_d, f) => is(f, 'taguan') && f!.event === 'brownout'),
  badge('ulan', ['Basang Sisiw', 'Soaked'], ['Maglaro habang umuulan.', 'Play a game in the rain.'], 30, (_d, f) => !!f && f.event === 'ulan'),
  badge('sorbetes', ['Sorbetero!', 'Ice Cream Run'], ['Abutan ang sorbetero.', 'Catch the sorbetero (ice cream cart).'], 30, (d) => d.sorbetes >= 1),
  badge('shop5', ['Mayaman', 'Big Spender'], ['Bumili ng 5 bagay sa Tindahan.', "Buy 5 things at Aling Nena's store."], 100, (d) => d.owned.length >= 5),
  badge('hari', ['Hari ng Kanto', 'Hari ng Kanto'], ['Abutin ang pinakamataas na ranggo.', 'Reach the highest rank.'], 1000, (d) => rankIndex(d.tropaPoints) >= RANKS.length - 1),
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
  const n1 = names[g1] ?? g1, n2 = names[g2] ?? g2, s2 = STAR_THRESHOLDS[g2][0];
  const quests: Quest[] = [
    (h >>> 12) % 2
      ? { kind: 'plays', goal: plays, text: L(`Maglaro nang ${plays} beses`, `Play ${plays} games`) }
      : { kind: 'variety', goal: variety, text: L(`Maglaro ng ${variety} magkakaibang laro`, `Play ${variety} different games`) },
    { kind: 'stars', gameId: g1, goal: 2, text: L(`Makakuha ng ★★ sa ${n1}`, `Get ★★ in ${n1}`) },
    (h >>> 16) % 2
      ? { kind: 'score', gameId: g2, goal: s2, text: L(`Umabot ng ${s2} puntos sa ${n2}`, `Score ${s2}+ in ${n2}`) }
      : { kind: 'tropa', goal: 150, text: L('Mag-ipon ng 150 Tropa ngayon', 'Earn 150 Tropa today') },
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

export interface Rival {
  name: string;
  readonly taunts: string[];
  readonly lose: string;
  readonly win: string;
}

const rival = (name: string, taunts: [string, string][], lose: [string, string], win: [string, string]): Rival => ({
  name,
  get taunts() { return taunts.map(([f, e]) => L(f, e)); },
  get lose() { return L(lose[0], lose[1]); },
  get win() { return L(win[0], win[1]); },
});

export const RIVALS: Record<string, Rival> = {
  tumbangPreso: rival('Jun-jun', [['Tsinelas mo, pang-bahay lang!', 'Those flip-flops are for indoors only!'], ['Hindi mo matutumba ang lata ko!', "You'll never knock my can over!"]], ['Swerte mo lang yan!', 'Lucky shot, that was!'], ['Hehe, ulit ka na lang!', 'Hehe, better luck next time!']),
  sipa: rival('Bunso', [['Sampu lang? Kaya ko yan nang nakapikit!', 'Only ten? I can do that with my eyes closed!'], ['Sipa pa more!', 'Kick harder!']], ['Huy, ang galing mo pala!', "Whoa, you're actually good!"], ['Pang-baguhan pa lang yan!', 'That was beginner level!']),
  patintero: rival('Totoy', [['Walang lumulusot sa linya ko!', 'Nobody gets past my line!'], ['Bilis mo, pero mas mabilis ako.', "You're fast, but I'm faster."]], ['Paano ka nakalusot?!', 'How did you get through?!'], ['Taya ka na naman!', 'Tagged again!']),
  taguan: rival('Ising', [['Kahit saan ka magtago, kita kita!', "Hide anywhere you like, I'll still find you!"], ['Ako ang reyna ng taguan.', "I'm the queen of hide and seek."]], ['Saan ka nagtago?!', 'Where were you hiding?!'], ['Nakita na kita, hehe.', 'Found you, hehe.']),
  langitLupa: rival('Bebang', [['Langit ka man, maaabot kita!', "Even up high, I'll reach you!"], ['Bilisan mo ang paa mo!', 'Move those feet!']], ['Hay, pagod na ako.', "Phew, I'm tired."], ['Huli ka!', 'Caught you!']),
  piko: rival('Nene', [['Huwag kang tatapak sa linya, ha!', "Don't you dare step on the lines!"], ['Piko queen ako dito.', "I'm the hopscotch queen around here."]], ['Ang ganda ng talon mo!', 'Beautiful hops!'], ['Natapakan mo ang linya!', 'You stepped on the line!']),
  luksongBaka: rival('Kulot', [['Mataas ang baka ko ngayon!', 'My "cow" is extra tall today!'], ['Kaya mo bang lumundag nang ganito?', 'Can you jump this high?']], ['Ang taas ng lundag mo!', 'What a jump!'], ['Bumagsak ka sa baka, hehe.', 'You fell on the cow, hehe.']),
  holen: rival('Dodong', [['Akin lahat ng holen dito!', 'Every marble here is mine!'], ['Tirador ako ng barangay.', "I'm the best shooter in the barangay."]], ['Ubos ang holen ko!', 'You took all my marbles!'], ['Akin na ang holen mo!', 'Your marbles are mine now!']),
  pukpokPalayok: rival('Inday', [['Basagin mo kung kaya mo!', 'Break it if you can!'], ['Mag-ingat ka, baka ulo ko ang tamaan mo!', "Careful, don't hit my head!"]], ['Wow, basag lahat!', 'Wow, you smashed them all!'], ['Mali ang palo mo!', 'You swung at thin air!']),
  sungka: rival('Lola Pacing', [['Bata pa lang ako, naglalaro na ako ng sungka.', "I've played sungka since I was a little girl."], ['Bilangin mo nang mabuti ang sigay, apo.', 'Count your shells carefully, apo.']], ['Aba, ang galing ng apo ko!', "My, what a clever grandchild!"], ['Hehe, may matututunan ka pa, apo.', 'Hehe, still lots to learn, apo.']),
  trumpo: rival('Boyet', [['Ang trumpo ko, hindi tumitigil!', 'My top never stops spinning!'], ['Sugat sa kamay, pero champion!', 'Scraped hands, but a champion!']], ['Ang tagal umikot ng trumpo mo!', 'Your top spun forever!'], ['Tumumba agad, hehe!', 'Fell over already, hehe!']),
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
  /** treat = a drink/snack that boosts the next games' Tropa (used up, not kept). */
  kind: 'slipper' | 'title' | 'treat';
  name: string;
  nameEn?: string;
  price: number;
  /** slipper: [strap, top] colors. */
  colors?: [number, number];
  /** treat: how many games it boosts. */
  games?: number;
  /** treat: swatch color for the menu. */
  tint?: number;
}

/** Tropa multiplier while a treat is active. */
export const TREAT_MULT = 1.25;

export const SHOP: ShopItem[] = [
  { id: 'd-gulaman', kind: 'treat', name: "Sago't Gulaman", nameEn: "Sago't Gulaman (sweet jelly drink)", price: 40, games: 1, tint: 0xc98b4a },
  { id: 'd-softdrinks', kind: 'treat', name: 'Softdrinks', nameEn: 'Soda', price: 100, games: 3, tint: 0x8b1e1e },
  { id: 'd-taho', kind: 'treat', name: 'Taho', nameEn: 'Taho (warm tofu & syrup)', price: 180, games: 6, tint: 0xf3e3c3 },
  { id: 's-itim', kind: 'slipper', name: 'Itim na Tsinelas', nameEn: 'Black Flip-flops', price: 120, colors: [0x1b1b1f, 0x3a3a44] },
  { id: 's-pink', kind: 'slipper', name: 'Pink na Tsinelas', nameEn: 'Pink Flip-flops', price: 150, colors: [0xff4d8d, 0xffa3c4] },
  { id: 's-kahel', kind: 'slipper', name: 'Kahel na Tsinelas', nameEn: 'Orange Flip-flops', price: 150, colors: [0xe8590c, 0xffa94d] },
  { id: 's-puti', kind: 'slipper', name: 'Puting Tsinelas', nameEn: 'White Flip-flops', price: 200, colors: [0xd0d0d0, 0xffffff] },
  { id: 's-army', kind: 'slipper', name: 'Pang-army', nameEn: 'Army Camo', price: 260, colors: [0x4b5320, 0x8a9a5b] },
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
  if (!it) return L('Wala nito sa tindahan.', "The store doesn't sell that.");
  if (it.kind !== 'treat' && d.owned.includes(id)) return L('Nasa iyo na ito.', 'You already have this.');
  if (d.barya < it.price) return L(`Kulang ang Barya mo (${it.price - d.barya} pa).`, `Not enough Barya (${it.price - d.barya} more).`);
  d.barya -= it.price;
  if (it.kind === 'treat') d.boost += it.games ?? 1;
  else d.owned.push(id);
  return null;
}

export const itemName = (it: ShopItem) => L(it.name, it.nameEn ?? it.name);

/** Text shown under your name on lobby name tags: title (if equipped) or rank. */
export function nameTagSub(d: SaveData): string {
  const t = d.title ? shopItem(d.title) : null;
  return t && d.owned.includes(t.id) ? t.name : RANKS[rankIndex(d.tropaPoints)].name;
}

// ================================================================== night events

export type EventId = 'fiesta' | 'brownout' | 'ulan' | 'sorbetero';

export interface NightEvent {
  id: EventId;
  readonly name: string;
  /** Shown in the HUD chip while active. */
  readonly chip: string;
  /** Toast when it starts. */
  readonly start: string;
  /** Tropa multiplier for games finished during it (per game id, '*' = all). */
  mult: Record<string, number>;
}

const ev = (id: EventId, name: [string, string], chip: [string, string], start: [string, string], mult: Record<string, number>): NightEvent => ({
  id, mult,
  get name() { return L(name[0], name[1]); },
  get chip() { return L(chip[0], chip[1]); },
  get start() { return L(start[0], start[1]); },
});

export const EVENTS: Record<EventId, NightEvent> = {
  fiesta: ev('fiesta', ['Fiesta', 'Fiesta'], ['FIESTA: x2 Tropa', 'FIESTA: double Tropa'], ['Fiesta sa barangay! Doble ang Tropa Points!', 'Fiesta in the barangay! Double Tropa Points!'], { '*': 2 }),
  brownout: ev('brownout', ['Brownout', 'Brownout'], ['BROWNOUT: Taguan x2', 'POWER OUT: Taguan x2'], ['Brownout! Perfect sa Taguan. x2 doon!', 'Power outage! Perfect for hide and seek: Taguan pays double!'], { taguan: 2, '*': 1.2 }),
  ulan: ev('ulan', ['Ulan', 'Rain'], ['UMUULAN: x1.5 Tropa', 'RAIN: x1.5 Tropa'], ['Umuulan! Basa pero masaya. x1.5 Tropa!', "It's raining! Wet but fun. x1.5 Tropa!"], { '*': 1.5 }),
  sorbetero: ev('sorbetero', ['Sorbetero', 'Ice Cream Cart'], ['SORBETERO: hanapin siya!', 'ICE CREAM: find the cart!'], ['Ting-ting-ting! May sorbetero! Hanapin mo.', 'Ting-ting-ting! The ice cream man is here. Go find him!'], {}),
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
  /** Stable id (rank tsinelas: Filipino name; shop: item id). */
  id: string;
  name: string;
  strap: number;
  top: number;
  unlocked: boolean;
  /** Why it is locked ("Rank: Corner Regular" / "Store: 150 Barya"). */
  need: string;
}

/** Rank tsinelas first (indices kept stable for old saves), then shop tsinelas. */
export function slipperChoices(d: SaveData): SlipperChoice[] {
  const have = rankIndex(d.tropaPoints);
  return [
    ...SLIPPERS.map((s) => ({
      id: s.id, name: s.name, strap: s.strap, top: s.top, unlocked: s.rank <= have,
      need: L(`Ranggo: ${RANKS[s.rank].name} (${RANKS[s.rank].at} Tropa)`, `Rank: ${RANKS[s.rank].name} (${RANKS[s.rank].at} Tropa)`),
    })),
    ...SHOP.filter((it) => it.kind === 'slipper').map((it) => ({
      id: it.id, name: itemName(it), strap: it.colors![0], top: it.colors![1], unlocked: d.owned.includes(it.id),
      need: L(`Tindahan ni Aling Nena: ${it.price} Barya`, `Aling Nena's store: ${it.price} Barya`),
    })),
  ];
}
