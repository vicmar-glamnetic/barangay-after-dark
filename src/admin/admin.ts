import './admin.css';

/*
 * /admin: visit numbers for Hari ng Kanto (data from /api/admin-stats).
 * The admin key is the ADMIN_KEY env var in Vercel; it is kept only in this
 * tab's sessionStorage.
 */

interface Stats {
  today: string;
  from: string;
  days: number;
  daily: { day: string; visits: number; visitors: number }[];
  uniqueVisitors: number;
  allTime: { visits: number; visitors: number };
  facets: { kind: string; key: string; n: number }[];
  players: number;
}

const KEY = 'hnk-admin-key';
const root = document.getElementById('admin')!;
const api = (p: string) => new URL(`../api/${p}`, document.baseURI).toString();
let range = 30;

const h = (tag: string, cls = '', text = ''): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

function getKey(): string {
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

function login(msg = ''): void {
  root.replaceChildren();
  const card = h('form', 'login');
  card.append(h('div', 'crown', '♛'), h('h1', '', 'Hari ng Kanto Admin'), h('p', 'muted', 'Enter the admin key (ADMIN_KEY in Vercel).'));
  const input = h('input') as HTMLInputElement;
  input.type = 'password';
  input.placeholder = 'Admin key';
  input.autocomplete = 'current-password';
  const btn = h('button', '', 'Open dashboard');
  const err = h('p', 'err', msg);
  card.append(input, btn, err);
  card.addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      sessionStorage.setItem(KEY, input.value.trim());
    } catch {
      /* ignore */
    }
    load();
  });
  root.append(card);
  input.focus();
}

async function load(): Promise<void> {
  const key = getKey();
  if (!key) return login();
  root.replaceChildren(h('p', 'muted center', 'Loading...'));
  let res: Response;
  try {
    res = await fetch(api(`admin-stats?days=${range}`), { headers: { 'x-admin-key': key } });
  } catch {
    return login('Could not reach the server.');
  }
  if (res.status === 401) {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    return login('Wrong key.');
  }
  const data = await res.json().catch(() => ({ error: `Server error (${res.status}).` }));
  if (!res.ok) return login(data.error ?? 'Server error.');
  render(data as Stats);
}

const fmt = (n: number) => n.toLocaleString('en-US');

function render(s: Stats): void {
  root.replaceChildren();
  // header
  const head = h('header');
  const title = h('div');
  title.append(h('h1', '', '♛ Hari ng Kanto'), h('p', 'muted', `Visits · ${s.from} to ${s.today} (Manila time)`));
  const ctl = h('div', 'ctl');
  for (const d of [7, 30, 90]) {
    const b = h('button', d === range ? 'on' : '', `${d} days`);
    b.onclick = () => {
      range = d;
      load();
    };
    ctl.append(b);
  }
  const out = h('button', 'ghost', 'Log out');
  out.onclick = () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    login();
  };
  ctl.append(out);
  head.append(title, ctl);

  // top numbers
  const byDay = new Map(s.daily.map((d) => [d.day, d]));
  const today = byDay.get(s.today) ?? { visits: 0, visitors: 0 };
  const sum = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v += byDay.get(new Date(Date.parse(s.today) - i * 86400000).toISOString().slice(0, 10))?.visits ?? 0;
    return v;
  };
  const tiles = h('section', 'tiles');
  const tile = (label: string, value: number, sub: string) => {
    const t = h('div', 'tile');
    t.append(h('span', 'label', label), h('b', '', fmt(value)), h('small', 'muted', sub));
    tiles.append(t);
  };
  tile('Visits today', today.visits, `${fmt(today.visitors)} unique visitors`);
  tile('Last 7 days', sum(7), 'visits');
  tile(`Last ${s.days} days`, s.daily.reduce((a, d) => a + d.visits, 0), `${fmt(s.uniqueVisitors)} unique visitors`);
  tile('All time', s.allTime.visits, `${fmt(s.allTime.visitors)} unique visitors`);
  tile('Online players', s.players, 'on the leaderboard this period');

  // daily chart (every day in range, zeros included)
  const chart = h('section', 'panel');
  chart.append(h('h2', '', 'Visits per day'));
  const days: { day: string; visits: number; visitors: number }[] = [];
  for (let i = s.days - 1; i >= 0; i--) {
    const day = new Date(Date.parse(s.today) - i * 86400000).toISOString().slice(0, 10);
    days.push(byDay.get(day) ?? { day, visits: 0, visitors: 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.visits));
  const bars = h('div', 'bars');
  for (const d of days) {
    const col = h('div', 'col');
    col.title = `${d.day}: ${d.visits} visits, ${d.visitors} visitors`;
    const v = h('i', 'v');
    v.style.height = `${(d.visits / max) * 100}%`;
    const u = h('i', 'u');
    u.style.height = `${(d.visitors / max) * 100}%`;
    col.append(v, u);
    bars.append(col);
  }
  const axis = h('div', 'axis');
  axis.append(h('span', '', days[0].day.slice(5)), h('span', '', `max ${fmt(max)}`), h('span', '', days[days.length - 1].day.slice(5)));
  const legend = h('div', 'legend');
  legend.append(h('span', 'lv', 'Visits'), h('span', 'lu', 'Unique visitors'));
  chart.append(bars, axis, legend);

  // breakdowns
  const grid = h('section', 'grid');
  const names: Record<string, string> = { source: 'Where they came from', device: 'Device', country: 'Country', lang: 'Language' };
  for (const kind of ['source', 'device', 'country', 'lang']) {
    const rows = s.facets.filter((f) => f.kind === kind).slice(0, 8);
    const total = rows.reduce((a, r) => a + r.n, 0) || 1;
    const p = h('div', 'panel');
    p.append(h('h2', '', names[kind]));
    if (!rows.length) p.append(h('p', 'muted', 'No data yet.'));
    for (const r of rows) {
      const row = h('div', 'row');
      const bar = h('i');
      bar.style.width = `${(r.n / total) * 100}%`;
      row.append(h('span', '', r.key), bar, h('b', '', `${fmt(r.n)} · ${Math.round((r.n / total) * 100)}%`));
      p.append(row);
    }
    grid.append(p);
  }

  const note = h('p', 'muted foot', 'A visit = one browser session. Unique visitor = one device (random id, no names or IPs stored).');
  root.append(head, tiles, chart, grid, note);
}

load();
