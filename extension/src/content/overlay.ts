/**
 * The "Password Moment" warning overlay. Rendered inside a Shadow DOM so the page's CSS cannot
 * restyle or hide it, with dialog semantics for screen readers:
 *  role="alertdialog", aria-modal, labelled + described, focus moved in and trapped, Esc closes.
 */
import type { Verdict } from '../lib/types';

export interface OverlayActions {
  onLeave(): void;
  onTrust(): void;
  onReport(): Promise<string>;
  onDismiss(): void;
}

const HOST_ID = 'phishguard-overlay-host';

const CSS = `
:host { all: initial; }
.backdrop { position: fixed; inset: 0; background: rgba(16, 24, 40, .55); z-index: 2147483647;
  display: flex; align-items: center; justify-content: center; padding: 16px;
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif; }
.card { background: #fff; color: #101828; max-width: 440px; width: 100%; border-radius: 14px;
  box-shadow: 0 20px 48px rgba(0,0,0,.3); overflow: hidden; }
.head { padding: 18px 20px 12px; display: flex; gap: 12px; align-items: flex-start; }
.head.warning { background: #fef3f2; border-bottom: 1px solid #fecdca; }
.head.caution { background: #fffaeb; border-bottom: 1px solid #fedf89; }
.icon { flex: none; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center;
  font-weight: 700; color: #fff; font-size: 20px; }
.warning .icon { background: #d92d20; } .caution .icon { background: #dc6803; }
h2 { margin: 0; font-size: 18px; line-height: 1.3; }
.score { margin-top: 4px; font-size: 13px; color: #475467; }
.body { padding: 14px 20px 6px; }
.body p { margin: 0 0 8px; }
ul { margin: 0 0 8px; padding-left: 20px; } li { margin: 4px 0; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 20px 18px; }
button { font: inherit; border-radius: 8px; padding: 9px 14px; cursor: pointer; border: 1px solid #d0d5dd;
  background: #fff; color: #344054; }
button.primary { background: #d92d20; border-color: #d92d20; color: #fff; font-weight: 600; }
.caution button.primary { background: #344054; border-color: #344054; }
button:focus-visible { outline: 3px solid #2e90fa; outline-offset: 2px; }
.status { font-size: 13px; color: #475467; padding: 0 20px 14px; min-height: 1em; }
@media (prefers-color-scheme: dark) {
  .card { background: #1d2939; color: #f2f4f7; }
  .head.warning { background: #55160c; border-color: #7a271a; }
  .head.caution { background: #4e1d09; border-color: #93370d; }
  .score, .status { color: #d0d5dd; }
  button { background: #344054; color: #f2f4f7; border-color: #475467; }
}
@media (prefers-reduced-motion: no-preference) { .card { animation: pop .14s ease-out; }
  @keyframes pop { from { transform: scale(.97); opacity: 0; } to { transform: none; opacity: 1; } } }
`;

let current: { host: HTMLElement; observer: MutationObserver; onKey: (e: KeyboardEvent) => void } | null = null;

export function isOverlayOpen(): boolean {
  return current !== null;
}

export function closeOverlay(): void {
  if (!current) return;
  current.observer.disconnect();
  document.removeEventListener('keydown', current.onKey, true);
  current.host.remove();
  current = null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text; // textContent only: reasons can contain page-derived text
  return e;
}

export function showOverlay(v: Verdict, actions: OverlayActions, returnFocus: HTMLElement | null): void {
  closeOverlay();
  const host = el('div', { id: HOST_ID });
  const root = host.attachShadow({ mode: 'open' });
  const style = el('style');
  style.textContent = CSS;
  root.append(style);

  const warning = v.band === 'warning';
  const backdrop = el('div', { class: 'backdrop' });
  const card = el('div', {
    class: 'card',
    role: 'alertdialog',
    'aria-modal': 'true',
    'aria-labelledby': 'pg-title',
    'aria-describedby': 'pg-desc',
    'data-testid': 'phishguard-overlay',
    'data-band': v.band,
  });
  const head = el('div', { class: `head ${v.band}` });
  head.append(el('div', { class: 'icon', 'aria-hidden': 'true' }, '!'));
  const titles = el('div');
  titles.append(
    el('h2', { id: 'pg-title' }, warning ? 'Stop — this may be a fake site' : 'Be careful before typing here'),
    el(
      'div',
      { class: 'score', 'data-testid': 'phishguard-score' },
      `Risk score ${v.score}/100 · ${v.registeredDomain}`,
    ),
  );
  head.append(titles);

  const body = el('div', { class: 'body', id: 'pg-desc' });
  body.append(
    el(
      'p',
      {},
      warning
        ? 'Do not enter your password or card details unless you are sure this is the real site.'
        : 'Some things about this site look unusual. Check the address before you continue.',
    ),
  );
  const list = el('ul', { 'data-testid': 'phishguard-reasons' });
  for (const r of v.reasons.slice(0, 3)) list.append(el('li', { 'data-reason': r.id }, r.text));
  body.append(list);

  const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const btnLeave = el('button', { class: 'primary', type: 'button', 'data-action': 'leave' }, 'Leave this site');
  const btnTrust = el('button', { type: 'button', 'data-action': 'trust' }, 'I trust this site');
  const btnReport = el('button', { type: 'button', 'data-action': 'report' }, 'Report mistake');
  const btnClose = el('button', { type: 'button', 'data-action': 'dismiss' }, 'Continue anyway');
  const actionsRow = el('div', { class: 'actions' });
  actionsRow.append(btnLeave, btnTrust, btnReport, btnClose);
  card.append(head, body, actionsRow, status);
  backdrop.append(card);
  root.append(backdrop);

  const finish = (fn: () => void) => {
    closeOverlay();
    fn();
    returnFocus?.focus({ preventScroll: true });
  };
  btnLeave.addEventListener('click', () => finish(actions.onLeave));
  btnTrust.addEventListener('click', () => finish(actions.onTrust));
  btnClose.addEventListener('click', () => finish(actions.onDismiss));
  btnReport.addEventListener('click', () => {
    btnReport.disabled = true;
    status.textContent = `Sending only the site name (${v.registeredDomain}) and the score…`;
    void actions.onReport().then((msg) => (status.textContent = msg));
  });

  // Focus trap + Escape. Capture phase so the page cannot swallow the keys.
  const focusables = () => [btnLeave, btnTrust, btnReport, btnClose].filter((b) => !b.disabled);
  const onKey = (e: KeyboardEvent) => {
    if (!isOverlayOpen()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(actions.onDismiss);
    } else if (e.key === 'Tab') {
      const items = focusables();
      const idx = items.indexOf(root.activeElement as HTMLButtonElement);
      e.preventDefault();
      e.stopPropagation();
      const next = (idx + (e.shiftKey ? -1 : 1) + items.length) % items.length;
      items[next].focus();
    } else if (!(root.activeElement instanceof HTMLButtonElement)) {
      // Keep keystrokes out of the page's password field while the dialog is open.
      e.stopPropagation();
    }
  };
  document.addEventListener('keydown', onKey, true);
  (document.body ?? document.documentElement).append(host);
  (warning ? btnLeave : btnClose).focus();

  // A phishing page could try to remove our overlay; put it back while it is supposed to be open.
  const observer = new MutationObserver(() => {
    if (current?.host === host && !host.isConnected) (document.body ?? document.documentElement).append(host);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  current = { host, observer, onKey };
}
