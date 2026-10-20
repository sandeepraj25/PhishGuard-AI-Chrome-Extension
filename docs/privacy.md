# Privacy design

**Rule:** page scoring happens on the device. The server only ever receives the first 4 bytes of SHA-256(registered domain) for known-bad lookups. No full URLs, no browsing history, no analytics that track browsing.

## What leaves the device — complete list

| When | Sent to | Exactly what | Why it is safe |
|---|---|---|---|
| A visited site's registered domain is in the local Bloom filter | Our `/v1/check` | 1 × 4-byte hash prefix (8 hex chars) | ~4.3 billion possible prefixes; many domains share each one; the server returns all full hashes and the device compares locally. The request body is validated to contain **only** prefixes (`backend/src/api/schemas.ts`) and is not logged or stored. |
| Every 15 minutes (alarm) | Our `/v1/bloom` | Nothing about the user (plain GET with ETag) | Downloads the public list. |
| The user clicks **Report mistake** | Our `/v1/report` | Registered domain, score, reason ids, model + extension version, optional comment | Explicit, user-initiated; the UI says what is sent before sending. The server rejects anything that looks like a URL (path, query, spaces). |
| The user **opts in** to domain-age lookup (off by default) | Public RDAP service `rdap.org` (not us) | The registered domain, only when a sensitive field is focused | Off by default; described next to the checkbox. Decision D6. |
| Pro license check (v3) | Our `/v1/license` | License key | No browsing data. |
| Teams warning events (v4, managed installs only) | The organisation's tenant | Warning event: time, band, top reason ids, brand id, hashed user id | Admin-configured; no URLs, no domains of safe sites. |

Nothing else. Verified by `extension/tests/e2e/fullstack.spec.ts`, which inspects every `/v1/check` body on the wire.

## What stays on the device

- **Layer 2 page signals** (form summary, link/resource hostnames, title, a 5,000-character text sample) go from the content script to the extension's own offscreen document and are discarded after scoring. They never leave the device.

- Feature extraction, all three models, scoring and reasons.
- Trusted list (`chrome.storage.local`).
- "Visited before without warning": **SHA-256 hashes** of registered domains, most recent 5,000, never plain names, never URLs.
- Per-tab verdicts (`chrome.storage.session`, cleared when the browser closes).
- **Layer 3 screenshots (Pro):** taken only in the grey zone at the password moment, cropped and turned into a 128-number embedding inside the offscreen worker, then discarded. Never written to disk, never sent.

## Server-side

- Request logs contain method, route and status only — Fastify serializers drop IP, headers and bodies (`backend/src/app.ts`).
- Rate limiting needs a per-client key: it lives in Redis/memory with a 1-minute TTL and is never written to Postgres.
- Tables store public threat data and user-initiated reports only (see architecture §7).

## Threats we considered

| Threat | Mitigation |
|---|---|
| Server operator infers browsing from prefixes | Only sent after a local Bloom hit (i.e. for domains that are already likely bad), 4-byte prefix, no identifiers, no logging. |
| Network observer | HTTPS to the backend; body is just a prefix. |
| Phishing page removes our overlay | Overlay re-inserts itself while open (MutationObserver); keystrokes are kept out of the page while it is open. |
| Phishing page reads our overlay text | Text contains only facts about the page's own URL. |
| Malicious report flood | Rate limit (10/min/client), schema validation, review queue before any retraining use. |

## Server-side discovery (v2)

The CT worker and crawler look at **public** certificates and public web pages of *candidate phishing domains*. They never process anything about users. Crawling runs in an isolated container without credentials (see HUMAN_TODO).
