import type { Message, Settings, Verdict } from '../lib/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const send = <T>(msg: Message) => chrome.runtime.sendMessage(msg) as Promise<T>;

let verdict: Verdict | null = null;

function renderVerdict(v: Verdict | null): void {
  verdict = v;
  if (!v) {
    $('domain').textContent = 'This page is not a website';
    $('verdict').textContent = '';
    ($('trust') as HTMLButtonElement).disabled = true;
    ($('report') as HTMLButtonElement).disabled = true;
    return;
  }
  $('domain').textContent = v.registeredDomain;
  $('meter').setAttribute('aria-valuenow', String(v.score));
  $('meter').setAttribute('aria-label', `Risk score ${v.score} out of 100`);
  const fill = $('fill');
  fill.style.width = `${Math.max(3, v.score)}%`;
  fill.style.background = `var(--${v.band})`;
  const label = { safe: 'Looks safe', caution: 'Be careful', warning: 'Likely phishing' }[v.band];
  $('verdict').textContent = `${label} · risk ${v.score}/100`;
  const ul = $('reasons');
  ul.replaceChildren(
    ...v.reasons.map((r) => {
      const li = document.createElement('li');
      li.textContent = r.text;
      return li;
    }),
  );
  $('trust').textContent = v.trusted ? 'Stop trusting this site' : 'I trust this site';
}

async function renderTrusted(): Promise<void> {
  const list = await send<string[]>({ type: 'listTrusted' });
  $('trusted-count').textContent = String(list.length);
  $('trusted').replaceChildren(
    ...list.map((d) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = d;
      const btn = document.createElement('button');
      btn.textContent = 'Remove';
      btn.setAttribute('aria-label', `Remove ${d} from trusted sites`);
      btn.onclick = async () => {
        await send({ type: 'untrustSite', domain: d });
        await renderTrusted();
        if (verdict?.registeredDomain === d) await load();
      };
      li.append(span, btn);
      return li;
    }),
  );
}

async function load(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const v = tab?.id !== undefined ? await send<Verdict | null>({ type: 'getTabVerdict', tabId: tab.id }) : null;
  renderVerdict(v);
}

$('trust').addEventListener('click', async () => {
  if (!verdict) return;
  await send({ type: verdict.trusted ? 'untrustSite' : 'trustSite', domain: verdict.registeredDomain });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) renderVerdict(await send<Verdict>({ type: 'getVerdict', url: tab.url }));
  await renderTrusted();
});

$('report').addEventListener('click', async () => {
  if (!verdict) return;
  $('status').textContent = `Sending only "${verdict.registeredDomain}" and the score…`;
  const res = await send<{ sent: boolean; reason?: string }>({ type: 'reportMistake', verdict });
  $('status').textContent = res?.sent ? 'Thanks — report sent.' : `Not sent: ${res?.reason ?? 'server unavailable'}`;
});

$('rdap').addEventListener('change', async (e) => {
  await send({ type: 'setSettings', settings: { rdapOptIn: (e.target as HTMLInputElement).checked } });
});

function renderPlan(s: Settings): void {
  const paid = s.plan === 'pro' || s.plan === 'teams';
  const name = s.plan === 'teams' ? 'Teams' : paid ? 'Pro' : 'Free';
  $('plan').textContent = name;
  $('plan-name').textContent = name;
  $('free-actions').hidden = paid;
  $('pro-actions').hidden = !paid;
  ($('upgrade') as HTMLButtonElement).disabled = !s.apiBase;
  if (paid && s.licenseExpiresAt)
    $('plan-detail').textContent = `Active until ${new Date(s.licenseExpiresAt).toLocaleDateString()}.`;
}

$('activate').addEventListener('click', async () => {
  const key = ($('license-key') as HTMLInputElement).value.trim();
  if (!key) return;
  $('license-status').textContent = 'Checking licence…';
  const r = await send<{ valid: boolean; reason?: string }>({ type: 'activateLicense', key });
  $('license-status').textContent = r.valid
    ? 'Pro is active. Thank you!'
    : `Not activated: ${r.reason ?? 'unknown error'}`;
  renderPlan(await send<Settings>({ type: 'getSettings' }));
});

$('deactivate').addEventListener('click', async () => {
  renderPlan(await send<Settings>({ type: 'deactivateLicense' }));
});

$('upgrade').addEventListener('click', async () => {
  const s = await send<Settings>({ type: 'getSettings' });
  if (!s.apiBase) return;
  // Region from the browser language (e.g. "en-IN" -> IN) picks the price tier; no IP lookup.
  const country = (navigator.language.split('-')[1] ?? '').toUpperCase();
  await chrome.tabs.create({ url: `${s.apiBase}/checkout?country=${encodeURIComponent(country)}` });
});

void (async () => {
  const s = await send<Settings>({ type: 'getSettings' });
  ($('rdap') as HTMLInputElement).checked = s.rdapOptIn;
  renderPlan(s);
  await Promise.all([load(), renderTrusted()]);
})();
