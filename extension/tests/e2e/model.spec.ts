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
    await page.waitForTimeout(600);
    const v = await sw.evaluate(async (u) => {
      const all = (await chrome.storage.session.get(null)) as Record<string, { url: string }>;
      return Object.values(all).find((x) => x.url === u);
    }, url);
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
