import { expect, PAGES, storedVerdicts, test } from './fixtures';

const PHISH = 'http://examplebank.test.verify-account.test/secure/login.php';
const LEGIT = 'http://www.examplebank.test/login';

test.describe('Password Moment Guard', () => {
  test('shows the overlay when typing a password on the ExampleBank phishing fixture', async ({ context, sw }) => {
    void sw;
    const page = await context.newPage();
    await page.goto(PHISH);
    // Nothing is shown while simply browsing.
    await page.waitForTimeout(500);
    await expect(page.getByTestId('phishguard-overlay')).toHaveCount(0);

    await page.click('#pass');
    const overlay = page.getByTestId('phishguard-overlay');
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    await expect(overlay).toHaveAttribute('role', 'alertdialog');
    await expect(overlay).toHaveAttribute('data-band', 'warning');
    const reasons = page.getByTestId('phishguard-reasons').locator('li');
    await expect(reasons).not.toHaveCount(0);
    expect(await reasons.count()).toBeLessThanOrEqual(3);
    await expect(page.getByTestId('phishguard-reasons')).toContainText('examplebank');
    await expect(page.getByTestId('phishguard-score')).toContainText('/100');

    // Keyboard: Escape dismisses and focus returns to the field.
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
    await expect(page.locator('#pass')).toBeFocused();
  });

  test('shows NO overlay on the legitimate ExampleBank fixture', async ({ context, sw }) => {
    const page = await context.newPage();
    await page.goto(LEGIT);
    await page.click('#pass');
    await page.keyboard.type('hunter2');
    await page.waitForTimeout(2000);
    await expect(page.getByTestId('phishguard-overlay')).toHaveCount(0);
    // Prove the page WAS scored (not a silent failure): verdict stored by the service worker.
    const verdicts = Object.values(await storedVerdicts(sw)).filter((v) => v?.url === LEGIT);
    expect(verdicts.length).toBeGreaterThan(0);
    expect(verdicts[0].score).toBeLessThanOrEqual(30);
  });

  test('"I trust this site" suppresses future overlays for that domain', async ({ context, sw }) => {
    void sw;
    const page = await context.newPage();
    await page.goto('http://examp1ebank.test/login');
    await page.click('#pass');
    await expect(page.getByTestId('phishguard-overlay')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'I trust this site' }).click();
    await page.goto('http://examp1ebank.test/login');
    await page.click('#pass');
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('phishguard-overlay')).toHaveCount(0);
  });

  test('no overlay on non-sensitive fields or a legit card checkout', async ({ context, sw }) => {
    void sw;
    const page = await context.newPage();
    await page.goto('http://news.example.test/article/123');
    await page.click('#search');
    await page.keyboard.type('weather');
    await page.goto('http://www.example-shop.test/checkout');
    await page.click('#card');
    await page.keyboard.type('4111');
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('phishguard-overlay')).toHaveCount(0);
  });

  test('popup shows the current site score and reasons', async ({ context, sw }) => {
    const page = await context.newPage();
    await page.goto(PHISH);
    await page.waitForTimeout(800);
    const extId = new URL(sw.url()).host;
    const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id ?? -1, PHISH);
    const popup = await context.newPage();
    // Open the popup page directly; point its "active tab" query at the fixture tab.
    await popup.addInitScript((id) => {
      chrome.tabs.query = (async () => [{ id }]) as unknown as typeof chrome.tabs.query;
    }, tabId);
    await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`);
    await expect(popup.locator('#domain')).toHaveText('verify-account.test');
    await expect(popup.locator('#verdict')).toContainText('Likely phishing');
    await expect(popup.locator('#reasons li')).not.toHaveCount(0);
  });

  test('fixtures map is fictional-only', async () => {
    for (const url of Object.keys(PAGES)) expect(new URL(url).hostname.endsWith('.test')).toBe(true);
  });
});
