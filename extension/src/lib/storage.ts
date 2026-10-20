/**
 * chrome.storage wrappers. The service worker can be stopped at any time, so every piece of
 * state that must survive lives here, never in module-level variables (except caches that
 * can be rebuilt).
 *   local   : settings, trusted list, hashed "seen before" domains, downloaded Bloom filter
 *   session : per-tab verdicts, one-time "proceed anyway" allowances (cleared on browser exit)
 */
import { DEFAULT_API_BASE } from './config';
import type { Settings, Verdict } from './types';

const DEFAULT_SETTINGS: Settings = { apiBase: DEFAULT_API_BASE, rdapOptIn: false, plan: 'free', licenseKey: '' };
const SEEN_LIMIT = 5000;

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings> | undefined) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function getTrusted(): Promise<string[]> {
  const { trusted } = await chrome.storage.local.get('trusted');
  return (trusted as string[] | undefined) ?? [];
}

export async function setTrusted(domain: string, on: boolean): Promise<string[]> {
  const set = new Set(await getTrusted());
  if (on) set.add(domain);
  else set.delete(domain);
  const list = [...set].sort();
  await chrome.storage.local.set({ trusted: list });
  return list;
}

/**
 * "Visited before with no warning": we keep SHA-256 hashes of registered domains (never
 * plain names, never URLs), most recent SEEN_LIMIT only, on this device only.
 */
export async function wasSeen(domainHash: string): Promise<boolean> {
  const { seen } = await chrome.storage.local.get('seen');
  return Boolean((seen as Record<string, number> | undefined)?.[domainHash]);
}

export async function markSeen(domainHash: string): Promise<void> {
  const { seen } = await chrome.storage.local.get('seen');
  const map = (seen as Record<string, number> | undefined) ?? {};
  map[domainHash] = Date.now();
  // Keep only the most recent SEEN_LIMIT entries.
  const kept = Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, SEEN_LIMIT);
  await chrome.storage.local.set({ seen: Object.fromEntries(kept) });
}

export async function setTabVerdict(tabId: number, v: Verdict): Promise<void> {
  await chrome.storage.session.set({ [`tab:${tabId}`]: v });
}

export async function getTabVerdict(tabId: number): Promise<Verdict | undefined> {
  const key = `tab:${tabId}`;
  const res = await chrome.storage.session.get(key);
  return res[key] as Verdict | undefined;
}

export async function clearTabVerdict(tabId: number): Promise<void> {
  await chrome.storage.session.remove(`tab:${tabId}`);
}

export async function allowOnce(domain: string): Promise<void> {
  const { allowed } = await chrome.storage.session.get('allowed');
  await chrome.storage.session.set({ allowed: [...((allowed as string[] | undefined) ?? []), domain] });
}

export async function isAllowedOnce(domain: string): Promise<boolean> {
  const { allowed } = await chrome.storage.session.get('allowed');
  return ((allowed as string[] | undefined) ?? []).includes(domain);
}

export async function getStoredBloom(): Promise<Uint8Array | null> {
  const { bloom } = await chrome.storage.local.get('bloom');
  if (typeof bloom !== 'string') return null;
  const bin = atob(bloom);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function storeBloom(bytes: Uint8Array, etag: string): Promise<void> {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await chrome.storage.local.set({ bloom: btoa(bin), bloomEtag: etag });
}

export async function getBloomEtag(): Promise<string> {
  const { bloomEtag } = await chrome.storage.local.get('bloomEtag');
  return (bloomEtag as string | undefined) ?? '';
}
