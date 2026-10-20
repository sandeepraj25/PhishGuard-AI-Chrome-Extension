/**
 * MV3 service worker.
 *  - Scores every top-level navigation with Layer 1 (URL model + rules), silently: only the
 *    toolbar badge changes. Warnings are shown by the content script at the password moment.
 *  - Confirmed known-bad sites are redirected to the block page.
 *  - All state lives in chrome.storage (the worker may be stopped at any time); the Engine is
 *    a cache that is rebuilt lazily after a restart.
 */
import { EXTENSION_VERSION } from '../lib/config';
import { fetchBloom, reasonIds, sendReport, type ReportPayload } from '../lib/api';
import { Engine } from '../lib/engine';
import { sha256Hex } from '../lib/hash';
import { configureOrt } from '../lib/model';
import { domainAgeDays } from '../lib/rdap';
import * as store from '../lib/storage';
import type { Message, PageSignals, Verdict } from '../lib/types';
import { loadEngineAssets } from './assets';
import { scorePage } from './offscreen';

configureOrt({ wasmUrl: chrome.runtime.getURL('ort/ort-wasm-simd-threaded.wasm'), proxy: false });

let enginePromise: Promise<Engine> | null = null;

function engine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = (async () => Engine.create(await loadEngineAssets(await store.getStoredBloom())))();
    enginePromise.catch(() => (enginePromise = null)); // retry on next use
  }
  return enginePromise;
}

const isWeb = (u?: string): u is string => !!u && /^https?:\/\//i.test(u);

/** Phase v3 gates Layers 2-3 behind Pro; until then (and in tests) they are always on. */
const layer2Enabled = (_s: { plan: string }): boolean => true;

async function computeVerdict(url: string, opts: { sensitive?: boolean; page?: PageSignals } = {}): Promise<Verdict> {
  const eng = await engine();
  const settings = await store.getSettings();
  const domain = eng.registeredDomain(url);
  const domainHash = await sha256Hex(domain);
  const trusted = (await store.getTrusted()).includes(domain);
  const seenBefore = await store.wasSeen(domainHash);
  // D6: domain age only when opted in, and only at the password moment (fewer lookups).
  const age = settings.rdapOptIn && opts.sensitive ? await domainAgeDays(domain) : -1;
  // Layer 2 (page model) only at the password moment, in the offscreen document.
  const page = opts.sensitive && opts.page && layer2Enabled(settings) ? await scorePage(opts.page) : null;
  const v = await eng.verdict(url, {
    trusted,
    seenBefore,
    apiBase: settings.apiBase,
    domainAgeDays: age,
    extraProb: page?.prob ?? null,
    extraReasons: page?.reasons ?? [],
    extraFloor: page?.floor ?? 0,
    layers: page ? ['url', 'page'] : ['url'],
  });
  if (v.band === 'safe' && v.knownBad === 'no') await store.markSeen(domainHash);
  return v;
}

async function updateBadge(tabId: number, v: Verdict): Promise<void> {
  const text = v.band === 'warning' ? '!' : v.band === 'caution' ? '?' : '';
  const color = v.band === 'warning' ? '#b42318' : '#b54708';
  await chrome.action.setBadgeText({ tabId, text }).catch(() => undefined);
  if (text) await chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => undefined);
}

async function scoreTab(tabId: number, url: string): Promise<void> {
  try {
    const v = await computeVerdict(url);
    if (v.knownBad === 'confirmed' && !(await store.isAllowedOnce(v.registeredDomain))) {
      const block = chrome.runtime.getURL(
        `src/block/block.html?u=${encodeURIComponent(url)}&d=${encodeURIComponent(v.registeredDomain)}`,
      );
      await chrome.tabs.update(tabId, { url: block });
      return;
    }
    await store.setTabVerdict(tabId, v);
    await updateBadge(tabId, v);
  } catch (e) {
    console.error('[phishguard] scoring failed', e);
  }
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  const url = info.url ?? (info.status === 'loading' ? tab.url : undefined);
  if (isWeb(url)) void scoreTab(tabId, url);
});
chrome.tabs.onRemoved.addListener((tabId) => void store.clearTabVerdict(tabId));

async function refreshBloom(): Promise<void> {
  const { apiBase } = await store.getSettings();
  if (!apiBase) return;
  try {
    const res = await fetchBloom(apiBase, await store.getBloomEtag());
    if (!res) return;
    await store.storeBloom(res.bytes, res.etag);
    (await engine()).fx.loadBloom(res.bytes);
  } catch (e) {
    console.warn('[phishguard] bloom refresh failed', e);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create('bloom-refresh', { periodInMinutes: 15, delayInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'bloom-refresh') void refreshBloom();
});

async function handle(msg: Message, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case 'getVerdict': {
      if (!isWeb(msg.url)) return null;
      const v = await computeVerdict(msg.url, { sensitive: msg.sensitive, page: msg.page });
      if (sender.tab?.id !== undefined && sender.frameId === 0) {
        await store.setTabVerdict(sender.tab.id, v);
        await updateBadge(sender.tab.id, v);
      }
      return v;
    }
    case 'getTabVerdict': {
      const cached = await store.getTabVerdict(msg.tabId);
      if (cached) return cached;
      const tab = await chrome.tabs.get(msg.tabId);
      return isWeb(tab.url) ? computeVerdict(tab.url) : null;
    }
    case 'trustSite':
      return store.setTrusted(msg.domain, true);
    case 'untrustSite':
      return store.setTrusted(msg.domain, false);
    case 'listTrusted':
      return store.getTrusted();
    case 'allowOnce':
      await store.allowOnce(msg.domain);
      if (sender.tab?.id !== undefined) await chrome.tabs.update(sender.tab.id, { url: msg.url });
      return true;
    case 'leaveSite':
      if (sender.tab?.id !== undefined) {
        const id = sender.tab.id;
        await chrome.tabs.goBack(id).catch(() => chrome.tabs.update(id, { url: 'chrome://newtab/' }));
      }
      return true;
    case 'reportMistake': {
      const settings = await store.getSettings();
      const payload: ReportPayload = {
        registeredDomain: msg.verdict.registeredDomain,
        kind: msg.verdict.score > 30 ? 'false_positive' : 'false_negative',
        score: msg.verdict.score,
        reasonIds: reasonIds(msg.verdict.reasons),
        modelVersion: msg.verdict.modelVersion,
        extensionVersion: EXTENSION_VERSION,
        comment: msg.comment?.slice(0, 500),
      };
      if (!settings.apiBase) return { sent: false, reason: 'offline mode: no server configured' };
      return { sent: await sendReport(settings.apiBase, payload).catch(() => false) };
    }
    case 'getSettings':
      return store.getSettings();
    case 'setSettings':
      return store.setSettings(msg.settings);
    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((msg: Message & { target?: string }, sender, sendResponse) => {
  if (msg?.target === 'offscreen') return false; // addressed to the offscreen document
  handle(msg, sender).then(sendResponse, (e: unknown) => sendResponse({ error: String(e) }));
  return true; // keep the channel open for the async response
});
