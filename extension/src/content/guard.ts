/**
 * Password Moment Guard (content script, all frames).
 * Does nothing while the user just browses. When the user focuses or types in a password /
 * card / OTP field, it asks the service worker for this page's verdict and, if the score is
 * above 30, shows the warning overlay. One overlay per page load at most.
 */
import type { FormGeometry, Message, PageSignals, Verdict } from '../lib/types';
import { collectPageSignals } from './page';
import { eventTarget, isSensitiveField } from './detect';
import { closeOverlay, isOverlayOpen, showOverlay } from './overlay';

const SHOW_ABOVE = 30;
let handled = false; // already asked/decided for this page load
let inFlight = false;

function send<T>(msg: Message): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

async function onSensitive(field: HTMLInputElement): Promise<void> {
  if (handled || inFlight || isOverlayOpen()) return;
  inFlight = true;
  try {
    let page: PageSignals | undefined;
    try {
      page = collectPageSignals(document, location.href);
    } catch {
      page = undefined;
    }
    const box = (field.form ?? field).getBoundingClientRect();
    const form: FormGeometry = {
      rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      viewport: { width: innerWidth, height: innerHeight },
      dpr: devicePixelRatio,
    };
    const v = await send<Verdict | null>({ type: 'getVerdict', url: location.href, page, sensitive: true, form });
    handled = true;
    if (!v || v.score <= SHOW_ABOVE || v.trusted) return;
    document.documentElement.dataset.phishguardShown = String(v.score); // test hook, no secrets
    showOverlay(
      v,
      {
        onLeave: () => void send({ type: 'leaveSite' }),
        onTrust: () => void send({ type: 'trustSite', domain: v.registeredDomain }),
        onDismiss: () => undefined,
        onReport: async () => {
          const res = await send<{ sent: boolean; reason?: string }>({ type: 'reportMistake', verdict: v });
          return res?.sent ? 'Thanks — your report was sent.' : `Not sent: ${res?.reason ?? 'server unavailable'}`;
        },
      },
      field,
    );
  } catch {
    // Extension reloaded or service worker unavailable: fail open, never break the page.
  } finally {
    inFlight = false;
  }
}

function listener(e: Event): void {
  const t = eventTarget(e);
  if (isSensitiveField(t)) void onSensitive(t);
}

document.addEventListener('focusin', listener, true);
document.addEventListener('input', listener, true);
document.addEventListener('keydown', listener, true);

// Single-page apps: a client-side navigation is a new "page" for the guard.
let lastHref = location.href;
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    handled = false;
    closeOverlay();
  }
}, 1000);
