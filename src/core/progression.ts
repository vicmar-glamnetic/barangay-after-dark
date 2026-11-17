/**
 * Progression: stars, ranks, daily challenge, tsinelas unlocks.
 * Kept fair on purpose: everything is earned by playing, nothing is bought,
 * and missing a day only resets the streak (no punishment beyond that).
 */

/** Score needed for 1, 2, 3 stars in each game. */
export const STAR_THRESHOLDS: Record<string, [number, number, number]> = {
  tumbangPreso: [10, 25, 40],
  sipa: [5, 12, 25],
  patintero: [25, 80, 140],
  taguan: [25, 75, 140],
  langitLupa: [40, 80, 150],
  piko: [20, 50, 100],
  luksongBaka: [30, 100, 200],
  holen: [20, 40, 70],
  pukpokPalayok: [40, 120, 200],
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
  name: string;
}

export const RANKS: Rank[] = [
  { at: 0, name: 'Bagong Salta' },
  { at: 100, name: 'Batang Kanto' },
  { at: 300, name: 'Tambay' },
  { at: 700, name: 'Laro King' },
  { at: 1500, name: 'Idol ng Barangay' },
  { at: 3000, name: 'Alamat ng Kanto' },
  { at: 6000, name: 'Barangay Legend' },
  { at: 10000, name: 'Hari ng Kanto' },
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

/** Tsinelas colors: [strap, top]. Each unlocks at a rank index. */
export const SLIPPERS: { name: string; strap: number; top: number; rank: number }[] = [
  { name: 'Asul', strap: 0x1f6fb2, top: 0x2f86d6, rank: 0 },
  { name: 'Pula', strap: 0xc62828, top: 0xe85d5d, rank: 1 },
  { name: 'Berde', strap: 0x2a9d8f, top: 0x57cc99, rank: 2 },
  { name: 'Dilaw', strap: 0xf2c230, top: 0xffe066, rank: 3 },
  { name: 'Lila', strap: 0x7b2cbf, top: 0xc77dff, rank: 4 },
  { name: 'Ginto', strap: 0xb8860b, top: 0xffd700, rank: 5 },
  { name: 'Bahaghari', strap: 0xff4d6d, top: 0x4cc9f0, rank: 6 },
  { name: 'Korona', strap: 0x6a0dad, top: 0xffd700, rank: 7 },
];

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
