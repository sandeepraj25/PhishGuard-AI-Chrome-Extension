/** Service-worker side of the offscreen document (Layer 2/3 host). */
import type { PageScore } from '../lib/pagescore';
import type { RawPageSignals } from '../lib/pagefeatures';
import type { OffscreenRequest, WorkerReply } from '../offscreen/protocol';

const PATH = 'src/offscreen/offscreen.html';
let creating: Promise<void> | null = null;

async function hasDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(PATH)],
  });
  return contexts.length > 0;
}

export async function ensureOffscreen(): Promise<void> {
  if (await hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Runs the page and visual phishing models in a dedicated worker.',
    })
    .catch((e: unknown) => {
      // Another event may have created it first; that is fine.
      if (!String(e).includes('Only a single offscreen')) throw e;
    })
    .finally(() => (creating = null));
  await creating;
}

async function ask(req: OffscreenRequest, timeoutMs: number): Promise<WorkerReply> {
  await ensureOffscreen();
  return Promise.race([
    chrome.runtime.sendMessage(req) as Promise<WorkerReply>,
    new Promise<WorkerReply>((resolve) =>
      setTimeout(() => resolve({ id: -1, ok: false, error: 'timeout' }), timeoutMs),
    ),
  ]);
}

/** Layer 2 score, or null if the page model is unavailable (we fail open to Layer 1 only). */
export async function scorePage(raw: RawPageSignals): Promise<PageScore | null> {
  try {
    const reply = await ask({ target: 'offscreen', kind: 'page', raw }, 8000);
    return reply.ok && reply.page ? reply.page : null;
  } catch {
    return null;
  }
}
