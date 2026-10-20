/** Which form fields count as "sensitive" (password, payment card, OTP/UPI PIN). */

const CARD_AUTOCOMPLETE = /^(cc-number|cc-csc|cc-exp|cc-exp-month|cc-exp-year)$/;
const CARD_NAME = /(card.?num|cc.?num|credit.?card|debit.?card|cvv|cvc|csc|security.?code|card.?expir)/i;
const SECRET_NAME = /(upi.?pin|mpin|atm.?pin|net.?banking.?pass|one.?time|otp)/i;

export function isSensitiveField(el: Element | null): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.disabled || el.readOnly) return false;
  const type = (el.getAttribute('type') ?? 'text').toLowerCase();
  if (type === 'password') return true;
  if (!['text', 'tel', 'number', 'search', ''].includes(type)) return false;
  const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase().trim();
  if (CARD_AUTOCOMPLETE.test(ac) || ac === 'one-time-code' || ac === 'current-password' || ac === 'new-password')
    return true;
  const hay = `${el.name} ${el.id} ${el.getAttribute('aria-label') ?? ''} ${el.placeholder}`;
  return CARD_NAME.test(hay) || SECRET_NAME.test(hay);
}

/** The real target of an event, looking through open shadow roots. */
export function eventTarget(e: Event): Element | null {
  const path = e.composedPath();
  return (path[0] instanceof Element ? path[0] : (e.target as Element | null)) ?? null;
}

export function pageHasSensitiveField(root: ParentNode = document): boolean {
  return Array.from(root.querySelectorAll('input')).some((i) => isSensitiveField(i));
}
