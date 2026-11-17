import { neon } from '@neondatabase/serverless';

/*
 * Online leaderboard for Hari ng Kanto (Vercel Function + Neon Postgres).
 *
 *   GET  /api/scores?game=sipa&period=week|all  -> { rows: [{ name, score }] } top 20
 *   POST /api/scores { pid, name, game, score } -> { week: rank, all: rank }
 *
 * One row per device (pid) per game keeps only the best score, so nobody can
 * flood the board. Weekly boards reset every Monday (Manila time).
 * Tables are created automatically on first use (same as api/schema.sql).
 * Needs DATABASE_URL (or POSTGRES_URL, set by Vercel's Neon integration).
 *
 * Scores are reported by the browser, so a determined cheater could fake one.
 * Caps per game below keep the obvious junk out.
 */

const MAX: Record<string, number> = {
  tumbangPreso: 300, sipa: 1500, patintero: 400, taguan: 300, langitLupa: 2000,
  piko: 2000, luksongBaka: 4000, holen: 1000, pukpokPalayok: 2000,
};

const json = (body: unknown, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } });

const cleanName = (raw: unknown) =>
  String(raw ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 14) || 'Tropa';

/** Monday of this week in Manila (UTC+8), e.g. "2026-11-16". */
function weekKey(now = new Date()): string {
  const ph = new Date(now.getTime() + 8 * 3600 * 1000);
  const day = (ph.getUTCDay() + 6) % 7; // 0 = Monday
  ph.setUTCDate(ph.getUTCDate() - day);
  return ph.toISOString().slice(0, 10);
}

let ready: Promise<void> | null = null;

/** Neon client; creates the tables on the first call of each cold start (see api/schema.sql). */
async function db() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = neon(url);
  ready ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS best_all (
      pid text NOT NULL, game text NOT NULL, name text NOT NULL, score integer NOT NULL CHECK (score > 0),
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (pid, game))`;
    await sql`CREATE INDEX IF NOT EXISTS best_all_top ON best_all (game, score DESC, updated_at)`;
    await sql`CREATE TABLE IF NOT EXISTS best_week (
      pid text NOT NULL, game text NOT NULL, week date NOT NULL, name text NOT NULL, score integer NOT NULL CHECK (score > 0),
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (pid, game, week))`;
    await sql`CREATE INDEX IF NOT EXISTS best_week_top ON best_week (game, week, score DESC, updated_at)`;
  })().catch((e) => {
    ready = null; // retry on the next request
    throw e;
  });
  await ready;
  return sql;
}

export async function GET(request: Request): Promise<Response> {
  const u = new URL(request.url);
  const game = u.searchParams.get('game') ?? '';
  const period = u.searchParams.get('period') === 'all' ? 'all' : 'week';
  if (!MAX[game]) return json({ error: 'unknown game' }, 400);
  try {
    const sql = await db();
    const rows =
      period === 'all'
        ? await sql`SELECT name, score FROM best_all WHERE game = ${game} ORDER BY score DESC, updated_at ASC LIMIT 20`
        : await sql`SELECT name, score FROM best_week WHERE game = ${game} AND week = ${weekKey()} ORDER BY score DESC, updated_at ASC LIMIT 20`;
    return json({ rows, week: weekKey() }, 200, 'public, max-age=15, s-maxage=15');
  } catch (e) {
    console.error(e);
    return json({ error: 'server' }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  let b: Record<string, unknown>;
  try {
    b = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const game = String(b.game ?? '');
  const pid = String(b.pid ?? '');
  const score = Number(b.score);
  if (!MAX[game]) return json({ error: 'unknown game' }, 400);
  if (!/^[a-z0-9]{12,40}$/.test(pid)) return json({ error: 'bad pid' }, 400);
  if (!Number.isInteger(score) || score <= 0 || score > MAX[game]) return json({ error: 'bad score' }, 400);
  const name = cleanName(b.name);
  const week = weekKey();
  try {
    const sql = await db();
    await sql`
      INSERT INTO best_all (pid, game, name, score, updated_at) VALUES (${pid}, ${game}, ${name}, ${score}, now())
      ON CONFLICT (pid, game) DO UPDATE SET
        name = EXCLUDED.name,
        score = GREATEST(best_all.score, EXCLUDED.score),
        updated_at = CASE WHEN EXCLUDED.score > best_all.score THEN now() ELSE best_all.updated_at END`;
    await sql`
      INSERT INTO best_week (pid, game, week, name, score, updated_at) VALUES (${pid}, ${game}, ${week}, ${name}, ${score}, now())
      ON CONFLICT (pid, game, week) DO UPDATE SET
        name = EXCLUDED.name,
        score = GREATEST(best_week.score, EXCLUDED.score),
        updated_at = CASE WHEN EXCLUDED.score > best_week.score THEN now() ELSE best_week.updated_at END`;
    const [w] = await sql`
      SELECT 1 + count(*)::int AS rank FROM best_week
      WHERE game = ${game} AND week = ${week}
        AND score > (SELECT score FROM best_week WHERE pid = ${pid} AND game = ${game} AND week = ${week})`;
    const [a] = await sql`
      SELECT 1 + count(*)::int AS rank FROM best_all
      WHERE game = ${game} AND score > (SELECT score FROM best_all WHERE pid = ${pid} AND game = ${game})`;
    return json({ week: w?.rank ?? null, all: a?.rank ?? null });
  } catch (e) {
    console.error(e);
    return json({ error: 'server' }, 500);
  }
}
