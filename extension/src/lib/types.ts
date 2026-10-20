/** Shared types for messages between content script, popup, offscreen document and service worker. */
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
  modelVersion: string;
  computedAt: number;
}

export interface PageSignals {
  /** Page-level features from the content script (Layer 2, v2+). */
  features: number[];
  formActionDomain: string;
}

export type Message =
  | { type: 'getVerdict'; url: string; page?: PageSignals; sensitive?: boolean }
  | { type: 'getTabVerdict'; tabId: number }
  | { type: 'trustSite'; domain: string }
  | { type: 'untrustSite'; domain: string }
  | { type: 'listTrusted' }
  | { type: 'reportMistake'; verdict: Verdict; comment?: string }
  | { type: 'leaveSite' }
  | { type: 'allowOnce'; domain: string; url: string }
  | { type: 'getSettings' }
  | { type: 'setSettings'; settings: Partial<Settings> };

export interface Settings {
  apiBase: string; // '' = backend disabled (fully offline)
  rdapOptIn: boolean; // D6: query public RDAP directly from the device for domain age
  plan: 'free' | 'pro';
  licenseKey: string;
}

export type { MatchDetails };
