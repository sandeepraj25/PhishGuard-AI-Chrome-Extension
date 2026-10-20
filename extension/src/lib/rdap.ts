/**
 * Optional domain-age lookup (decision D6): OFF by default. When the user opts in, the device
 * asks the public RDAP bootstrap service directly; our backend never sees the domain.
 * Results are cached for 7 days in chrome.storage.local.
 */
const TTL_MS = 7 * 24 * 3600 * 1000;

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}

export function registrationAgeDays(body: { events?: RdapEvent[] }, now = Date.now()): number {
  const ev = body.events?.find((e) => e.eventAction === 'registration');
  if (!ev?.eventDate) return -1;
  const t = Date.parse(ev.eventDate);
  return Number.isFinite(t) ? Math.max(0, (now - t) / 86_400_000) : -1;
}

export async function domainAgeDays(domain: string): Promise<number> {
  const key = `rdap:${domain}`;
  const cached = (await chrome.storage.local.get(key))[key] as { age: number; at: number } | undefined;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.age + (Date.now() - cached.at) / 86_400_000;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return -1;
    const age = registrationAgeDays((await res.json()) as { events?: RdapEvent[] });
    await chrome.storage.local.set({ [key]: { age, at: Date.now() } });
    return age;
  } catch {
    return -1;
  }
}
