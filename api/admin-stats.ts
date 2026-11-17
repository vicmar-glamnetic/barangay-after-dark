import { timingSafeEqual } from 'node:crypto';
import { json, phDay, visitsDb } from './_visits-db.js';

/*
 * GET /api/admin-stats?days=30   header: x-admin-key: <ADMIN_KEY>
 * Visit numbers for the /admin page. ADMIN_KEY is a Vercel env var.
 */

function allowed(given: string): boolean {
  const key = process.env.ADMIN_KEY ?? '';
  if (!key || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<Response> {
  if (!process.env.ADMIN_KEY) return json({ error: 'ADMIN_KEY is not set in Vercel' }, 503);
  if (!allowed(request.headers.get('x-admin-key') ?? '')) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return json({ error: 'wrong key' }, 401);
  }
  const days = Math.max(1, Math.min(365, Number(new URL(request.url).searchParams.get('days')) || 30));
  const today = phDay();
  const from = phDay(new Date(Date.now() - (days - 1) * 86400000));
  try {
    const sql = await visitsDb();
    const daily = await sql`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day, d.visits,
        (SELECT count(*)::int FROM visit_devices v WHERE v.day = d.day) AS visitors
      FROM visit_days d WHERE d.day >= ${from} ORDER BY d.day`;
    const [uniq] = await sql`SELECT count(DISTINCT pid)::int AS n FROM visit_devices WHERE day >= ${from}`;
    const [ever] = await sql`SELECT coalesce(sum(visits), 0)::int AS visits FROM visit_days`;
    const [everUniq] = await sql`SELECT count(DISTINCT pid)::int AS n FROM visit_devices`;
    const facets = await sql`
      SELECT kind, key, sum(n)::int AS n FROM visit_facets WHERE day >= ${from}
      GROUP BY kind, key ORDER BY kind, n DESC`;
    // plays: rows on the online leaderboard this period (players who finished a game online)
    let players = 0;
    try {
      const [p] = await sql`SELECT count(DISTINCT pid)::int AS n FROM best_week WHERE week >= (${from}::date - 6)`;
      players = p?.n ?? 0;
    } catch {
      /* leaderboard tables not created yet */
    }
    return json({ today, from, days, daily, uniqueVisitors: uniq?.n ?? 0, allTime: { visits: ever?.visits ?? 0, visitors: everUniq?.n ?? 0 }, facets, players });
  } catch (e) {
    console.error(e);
    return json({ error: 'server' }, 500);
  }
}
