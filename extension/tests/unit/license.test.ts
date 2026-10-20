import { describe, expect, it } from 'vitest';

import { applyValidation, isPro, OFFLINE_GRACE_MS } from '../../src/lib/license';
import type { Settings } from '../../src/lib/types';

const base: Settings = {
  apiBase: '',
  rdapOptIn: false,
  plan: 'free',
  licenseKey: '',
  licenseExpiresAt: '',
  licenseCheckedAt: 0,
};
const now = Date.parse('2026-10-20T00:00:00Z');

describe('plan gating', () => {
  it('free is never pro', () => expect(isPro(base, now)).toBe(false));
  it('pro needs a future server-confirmed expiry and a recent check', () => {
    const pro: Settings = {
      ...base,
      plan: 'pro',
      licenseExpiresAt: '2026-11-20T00:00:00Z',
      licenseCheckedAt: now - 1000,
    };
    expect(isPro(pro, now)).toBe(true);
    expect(isPro({ ...pro, licenseExpiresAt: '2026-10-01T00:00:00Z' }, now)).toBe(false);
    expect(isPro({ ...pro, licenseCheckedAt: now - OFFLINE_GRACE_MS - 1 }, now)).toBe(false); // offline too long
    expect(isPro({ ...pro, licenseExpiresAt: 'garbage' }, now)).toBe(false);
  });
  it('applyValidation: valid -> pro; invalid -> free', () => {
    expect(applyValidation({ valid: true, plan: 'pro', expiresAt: '2026-11-20T00:00:00Z' }, 'PG1.k', now)).toEqual({
      plan: 'pro',
      licenseKey: 'PG1.k',
      licenseExpiresAt: '2026-11-20T00:00:00Z',
      licenseCheckedAt: now,
    });
    expect(applyValidation({ valid: false, reason: 'canceled' }, 'PG1.k', now)).toMatchObject({ plan: 'free' });
  });
});
