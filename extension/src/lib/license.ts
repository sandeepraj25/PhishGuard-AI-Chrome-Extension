/**
 * Plan gating. Free: Layer 1 (URL model) + Password Guard + reasons + regional brands.
 * Pro/Teams: also Layer 2 (page) and Layer 3 (visual).
 * The backend validates keys (signature + subscription status). The extension caches the result:
 * it stays Pro until the server-confirmed expiry, and keeps working offline for up to
 * OFFLINE_GRACE_MS after the last successful check. (A determined user can edit local storage —
 * client-side gating can never be tamper-proof; the valuable parts are server-side.)
 */
import type { Settings } from './types';

export const OFFLINE_GRACE_MS = 14 * 86_400_000;

export function isPro(s: Settings, now = Date.now()): boolean {
  if (s.plan !== 'pro' && s.plan !== 'teams') return false;
  const exp = Date.parse(s.licenseExpiresAt);
  return Number.isFinite(exp) && exp > now && now - s.licenseCheckedAt < OFFLINE_GRACE_MS;
}

export interface ValidateResponse {
  valid: boolean;
  plan?: 'pro' | 'teams';
  expiresAt?: string;
  reason?: string;
}

export async function validateLicense(apiBase: string, key: string): Promise<ValidateResponse> {
  const res = await fetch(`${apiBase}/v1/license/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  if (!res.ok && res.status !== 400) throw new Error(`license server error ${res.status}`);
  return (await res.json()) as ValidateResponse;
}

/** Settings patch after a validation attempt. Network errors keep the cached state. */
export function applyValidation(r: ValidateResponse, key: string, now = Date.now()): Partial<Settings> {
  if (r.valid && r.plan && r.expiresAt) {
    return { plan: r.plan, licenseKey: key, licenseExpiresAt: r.expiresAt, licenseCheckedAt: now };
  }
  return { plan: 'free', licenseExpiresAt: '', licenseCheckedAt: now };
}
