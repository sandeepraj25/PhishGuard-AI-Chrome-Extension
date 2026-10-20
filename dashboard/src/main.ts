import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './style.css';

interface Summary {
  org: { name: string; seats: number; devices: number };
  weeks: string[];
  perUser: { user: string; counts: number[]; total: number }[];
  topBrands: { brand: string; name: string; count: number }[];
  totals: { events: number; caution: number; warning: number; blocked: number; left: number; trusted: number; dismissed: number; reported: number };
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const KEY = 'pg-dashboard-token';
const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

function tokenGet(): string {
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}
function tokenSet(v: string | null): void {
  try {
    if (v) sessionStorage.setItem(KEY, v);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: token lives only in memory for this page */
  }
}

const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

function heatClass(n: number, max: number): string {
  if (n === 0) return 'h0';
  return `h${Math.min(4, Math.ceil((n / Math.max(1, max)) * 4))}`;
}

function render(s: Summary): void {
  $('org-name').textContent = s.org.name;
  $('range').textContent = `${fmtDay(s.weeks[0])} to ${fmtDay(s.weeks[s.weeks.length - 1])} (week starting), ${s.org.devices} of ${s.org.seats} seats in use`;
  const t = s.totals;
  const headline = $('headline');
  headline.replaceChildren();
  if (t.events === 0) {
    headline.textContent = 'No warnings in this period. Once browsers enrol with your organisation key, warnings appear here.';
  } else {
    const leftPct = Math.round((100 * t.left) / t.events);
    headline.append(
      'PhishGuard warned your team ',
      el('strong', String(t.events)),
      ` times in ${s.weeks.length} weeks. People left the site after ${leftPct}% of warnings`,
      t.blocked ? `, and ${t.blocked} known phishing pages were blocked outright.` : '.',
    );
  }

  const max = Math.max(0, ...s.perUser.flatMap((u) => u.counts));
  const table = $('heatmap') as HTMLTableElement;
  table.replaceChildren();
  const cap = el('caption', 'Warnings per person and week. Darker cells mean more warnings.');
  cap.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
  const head = el('tr');
  head.append(el('th', ''));
  for (const w of s.weeks) {
    const th = el('th', fmtDay(w));
    th.scope = 'col';
    head.append(th);
  }
  const totalTh = el('th', 'Total');
  totalTh.scope = 'col';
  head.append(totalTh);
  const thead = el('thead');
  thead.append(head);
  const tbody = el('tbody');
  for (const u of s.perUser) {
    const tr = el('tr');
    const th = el('th', u.user);
    th.scope = 'row';
    tr.append(th);
    u.counts.forEach((n, i) => {
      // Empty cell for zero keeps the eye on the weeks that matter; the label keeps it accessible.
      const td = el('td', n ? String(n) : '', heatClass(n, max));
      td.title = `${u.user}: ${n} warning${n === 1 ? '' : 's'} in the week of ${fmtDay(s.weeks[i])}`;
      td.setAttribute('aria-label', td.title);
      tr.append(td);
    });
    tr.append(el('td', String(u.total), 'total'));
    tbody.append(tr);
  }
  table.append(cap, thead, tbody);

  const bmax = Math.max(1, ...s.topBrands.map((b) => b.count));
  $('brands').replaceChildren(
    ...s.topBrands.map((b) => {
      const li = el('li');
      const bar = el('span', undefined, 'bar');
      bar.style.width = `${(100 * b.count) / bmax}%`;
      li.append(el('span', b.name), el('span', String(b.count)), bar);
      return li;
    }),
  );

  const parts: [string, number, string][] = [
    ['Left the site', t.left, 'var(--teal)'],
    ['Reported a mistake', t.reported, 'var(--h2)'],
    ['Continued anyway', t.dismissed, 'var(--h4)'],
    ['Trusted the site', t.trusted, 'var(--muted)'],
  ];
  const total = Math.max(1, parts.reduce((a, p) => a + p[1], 0));
  const stack = $('actions');
  stack.setAttribute('aria-label', parts.map(([l, n]) => `${l}: ${n}`).join(', '));
  stack.replaceChildren(
    ...parts.map(([, n, c]) => {
      const sp = el('span');
      sp.style.cssText = `width:${(100 * n) / total}%;background:${c}`;
      return sp;
    }),
  );
  $('actions-legend').replaceChildren(
    ...parts.map(([l, n, c]) => {
      const li = el('li');
      const i = el('i');
      i.style.background = c;
      li.append(i, `${l}: ${n}`);
      return li;
    }),
  );
}

async function load(token: string): Promise<boolean> {
  const res = await fetch(`${API}/v1/teams/summary?weeks=8`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401) return false;
  if (!res.ok) throw new Error(`server error ${res.status}`);
  render((await res.json()) as Summary);
  $('signin').hidden = true;
  $('board').hidden = false;
  return true;
}

$('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = ($('token') as HTMLInputElement).value.trim();
  $('signin-error').textContent = '';
  try {
    if (await load(token)) tokenSet(token);
    else $('signin-error').textContent = 'That token was not recognised. Check it and try again.';
  } catch (err) {
    $('signin-error').textContent = `Could not reach the server (${String(err)}).`;
  }
});

$('signout').addEventListener('click', () => {
  tokenSet(null);
  $('board').hidden = true;
  $('signin').hidden = false;
});

void (async () => {
  const saved = tokenGet();
  if (saved && (await load(saved).catch(() => false))) return;
  $('signin').hidden = false;
})();
