-- v4: Teams, threat-feed API keys, PII-free error counters.

CREATE TABLE IF NOT EXISTS orgs (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  seats                INTEGER NOT NULL,
  org_key_hash         CHAR(64) NOT NULL UNIQUE,   -- devices enrol with the org key (managed policy)
  dashboard_token_hash CHAR(64) NOT NULL UNIQUE,   -- admins read the dashboard with this token
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per enrolled browser profile. device_hash = sha256(random id generated on the device);
-- label is optional and set by the admin via policy (e.g. an employee id), never by us.
CREATE TABLE IF NOT EXISTS org_devices (
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  device_hash CHAR(64) NOT NULL,
  label       TEXT,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, device_hash)
);

-- Warning events ONLY (score > 30 shown to the user). No URL, no domain of the visited site.
CREATE TABLE IF NOT EXISTS warning_events (
  id          BIGSERIAL PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  device_hash CHAR(64) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  band        TEXT NOT NULL CHECK (band IN ('caution', 'warning', 'blocked')),
  score       SMALLINT NOT NULL,
  brand       TEXT,                  -- impersonated brand id from our brand list, if any
  reason_ids  TEXT[] NOT NULL DEFAULT '{}',
  layers      TEXT[] NOT NULL DEFAULT '{}',
  action      TEXT                   -- left | trusted | dismissed | reported
);
CREATE INDEX IF NOT EXISTS warning_events_org_time ON warning_events (org_id, occurred_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id                TEXT PRIMARY KEY,
  key_hash          CHAR(64) NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  requests_per_min  INTEGER NOT NULL DEFAULT 60,
  revoked           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Aggregated error counters: code + component + version per day. No messages, stacks or URLs.
CREATE TABLE IF NOT EXISTS error_counts (
  day        DATE NOT NULL,
  component  TEXT NOT NULL,
  code       TEXT NOT NULL,
  version    TEXT NOT NULL,
  count      INTEGER NOT NULL,
  PRIMARY KEY (day, component, code, version)
);
