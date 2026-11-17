import { json, phDay, visitsDb } from './_visits-db.js';

/*
 * POST /api/track { pid, ref, device, lang }
 * Counts one visit (the game calls this once per browser session).
 */

const clean = (v: unknown, max = 40) => String(v ?? '').toLowerCase().replace(/[^a-z0-9.\-]/g, '').slice(0, max);

/** Group referrers into names people recognise. */
function source(ref: string): string {
  if (!ref) return 'direct';
  if (/(^|\.)(facebook|fb)\.com$|^l\.facebook|^lm\.facebook|^m\.facebook/.test(ref)) return 'facebook';
  if (/messenger\.com$/.test(ref)) return 'messenger';
  if (/instagram\.com$/.test(ref)) return 'instagram';
  if (/(^|\.)t\.co$|twitter\.com$|x\.com$/.test(ref)) return 'x / twitter';
  if (/tiktok\.com$/.test(ref)) return 'tiktok';
  if (/google\./.test(ref)) return 'google';
  if (/reddit\.com$/.test(ref)) return 'reddit';
  if (/haringkanto\.vercel\.app$/.test(ref)) return 'direct';
  return ref.replace(/^www\./, '');
}

export async function POST(request: Request): Promise<Response> {
  let b: Record<string, unknown> = {};
  try {
    b = await request.json();
  } catch {
    /* empty body is fine */
  }
  const pid = String(b.pid ?? '');
  if (!/^[a-z0-9]{12,40}$/.test(pid)) return json({ ok: false }, 400);
  const day = phDay();
  const country = clean(request.headers.get('x-vercel-ip-country') ?? 'unknown', 8) || 'unknown';
  const facets: [string, string][] = [
    ['source', source(clean(b.ref, 80))],
    ['device', b.device === 'mobile' ? 'mobile' : b.device === 'tablet' ? 'tablet' : 'desktop'],
    ['lang', b.lang === 'en' ? 'english' : 'filipino'],
    ['country', country.toUpperCase()],
  ];
  try {
    const sql = await visitsDb();
    await sql`INSERT INTO visit_days (day, visits) VALUES (${day}, 1) ON CONFLICT (day) DO UPDATE SET visits = visit_days.visits + 1`;
    await sql`INSERT INTO visit_devices (day, pid) VALUES (${day}, ${pid}) ON CONFLICT DO NOTHING`;
    for (const [kind, key] of facets)
      await sql`INSERT INTO visit_facets (day, kind, key, n) VALUES (${day}, ${kind}, ${key}, 1)
        ON CONFLICT (day, kind, key) DO UPDATE SET n = visit_facets.n + 1`;
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ ok: false }, 500);
  }
}
