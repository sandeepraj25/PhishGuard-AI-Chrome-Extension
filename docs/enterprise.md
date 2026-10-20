# Teams: managed install with Chrome Enterprise policy

This is how an organisation's IT admin installs PhishGuard on every work browser and connects it to
their Teams dashboard. Users cannot remove the extension or change the organisation settings.

## 1. Create the organisation (once)

```bash
curl -X POST "$API/v1/admin/orgs" -H "authorization: Bearer $ADMIN_TOKEN" \
     -H 'content-type: application/json' -d '{"name":"Acme Ltd","seats":50}'
# -> {"orgId":"…","orgKey":"org_…","dashboardToken":"dash_…"}   (shown once; only hashes are stored)
```

- `orgKey` goes into the browser policy (step 3). Treat it like a password: anyone with it can use your seats.
- `dashboardToken` is for people who read the dashboard at `https://<api>/dashboard/`.

## 2. Force-install the extension

Policy `ExtensionInstallForcelist` (Windows: Group Policy / Intune; macOS: configuration profile; Linux: JSON in `/etc/opt/chrome/policies/managed/`):

```json
{ "ExtensionInstallForcelist": ["<EXTENSION_ID>;https://clients2.google.com/service/update2/crx"] }
```

`<EXTENSION_ID>` is the Chrome Web Store id (HUMAN_TODO: publish first). For a self-hosted build, use your own update URL.

## 3. Configure it (policy for extensions, "3rdparty")

The schema is `extension/public/managed_schema.json`. Linux example — `/etc/opt/chrome/policies/managed/phishguard.json`
(Chromium: `/etc/chromium/policies/managed/`):

```json
{
  "3rdparty": {
    "extensions": {
      "<EXTENSION_ID>": {
        "orgKey": "org_…",
        "apiBase": "https://api.phishguard.example",
        "userLabel": "",
        "reportActions": true
      }
    }
  }
}
```

Windows registry equivalent: `HKLM\Software\Policies\Google\Chrome\3rdparty\extensions\<EXTENSION_ID>\policy` with string values `orgKey`, `apiBase`, `userLabel` and DWORD `reportActions`.

- `userLabel` is optional. Leave it empty and the dashboard shows pseudonymous device codes; set it (per user, via your MDM's variables) to show e.g. an employee id.
- `reportActions: false` keeps what the user chose (left / continued / trusted / reported) off the dashboard.
- Managed browsers get the Teams feature set (Layers 1–3) without a personal licence key; seats are enforced by the server (HTTP 402 when full).

Verify: open `chrome://policy` — the extension's policies are listed under PhishGuard. The e2e test
`extension/tests/e2e/teams.spec.ts` exercises exactly this path with Chromium's Linux policy directory.

## 4. What the organisation can and cannot see

| Sent to the org | Never sent |
|---|---|
| Time of a warning, band (caution / warning / blocked), score | The URL or domain of any page |
| Impersonated brand id (e.g. `sbi`), reason ids, which layers fired | Browsing history, safe sites, page content, screenshots |
| What the user chose (if `reportActions`) | Passwords, form contents, keystrokes |
| Device code (sha256 of a random id) or the admin-provided label | IP address (not stored; rate limiting only) |

The server validates this: event fields are a fixed schema (brand and reason ids must match
`^[a-z0-9_-]+$`), unknown fields are dropped.
