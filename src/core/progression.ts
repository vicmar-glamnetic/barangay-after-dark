/**
 * Progression: stars, ranks, daily challenge, tsinelas unlocks.
 * Kept fair on purpose: everything is earned by playing, nothing is bought,
 * and missing a day only resets the streak (no punishment beyond that).
 */

import { L } from './i18n';

/** Score needed for 1, 2, 3 stars in each game. */
export const STAR_THRESHOLDS: Record<string, [number, number, number]> = {
  tumbangPreso: [10, 25, 40],
  sipa: [5, 12, 25],
  patintero: [25, 80, 140],
  taguan: [25, 75, 140],
  langitLupa: [40, 80, 150],
  piko: [25, 70, 140],
  luksongBaka: [30, 100, 200],
  holen: [20, 40, 70],
  pukpokPalayok: [40, 120, 200],
  sungka: [35, 50, 62],
  trumpo: [60, 130, 220],
};

export function starsFor(gameId: string, score: number): number {
  const t = STAR_THRESHOLDS[gameId];
  if (!t) return 0;
  return score >= t[2] ? 3 : score >= t[1] ? 2 : score >= t[0] ? 1 : 0;
}

/** Points still needed for the next star (null when already 3 stars). */
export function nextStarGap(gameId: string, score: number): { stars: number; gap: number } | null {
  const t = STAR_THRESHOLDS[gameId];
  if (!t) return null;
  for (let i = 0; i < 3; i++) if (score < t[i]) return { stars: i + 1, gap: t[i] - score };
  return null;
}

export const starText = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

export interface Rank {
  at: number;
  /** Name in the current language. */
  readonly name: string;
}

const rank = (at: number, fil: string, en: string): Rank => ({ at, get name() { return L(fil, en); } });

export const RANKS: Rank[] = [
  rank(0, 'Bagong Salta', 'New Kid on the Block'),
  rank(100, 'Batang Kanto', 'Street Kid'),
  rank(300, 'Tambay', 'Corner Regular'),
  rank(700, 'Laro King', 'Game King'),
  rank(1500, 'Idol ng Barangay', 'Neighborhood Idol'),
  rank(3000, 'Alamat ng Kanto', 'Street Legend'),
  rank(6000, 'Barangay Legend', 'Barangay Legend'),
  rank(10000, 'Hari ng Kanto', 'Hari ng Kanto (King of the Street)'),
];

export function rankIndex(points: number): number {
  let i = 0;
  while (i + 1 < RANKS.length && points >= RANKS[i + 1].at) i++;
  return i;
}

export function rankFor(points: number): Rank {
  return RANKS[rankIndex(points)];
}

export function nextRank(points: number): Rank | null {
  return RANKS[rankIndex(points) + 1] ?? null;
}

/** Tsinelas colors: [strap, top]. Each unlocks at a rank index. `id` is the stable Filipino name. */
export const SLIPPERS: { id: string; readonly name: string; strap: number; top: number; rank: number }[] = [
  ['Asul', 'Blue', 0x1f6fb2, 0x2f86d6, 0],
  ['Pula', 'Red', 0xc62828, 0xe85d5d, 1],
  ['Berde', 'Green', 0x2a9d8f, 0x57cc99, 2],
  ['Dilaw', 'Yellow', 0xf2c230, 0xffe066, 3],
  ['Lila', 'Purple', 0x7b2cbf, 0xc77dff, 4],
  ['Ginto', 'Gold', 0xb8860b, 0xffd700, 5],
  ['Bahaghari', 'Rainbow', 0xff4d6d, 0x4cc9f0, 6],
  ['Korona', 'Crown', 0x6a0dad, 0xffd700, 7],
].map(([fil, en, strap, top, rank]) => ({ id: fil as string, get name() { return L(fil as string, en as string); }, strap: strap as number, top: top as number, rank: rank as number }));

/** Local calendar day, e.g. "2026-11-17". */
export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return today(d);
}

/** Today's challenge: one game, reach its 2-star score. Same for everyone on the same date. */
export function dailyChallenge(gameIds: string[], date = today()): { gameId: string; target: number } {
  let h = 2166136261;
  for (let i = 0; i < date.length; i++) h = Math.imul(h ^ date.charCodeAt(i), 16777619);
  const pool = gameIds.filter((id) => STAR_THRESHOLDS[id]);
  const gameId = pool[Math.abs(h) % pool.length];
  return { gameId, target: STAR_THRESHOLDS[gameId][1] };
}

/** Bonus Tropa Points for the daily challenge: grows with the streak, capped. */
export const dailyReward = (streak: number) => Math.min(150, 50 + streak * 10);
