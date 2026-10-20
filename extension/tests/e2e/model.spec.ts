import { expect, test } from './fixtures';

const CASES: [string, 'safe' | 'warning'][] = [
  ['http://examplebank.test.verify-account.test/secure/login.php', 'warning'],
  ['http://examp1ebank.test/login', 'warning'],
  ['http://www.examplebank.test/login', 'safe'],
];

test('service worker scores with the ONNX model (not the rules fallback) and gives template reasons', async ({
  context,
  sw,
}) => {
  const page = await context.newPage();
  for (const [url, band] of CASES) {
    await page.goto(url);
    await page.click('#pass');
    // Poll instead of sleeping: wait until the password-moment verdict (not the navigation one) is stored.
    const read = () =>
      sw.evaluate(async (u) => {
        const all = (await chrome.storage.session.get(null)) as Record<string, { url: string; computedAt: number }>;
        return Object.values(all).find((x) => x?.url === u);
      }, url);
    await expect.poll(async () => (await read())?.url, { timeout: 15_000 }).toBe(url);
    const v = await read();
    const verdict = v as unknown as {
      source: string;
      band: string;
      reasons: { id: string; text: string }[];
      score: number;
    };
    console.log(url, verdict.score, verdict.source, JSON.stringify(verdict.reasons.map((r) => r.text)));
    expect(verdict.source).toBe('model');
    expect(verdict.band).toBe(band);
    if (band === 'warning') expect(verdict.reasons.length).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
  }
});
