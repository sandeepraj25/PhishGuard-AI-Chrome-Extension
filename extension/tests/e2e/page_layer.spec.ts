import { expect, test } from './fixtures';

test.describe('Layer 2 page model (offscreen document)', () => {
  test('form-action mismatch on a neutral URL triggers the overlay with a page reason', async ({ context, sw }) => {
    const page = await context.newPage();
    await page.goto('http://www.cedarlabs.test/members');
    await page.click('#pass');
    const overlay = page.getByTestId('phishguard-overlay');
    await expect(overlay).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('phishguard-reasons')).toContainText(
      'Form sends your password to a different site (attacker-example.test)',
    );
    const v = await sw.evaluate(async () => {
      const all = (await chrome.storage.session.get(null)) as Record<string, { url: string; layers: string[] }>;
      return Object.values(all).find((x) => x.url === 'http://www.cedarlabs.test/members');
    });
    expect(v?.layers).toEqual(['url', 'page']);
    // The offscreen document exists (heavy model host).
    const contexts = await sw.evaluate(
      async () =>
        (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length,
    );
    expect(contexts).toBe(1);
  });

  test('same kind of members page posting to itself: no overlay', async ({ context, sw }) => {
    const page = await context.newPage();
    await page.goto('http://portal.cedarlabs.test/members/');
    await page.click('#pass');
    await page.keyboard.type('secret');
    await page.waitForTimeout(3000);
    await expect(page.getByTestId('phishguard-overlay')).toHaveCount(0);
    const v = await sw.evaluate(async () => {
      const all = (await chrome.storage.session.get(null)) as Record<
        string,
        { url: string; layers: string[]; score: number }
      >;
      return Object.values(all).find((x) => x.url === 'http://portal.cedarlabs.test/members/');
    });
    expect(v?.layers).toEqual(['url', 'page']);
    expect(v?.score).toBeLessThanOrEqual(30);
  });
});
