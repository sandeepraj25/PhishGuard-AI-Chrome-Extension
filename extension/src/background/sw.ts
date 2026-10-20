/**
 * MV3 service worker.
 *  - Scores every top-level navigation with Layer 1 (URL model + rules), silently: only the
 *    toolbar badge changes. Warnings are shown by the content script at the password moment.
 *  - Confirmed known-bad sites are redirected to the block page.
 *  - All state lives in chrome.storage (the worker may be stopped at any time); the Engine is
 *    a cache that is rebuilt lazily after a restart.
 */
import { EXTENSION_VERSION, VISUAL_FLOOR, VISUAL_GREY_HI, VISUAL_GREY_LO } from '../lib/config';
import { fetchBloom, reasonIds, sendReport, type ReportPayload } from '../lib/api';
import { Engine } from '../lib/engine';
import { sha256Hex } from '../lib/hash';
import { configureOrt } from '../lib/model';
import { domainAgeDays } from '../lib/rdap';
import * as store from '../lib/storage';
import type { FormGeometry, Message, PageSignals, Reason, Verdict } from '../lib/types';
import { applyValidation, isPro, validateLicense } from '../lib/license';
import { loadEngineAssets } from './assets';
import { scorePage, scoreVisual } from './offscreen';

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

/** Layers 2-3 are Pro features (free tier: Layer 1 + Password Guard + reasons + regional brands). */
const layer2Enabled = (s: Parameters<typeof isPro>[0]): boolean => isPro(s);

interface VerdictOptions {
  sensitive?: boolean;
  page?: PageSignals;
  form?: FormGeometry;
  /** Window of the (top-frame, active) tab that asked: required for a Layer 3 screenshot. */
  windowId?: number;
}

async function computeVerdict(url: string, opts: VerdictOptions = {}): Promise<Verdict> {
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
  const ctx = {
    trusted,
    seenBefore,
    apiBase: settings.apiBase,
    domainAgeDays: age,
    extraProb: page?.prob ?? null,
    extraReasons: page?.reasons ?? [],
    extraFloor: page?.floor ?? 0,
    layers: page ? ['url', 'page'] : ['url'],
  };
  let v = await eng.verdict(url, ctx);
  // Layer 3 (visual) only when Layers 1-2 are unsure, the user is Pro, and we can see the form.
  const grey = v.score >= VISUAL_GREY_LO && v.score <= VISUAL_GREY_HI && v.knownBad === 'no' && !trusted;
  if (grey && opts.sensitive && opts.form && opts.windowId !== undefined && layer2Enabled(settings)) {
    const visualReason = await lookAlike(domain, opts.form, opts.windowId);
    if (visualReason) {
      v = await eng.verdict(url, {
        ...ctx,
        extraReasons: [...ctx.extraReasons, visualReason],
        extraFloor: Math.max(ctx.extraFloor, VISUAL_FLOOR),
        layers: [...ctx.layers, 'visual'],
      });
    } else {
      v = { ...v, layers: [...v.layers, 'visual'] };
    }
  }
  if (v.band === 'safe' && v.knownBad === 'no') await store.markSeen(domainHash);
  return v;
}

/** Screenshot the visible tab and ask the visual model whether the login area imitates a brand. */
async function lookAlike(domain: string, form: FormGeometry, windowId: number): Promise<Reason | null> {
  let pngDataUrl: string;
  try {
    pngDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  } catch (e) {
    await chrome.storage.session.set({ lastVisual: { error: String(e) } });
    return null; // tab not visible / capture not allowed: fail open
  }
  const r = await scoreVisual({ pngDataUrl, form: form.rect, viewport: form.viewport, dpr: form.dpr });
  // Diagnostics only (no URL, no image): what the visual model decided last.
  await chrome.storage.session.set({
    lastVisual: r ? { brand: r.brand, confidence: r.confidence, match: r.match, latencyMs: r.latencyMs } : null,
  });
  if (!r?.match || r.officialDomains.includes(domain)) return null;
  return {
    id: 'visual_brand_lookalike',
    text: `Looks like ${r.brandName}'s sign-in page, but this site is not ${r.officialDomains[0]}`,
    weight: 50 + r.confidence, // concrete evidence: rank above model-only reasons
  };
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

async function refreshLicense(): Promise<void> {
  const s = await store.getSettings();
  if (!s.apiBase || !s.licenseKey) return;
  try {
    await store.setSettings(applyValidation(await validateLicense(s.apiBase, s.licenseKey), s.licenseKey));
  } catch {
    // Offline: keep the cached plan; isPro() enforces the offline grace period.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create('bloom-refresh', { periodInMinutes: 15, delayInMinutes: 1 });
  void chrome.alarms.create('license-refresh', { periodInMinutes: 24 * 60, delayInMinutes: 5 });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'bloom-refresh') void refreshBloom();
  if (a.name === 'license-refresh') void refreshLicense();
});

async function handle(msg: Message, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case 'getVerdict': {
      if (!isWeb(msg.url)) return null;
      const top = sender.frameId === 0 && sender.tab?.active;
      const v = await computeVerdict(msg.url, {
        sensitive: msg.sensitive,
        page: msg.page,
        form: top ? msg.form : undefined,
        windowId: top ? sender.tab?.windowId : undefined,
      });
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
    case 'activateLicense': {
      const s = await store.getSettings();
      if (!s.apiBase) return { valid: false, reason: 'offline mode: no server configured' };
      try {
        const r = await validateLicense(s.apiBase, msg.key.trim());
        await store.setSettings(applyValidation(r, msg.key.trim()));
        return r;
      } catch {
        return { valid: false, reason: 'could not reach the licence server' };
      }
    }
    case 'deactivateLicense':
      return store.setSettings({ plan: 'free', licenseKey: '', licenseExpiresAt: '', licenseCheckedAt: 0 });
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
