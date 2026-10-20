/**
 * Offscreen document: long-lived host for the heavy models (Layer 2 page, Layer 3 visual).
 * The MV3 service worker can be stopped mid-inference; this document lives as long as we need.
 * All inference runs in a dedicated worker (offscreen reason: WORKERS); this page only relays
 * messages and passes asset URLs (workers cannot call chrome.runtime.getURL).
 */
import type { OffscreenRequest, WorkerReply } from './protocol';

const worker = new Worker(new URL('./inference.worker.ts', import.meta.url), { type: 'module' });
let seq = 0;
const pending = new Map<number, (r: WorkerReply) => void>();
worker.onmessage = (e: MessageEvent<WorkerReply>) => {
  pending.get(e.data.id)?.(e.data);
  pending.delete(e.data.id);
};

const assetBase = chrome.runtime.getURL('');
worker.postMessage({ id: 0, kind: 'init', assetBase });

function ask(req: Omit<OffscreenRequest, 'target'>): Promise<WorkerReply> {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ ...req, id });
  });
}

chrome.runtime.onMessage.addListener((msg: OffscreenRequest, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false; // not for us: let the service worker answer
  const { target: _t, ...req } = msg;
  void _t;
  ask(req).then(sendResponse);
  return true;
});
