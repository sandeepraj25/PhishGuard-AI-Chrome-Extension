# Extension permissions and why each one is needed

| Permission | Phase | Why | What we do NOT do with it |
|---|---|---|---|
| `storage` | v1 | Settings, trusted list, hashed seen-set, downloaded Bloom filter (`local`); per-tab verdicts (`session`). The MV3 service worker can stop at any time, so state must live here. | No sync to other devices; nothing leaves the device. |
| `alarms` | v1 | Refresh the known-bad Bloom filter every 15 minutes (timers do not survive service-worker shutdown). | — |
| Host permissions `<all_urls>` (was `http://*/*` + `https://*/*` in v1–v2) | v1/v3 | (1) Inject the Password Moment Guard into pages, including login forms inside iframes; (2) read the tab URL to score navigations (without the broader `tabs` permission); (3) let the service worker call our backend and, if opted in, RDAP. | We never read page content except the small set of page features computed locally in v2 (forms, field types, link domains, title words). No page content is sent anywhere. |
| `offscreen` | v2 (active) | Run the page (Layer 2) and visual (Layer 3) ONNX models in a long-lived document; the service worker may be killed mid-inference. Reason: `WORKERS` (inference runs in a dedicated worker). | — |
| (no extra permission) `chrome.tabs.captureVisibleTab` | v3 | Layer 3 screenshot of the login area — only for Pro users, only when Layers 1–2 are in the grey zone (score 20–70), only after the user focused a sensitive field in the top frame. Chrome requires `<all_urls>` (or `activeTab`) for this API — the http/https patterns are not enough (found by the e2e test). The install warning is unchanged; `file://` pages still need the user's explicit toggle, and content scripts still only match http/https. | Screenshot stays in memory: cropped, embedded, discarded. Never stored, never sent. |

Permissions we deliberately do **not** request: `tabs` (URLs are available through host permissions), `webRequest`/`declarativeNetRequest` (the block page uses `tabs.update`), `history`, `cookies`, `scripting` (static content scripts are enough), `identity`.

Managed installs (v4) additionally read `chrome.storage.managed` (no permission needed; schema in `extension/public/managed_schema.json`).
