import type { Message } from '../lib/types';

const params = new URLSearchParams(location.search);
const target = params.get('u') ?? '';
const domain = params.get('d') ?? '';
(document.getElementById('domain') as HTMLElement).textContent = domain || 'This site';
document.getElementById('back')?.addEventListener('click', () => {
  if (history.length > 2) history.go(-2);
  else location.href = 'chrome://newtab/';
});
document.getElementById('proceed')?.addEventListener('click', () => {
  if (!/^https?:\/\//i.test(target)) return;
  void chrome.runtime.sendMessage({ type: 'allowOnce', domain, url: target } satisfies Message);
});
(document.getElementById('back') as HTMLButtonElement).focus();
