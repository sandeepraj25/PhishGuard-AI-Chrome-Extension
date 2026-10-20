/**
 * Backend client. PRIVACY CONTRACT (docs/privacy.md):
 *  - checkPrefix sends ONLY the first 4 bytes of SHA-256(registered domain).
 *  - report is sent only when the user clicks "Report mistake" and contains the registered
 *    domain, score and reason ids — never the full URL, page content or history.
 *  - fetchBloom downloads the public list; it sends nothing about the user.
 */
import type { Reason } from './types';

async function withTimeout<T>(p: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await p(ctl.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function checkPrefix(apiBase: string, prefix: string): Promise<string[]> {
  return withTimeout(async (signal) => {
    const res = await fetch(`${apiBase}/v1/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes: [prefix] }),
      signal,
    });
    if (!res.ok) throw new Error(`check failed: ${res.status}`);
    const body = (await res.json()) as { matches: Record<string, string[]> };
    return body.matches[prefix] ?? [];
  }, 2000);
}

export interface ReportPayload {
  registeredDomain: string;
  kind: 'false_positive' | 'false_negative';
  score: number;
  reasonIds: string[];
  modelVersion: string;
  extensionVersion: string;
  comment?: string;
}

export async function sendReport(apiBase: string, payload: ReportPayload): Promise<boolean> {
  return withTimeout(async (signal) => {
    const res = await fetch(`${apiBase}/v1/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    return res.ok;
  }, 4000);
}

export async function fetchBloom(apiBase: string, etag: string): Promise<{ bytes: Uint8Array; etag: string } | null> {
  return withTimeout(async (signal) => {
    const res = await fetch(`${apiBase}/v1/bloom`, { headers: etag ? { 'if-none-match': etag } : {}, signal });
    if (res.status === 304) return null;
    if (!res.ok) throw new Error(`bloom download failed: ${res.status}`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), etag: res.headers.get('etag') ?? '' };
  }, 10000);
}

export const reasonIds = (reasons: Reason[]): string[] => reasons.map((r) => r.id);
