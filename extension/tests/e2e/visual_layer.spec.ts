/**
 * Layer 3 visual model (Pro, offscreen worker). The ExampleBank look-alike draws its logo and name
 * as an image, posts to its own domain and sits on a grey-zone URL — only the visual comparison
 * with the (fictional) gallery can tell that it imitates ExampleBank.
 */
import { enablePro, expect, test } from './fixtures';

type V = { url: string; layers: string[]; score: number; band: string; reasons: { id: string; text: string }[] };
async function verdictFor(sw: import('@playwright/test').Worker, url: string): Promise<V | undefined> {
  return sw.evaluate(async (u) => {
    const all = (await chrome.storage.session.get(null)) as Record<string, V>;
    return Object.values(all).find((x) => x.url === u);
  }, url);
}

test.describe('Layer 3 visual model', () => {
  test.beforeEach(async ({ sw }) => enablePro(sw));

  test('ExampleBank look-alike on a grey-zone URL is recognised visually', async ({ context, sw }) => {
    const url = 'http://my-portal.test/auth/login';
    const page = await context.newPage();
    await page.bringToFront();
    await page.goto(url);
    await page.click('#pass');
    const overlay = page.getByTestId('phishguard-overlay');
    await expect(overlay).toBeVisible({ timeout: 30_000 });
    await expect(overlay).toHaveAttribute('data-band', 'warning');
    await expect(page.locator('[data-reason="visual_brand_lookalike"]')).toHaveText(
      "Looks like ExampleBank's sign-in page, but this site is not examplebank.test",
    );
    const v = await verdictFor(sw, url);
    expect(v?.layers).toEqual(['url', 'page', 'visual']);
  });

  test('a generic login page in the grey zone is checked but not matched to a brand', async ({ context, sw }) => {
    const url = 'http://web-login.test/auth/login';
    const page = await context.newPage();
    await page.bringToFront();
    await page.goto(url);
    await page.click('#pass');
    await page.waitForTimeout(4000);
    const v = await verdictFor(sw, url);
    expect(v?.layers).toEqual(['url', 'page', 'visual']); // the visual model ran...
    expect(v?.reasons.map((r) => r.id)).not.toContain('visual_brand_lookalike'); // ...and found no brand
  });

  test('above the grey zone the screenshot is never taken', async ({ context, sw }) => {
    const url = 'http://examp1ebank.test/login'; // Layer 1 alone is sure (score ~100)
    const page = await context.newPage();
    await page.goto(url);
    await page.click('#pass');
    await page.waitForTimeout(2000);
    expect((await verdictFor(sw, url))?.layers).toEqual(['url', 'page']);
  });
});
