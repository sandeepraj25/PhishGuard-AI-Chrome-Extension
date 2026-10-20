/**
 * Signed licence keys: "PG1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>".
 * The extension never verifies the signature itself (that would ship the secret); it asks the
 * backend (/v1/license/validate), which checks the signature AND the subscription status
 * (so cancelled subscriptions stop working).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface LicensePayload {
  lid: string;
  plan: 'pro' | 'teams';
  exp: number; // unix seconds; refreshed on renewal (validate returns the DB expiry)
  seats?: number;
  org?: string;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sign = (data: string, secret: string) => createHmac('sha256', secret).update(data).digest();

export function issueLicense(p: LicensePayload, secret: string): string {
  if (secret.length < 32) throw new Error('LICENSE_SIGNING_SECRET must be at least 32 characters');
  const body = `PG1.${b64url(JSON.stringify(p))}`;
  return `${body}.${b64url(sign(body, secret))}`;
}

export type VerifyResult = { ok: true; payload: LicensePayload } | { ok: false; reason: 'format' | 'signature' };

export function verifyLicense(key: string, secret: string): VerifyResult {
  const parts = key.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'PG1') return { ok: false, reason: 'format' };
  const body = `${parts[0]}.${parts[1]}`;
  const want = sign(body, secret);
  let got: Buffer;
  try {
    got = Buffer.from(parts[2], 'base64url');
  } catch {
    return { ok: false, reason: 'format' };
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: 'signature' };
  try {
    return { ok: true, payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as LicensePayload };
  } catch {
    return { ok: false, reason: 'format' };
  }
}

export const newId = (bytes = 12) => randomBytes(bytes).toString('base64url');

/**
 * Paddle Billing webhook signature: header "Paddle-Signature: ts=<unix>;h1=<hex hmac>" where
 * h1 = HMAC-SHA256(secret, `${ts}:${rawBody}`). Reject if older than `toleranceSec` (replay).
 */
export function verifyPaddleSignature(
  header: string | undefined,
  rawBody: string,
  secret: string,
  nowSec: number,
  toleranceSec = 300,
): boolean {
  if (!header || !secret) return false;
  const fields = Object.fromEntries(header.split(';').map((kv) => kv.split('=') as [string, string]));
  const ts = Number(fields.ts);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec || !fields.h1) return false;
  const want = createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex');
  const got = fields.h1;
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
