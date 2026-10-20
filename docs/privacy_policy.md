# PhishGuard AI — Privacy Policy (DRAFT — needs legal review)

_Last updated: 2026-10-20_

PhishGuard AI ("we") is a browser extension that warns you about phishing websites. This policy explains what data the extension and our servers handle.

## 1. Data processed on your device only
- The web addresses you visit are analysed **on your device** to compute a risk score. They are not sent to us.
- Your trusted-sites list, settings, and anonymous fingerprints (SHA-256 hashes) of sites you visited without a warning are stored in your browser's extension storage and never leave your device.

## 2. Data sent to our servers
- **Known-scam check:** when a site matches our local list of known phishing sites, the extension sends the first 4 bytes of a SHA-256 fingerprint of the site's domain. Many unrelated domains share each fingerprint; we cannot tell which site you visited. These requests are not logged or stored.
- **List updates:** the extension downloads the latest known-scam list. This sends nothing about you.
- **Reports (only if you click "Report mistake"):** the site's domain name (for example `example.com`, never the full address), the risk score, the reason codes, and the extension and model version. Reports are used to review mistakes and improve the model.
- **Pro licence check (if you buy Pro):** your licence key.
- **Optional domain-age lookup (off by default):** if you turn it on, the extension asks the public RDAP service (rdap.org), not us, for the registration date of the site you are about to log in to.

## 3. What we never collect
Your browsing history, full web addresses, page contents, passwords, card numbers, keystrokes, or any analytics that track your browsing.

## 4. Teams / managed installations
If your organisation installs PhishGuard for you, it may receive warning events (time, risk level, reason codes, the impersonated brand, and a pseudonymous user id). It does not receive your browsing history or the addresses of safe sites.

## 5. Retention
Reports are kept until reviewed and then for at most [12 months — to be confirmed]. Server logs contain no IP addresses or request contents.

## 6. Your choices
You can clear all local data by removing the extension. You can ask us to delete a report by contacting [contact email — to be added].

## 7. Contact
[Company name, address, email — to be added]
