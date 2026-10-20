/**
 * Teams warning events: queued locally, sent in batches to the organisation's server.
 * An event contains ONLY: time, band, score, impersonated brand id, reason ids, layers and the
 * user's choice. Never the URL or domain of the page (enforced again server-side).
 */
import type { ManagedConfig } from './managed';
import type { Verdict } from './types';

export interface TeamEvent {
  occurredAt: string;
  band: 'caution' | 'warning' | 'blocked';
  score: number;
  brand: string | null;
  reasonIds: string[];
  layers: string[];
  action: 'left' | 'trusted' | 'dismissed' | 'reported' | null;
}

const QUEUE_LIMIT = 500;

export function toEvent(v: Verdict, action: TeamEvent['action'], blocked = false): TeamEvent {
  return {
    occurredAt: new Date().toISOString(),
    band: blocked ? 'blocked' : v.band === 'warning' ? 'warning' : 'caution',
    score: v.score,
    brand: v.brand ? v.brand : null,
    reasonIds: v.reasons.map((r) => r.id).slice(0, 5),
    layers: v.layers.filter((l) => ['url', 'page', 'visual'].includes(l)),
    action,
  };
}

export async function enqueue(e: TeamEvent): Promise<void> {
  const { teamQueue } = await chrome.storage.local.get('teamQueue');
  const q = [...((teamQueue as TeamEvent[] | undefined) ?? []), e].slice(-QUEUE_LIMIT);
  await chrome.storage.local.set({ teamQueue: q });
}

async function deviceId(): Promise<string> {
  const { deviceId: id } = await chrome.storage.local.get('deviceId');
  if (typeof id === 'string') return id;
  const fresh = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  await chrome.storage.local.set({ deviceId: fresh });
  return fresh;
}

/** Sends queued events (max 50 per request). Returns the number sent. */
export async function flush(cfg: ManagedConfig): Promise<number> {
  const { teamQueue } = await chrome.storage.local.get('teamQueue');
  const q = (teamQueue as TeamEvent[] | undefined) ?? [];
  if (!q.length) return 0;
  const batch = q.slice(0, 50).map((e) => (cfg.reportActions ? e : { ...e, action: null }));
  const res = await fetch(`${cfg.apiBase}/v1/teams/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-org-key': cfg.orgKey },
    body: JSON.stringify({ deviceId: await deviceId(), label: cfg.userLabel || undefined, events: batch }),
  });
  if (!res.ok) throw new Error(`teams upload failed: ${res.status}`);
  const { teamQueue: now } = await chrome.storage.local.get('teamQueue');
  await chrome.storage.local.set({ teamQueue: ((now as TeamEvent[] | undefined) ?? []).slice(batch.length) });
  return batch.length;
}
