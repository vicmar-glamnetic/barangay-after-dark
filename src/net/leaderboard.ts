/**
 * Online leaderboard client (see api/scores.ts). Every call fails quietly:
 * offline, local dev without the API, or a blocked request just means no board.
 */
const PID_KEY = 'hnk:pid';

export interface BoardRow {
  name: string;
  score: number;
}

/** Random id for this device (not personal data, just keeps one best score per device). */
export function devicePid(): string {
  try {
    let id = localStorage.getItem(PID_KEY);
    if (!id || !/^[a-z0-9]{12,40}$/.test(id)) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('') + Date.now().toString(36);
      localStorage.setItem(PID_KEY, id);
    }
    return id;
  } catch {
    return 'anon' + Math.random().toString(36).slice(2, 14);
  }
}

const api = () => new URL('api/scores', document.baseURI).toString();

/** Send a score. Resolves to this week's and all-time rank, or null. */
export async function submitScore(game: string, score: number, name: string): Promise<{ week: number | null; all: number | null } | null> {
  if (!(score > 0)) return null;
  try {
    const res = await fetch(api(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pid: devicePid(), game, score: Math.round(score), name }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Top 20 for a game, this week or all time. null = could not load. */
export async function fetchTop(game: string, period: 'week' | 'all'): Promise<BoardRow[] | null> {
  try {
    const res = await fetch(`${api()}?game=${encodeURIComponent(game)}&period=${period}`);
    if (!res.ok) return null;
    const j = await res.json();
    return Array.isArray(j.rows) ? j.rows.map((r: BoardRow) => ({ name: String(r.name), score: Number(r.score) })) : null;
  } catch {
    return null;
  }
}
