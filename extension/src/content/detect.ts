/**
 * Which form fields count as "sensitive" (password, payment card, OTP/UPI PIN).
 * Uses tagName/attributes instead of `instanceof HTMLInputElement`, so the same code works on the
 * live DOM, inside iframes from other realms, and on jsdom during training.
 */

const CARD_AUTOCOMPLETE = /^(cc-number|cc-csc|cc-exp|cc-exp-month|cc-exp-year)$/;
const CARD_NAME = /(card.?num|cc.?num|credit.?card|debit.?card|cvv|cvc|csc|security.?code|card.?expir)/i;
const SECRET_NAME = /(upi.?pin|mpin|atm.?pin|net.?banking.?pass|one.?time|otp)/i;

export type FieldKind = 'password' | 'card' | 'otp' | null;

export function fieldKind(el: Element | null): FieldKind {
  if (!el || el.tagName !== 'INPUT') return null;
  if (el.hasAttribute('disabled') || el.hasAttribute('readonly')) return null;
  const type = (el.getAttribute('type') ?? 'text').toLowerCase();
  if (type === 'password') return 'password';
  if (!['text', 'tel', 'number', 'search', ''].includes(type)) return null;
  const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase().trim();
  if (CARD_AUTOCOMPLETE.test(ac)) return 'card';
  if (ac === 'one-time-code') return 'otp';
  if (ac === 'current-password' || ac === 'new-password') return 'password';
  const hay = ['name', 'id', 'aria-label', 'placeholder'].map((a) => el.getAttribute(a) ?? '').join(' ');
  if (CARD_NAME.test(hay)) return 'card';
  if (SECRET_NAME.test(hay)) return 'otp';
  return null;
}

export function isSensitiveField(el: Element | null): el is HTMLInputElement {
  return fieldKind(el) !== null;
}

/** The real target of an event, looking through open shadow roots. */
export function eventTarget(e: Event): Element | null {
  const path = e.composedPath();
  const first = path[0] as Element | undefined;
  return first && typeof first.tagName === 'string' ? first : ((e.target as Element | null) ?? null);
}

export function pageHasSensitiveField(root: ParentNode = document): boolean {
  return Array.from(root.querySelectorAll('input')).some((i) => isSensitiveField(i));
}
