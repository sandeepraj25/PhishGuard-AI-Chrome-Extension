/** URL -> fixture file. All brands are fictional; all hosts use the reserved .test TLD. */
export const PAGES: Record<string, string> = {
  'http://www.examplebank.test/login': 'examplebank_login.html',
  'http://examplebank.test.verify-account.test/secure/login.php': 'examplebank_phish.html',
  'http://examp1ebank.test/login': 'examplebank_phish.html',
  'http://account-verify-examplebank.test/login': 'examplebank_phish.html',
  'http://www.example-shop.test/checkout': 'shop_checkout.html',
  'http://news.example.test/article/123': 'plain_article.html',
  'http://www.cedarlabs.test/members': 'members_form_mismatch.html',
  'http://portal.cedarlabs.test/members/': 'members_ok.html',
  // Grey-zone URLs (URL model ~30-35 on the synthetic-trained model) for the Layer 3 tests.
  'http://my-portal.test/auth/login': 'examplebank_visual_clone.html',
  'http://web-login.test/auth/login': 'members_ok.html',
};
