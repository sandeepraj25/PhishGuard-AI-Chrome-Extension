/** Shared types for messages between content script, popup, offscreen document and service worker. */
import type { RawPageSignals } from './pagefeatures';
import type { MatchDetails } from './wasm';

export type Band = 'safe' | 'caution' | 'warning';

export interface Reason {
  /** Stable id used for reports and analytics-free debugging, e.g. "brand_in_host_not_official". */
  id: string;
  text: string;
  /** Contribution to the risk (SHAP value in log-odds, or rule points for the rules fallback). */
  weight: number;
}

export type KnownBadState = 'confirmed' | 'bloom-only' | 'no';

export interface Verdict {
  url: string;
  registeredDomain: string;
  score: number; // 0..100
  band: Band;
  reasons: Reason[];
  knownBad: KnownBadState;
  trusted: boolean;
  source: 'model' | 'rules' | 'known-bad';
  layers: string[]; // which layers contributed, e.g. ["url", "page"]
  brand: string; // impersonated brand id ('' if none) — the only brand data Teams events carry
  modelVersion: string;
  computedAt: number;
}

/** Raw DOM signals from the content script (Layer 2); finalised in the offscreen worker. */
export type PageSignals = RawPageSignals;

export type Message =
  | { type: 'getVerdict'; url: string; page?: PageSignals; sensitive?: boolean; form?: FormGeometry }
  | { type: 'getTabVerdict'; tabId: number }
  | { type: 'trustSite'; domain: string }
  | { type: 'untrustSite'; domain: string }
  | { type: 'listTrusted' }
  | { type: 'reportMistake'; verdict: Verdict; comment?: string }
  | { type: 'leaveSite' }
  | { type: 'allowOnce'; domain: string; url: string }
  | { type: 'getSettings' }
  | { type: 'setSettings'; settings: Partial<Settings> }
  | { type: 'activateLicense'; key: string }
  | { type: 'deactivateLicense' }
  | { type: 'warningOutcome'; verdict: Verdict; action: 'left' | 'trusted' | 'dismissed' | 'reported' };

/** Where the focused form is on screen (CSS px), for the Layer 3 "login area" crop. */
export interface FormGeometry {
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  dpr: number;
}

export interface Settings {
  apiBase: string; // '' = backend disabled (fully offline)
  rdapOptIn: boolean; // D6: query public RDAP directly from the device for domain age
  plan: 'free' | 'pro' | 'teams';
  licenseKey: string;
  licenseExpiresAt: string; // ISO time confirmed by the server ('' = none)
  licenseCheckedAt: number; // ms epoch of the last successful server check
}

export type { MatchDetails };
