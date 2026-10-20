/**
 * Crawler for CT candidates: fetch the landing page HTML (and optionally a screenshot).
 * SAFETY: run this worker in an isolated container with no credentials and egress-only network.
 * It never submits forms. Screenshots need a headless browser (Playwright) — optional.
 */
import type { CrawlResult, Store } from '../db/store';

export interface Screenshotter {
  capture(url: string, domain: string): Promise<string | null>; // returns a file path
}

export type HtmlFetcher = (url: string) => Promise<{ status: number; url: string; text(): Promise<string> }>;

const MAX_HTML = 500 * 1024;

export async function crawlOnce(
  store: Store,
  fetchHtml: HtmlFetcher,
  screenshotter: Screenshotter | null,
  limit = 5,
  now: () => Date = () => new Date(),
): Promise<CrawlResult[]> {
  const out: CrawlResult[] = [];
  for (const domain of await store.takeCrawlJobs(limit, 3)) {
    const result: CrawlResult = {
      domain,
      fetchedAt: now(),
      httpStatus: null,
      finalUrl: null,
      html: null,
      screenshotPath: null,
      error: null,
    };
    try {
      const res = await fetchHtml(`https://${domain}/`);
      result.httpStatus = res.status;
      result.finalUrl = res.url;
      result.html = (await res.text()).slice(0, MAX_HTML);
      if (screenshotter) result.screenshotPath = await screenshotter.capture(res.url, domain);
    } catch (e) {
      result.error = String(e);
    }
    await store.finishCrawl(result);
    out.push(result);
  }
  return out;
}

/** Default fetcher: 10 s timeout, redirects followed, no cookies (node fetch keeps none). */
export const defaultHtmlFetcher: HtmlFetcher = async (url) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (PhishGuard research crawler)' },
    });
    return { status: res.status, url: res.url, text: () => res.text() };
  } finally {
    clearTimeout(t);
  }
};

/** Playwright screenshotter, loaded only if the optional `playwright` package is installed. */
export async function playwrightScreenshotter(dir: string): Promise<Screenshotter | null> {
  try {
    // Optional dependency: typed structurally so the backend builds without Playwright installed.
    interface MiniPage {
      goto(u: string, o: object): Promise<unknown>;
      screenshot(o: { path: string }): Promise<unknown>;
    }
    interface MiniCtx {
      newPage(): Promise<MiniPage>;
      close(): Promise<void>;
    }
    interface MiniBrowser {
      newContext(o: object): Promise<MiniCtx>;
    }
    const modName = 'playwright';
    const pw = (await import(modName)) as { chromium: { launch(): Promise<MiniBrowser> } };
    const browser = await pw.chromium.launch();
    return {
      async capture(url, domain) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, javaScriptEnabled: true });
        try {
          const page = await ctx.newPage();
          await page.goto(url, { timeout: 15_000, waitUntil: 'domcontentloaded' });
          const path = `${dir}/${domain.replace(/[^a-z0-9.-]/g, '_')}.png`;
          await page.screenshot({ path });
          return path;
        } finally {
          await ctx.close();
        }
      },
    };
  } catch {
    return null;
  }
}
