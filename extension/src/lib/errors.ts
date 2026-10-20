/**
 * PII-free error counters: a fixed vocabulary of codes, counted locally and sent once a day as
 * {code: count}. No messages, stack traces, URLs or identifiers.
 */
export const ERROR_CODES = [
  'engine_load_failed',
  'url_model_load_failed',
  'scoring_failed',
  'page_score_failed',
  'visual_score_failed',
  'capture_failed',
  'bloom_refresh_failed',
  'license_check_failed',
  'teams_upload_failed',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export async function recordError(code: ErrorCode): Promise<void> {
  try {
    const { errorCounts } = await chrome.storage.local.get('errorCounts');
    const c = (errorCounts as Record<string, number> | undefined) ?? {};
    c[code] = (c[code] ?? 0) + 1;
    await chrome.storage.local.set({ errorCounts: c });
  } catch {
    /* never let error accounting cause errors */
  }
}

export async function flushErrors(apiBase: string, version: string): Promise<void> {
  const { errorCounts } = await chrome.storage.local.get('errorCounts');
  const counts = (errorCounts as Record<string, number> | undefined) ?? {};
  if (!apiBase || !Object.keys(counts).length) return;
  const res = await fetch(`${apiBase}/v1/errors`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ component: 'sw', version, counts }),
  });
  if (res.ok) await chrome.storage.local.set({ errorCounts: {} });
}
