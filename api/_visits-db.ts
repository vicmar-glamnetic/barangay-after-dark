import { neon } from '@neondatabase/serverless';

/*
 * Visit counter tables (Neon Postgres). Files in /api starting with "_" are
 * helpers, not routes. Tables are created on first use.
 *
 * Privacy: no IP addresses, no names. A visit is counted per browser session;
 * a "visitor" is the random device id the game already uses for the online
 * ranking. Country comes from Vercel's geo header and is stored only as a
 * daily count.
 */

let ready: Promise<void> | null = null;

export async function visitsDb() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = neon(url);
  ready ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS visit_days (day date PRIMARY KEY, visits integer NOT NULL DEFAULT 0)`;
    await sql`CREATE TABLE IF NOT EXISTS visit_devices (day date NOT NULL, pid text NOT NULL, PRIMARY KEY (day, pid))`;
    await sql`CREATE TABLE IF NOT EXISTS visit_facets (
      day date NOT NULL, kind text NOT NULL, key text NOT NULL, n integer NOT NULL DEFAULT 0,
      PRIMARY KEY (day, kind, key))`;
  })().catch((e) => {
    ready = null;
    throw e;
  });
  await ready;
  return sql;
}

/** Today's date in Manila (UTC+8), e.g. "2026-11-18". */
export function phDay(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
