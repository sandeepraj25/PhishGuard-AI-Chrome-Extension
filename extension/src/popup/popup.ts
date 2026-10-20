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

void (async () => {
  const s = await send<Settings>({ type: 'getSettings' });
  ($('rdap') as HTMLInputElement).checked = s.rdapOptIn;
  $('plan').textContent = s.plan === 'pro' ? 'Pro' : 'Free';
  await Promise.all([load(), renderTrusted()]);
})();
