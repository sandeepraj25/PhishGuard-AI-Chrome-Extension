-- v1 schema. No table stores URLs, IP addresses or browsing history.

CREATE TABLE IF NOT EXISTS known_bad_domains (
  domain       TEXT PRIMARY KEY,           -- registered domain (eTLD+1), lower-case
  full_hash    CHAR(64) NOT NULL,          -- sha256(domain) hex
  prefix       CHAR(8)  NOT NULL,          -- first 4 bytes of full_hash (hex)
  first_seen   TIMESTAMPTZ NOT NULL,       -- earliest time ANY source told us
  last_seen    TIMESTAMPTZ NOT NULL,
  sources      TEXT[]   NOT NULL DEFAULT '{}',
  active       BOOLEAN  NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS known_bad_prefix_idx ON known_bad_domains (prefix) WHERE active;

-- First time each source reported a domain: used by the lead-time tracker (v2).
CREATE TABLE IF NOT EXISTS domain_sightings (
  domain     TEXT NOT NULL,
  source     TEXT NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (domain, source)
);

-- User-initiated "Report mistake". Only the registered domain is stored, never a URL.
CREATE TABLE IF NOT EXISTS reports (
  id                BIGSERIAL PRIMARY KEY,
  registered_domain TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('false_positive', 'false_negative')),
  score             SMALLINT NOT NULL,
  reason_ids        TEXT[] NOT NULL DEFAULT '{}',
  model_version     TEXT NOT NULL,
  extension_version TEXT NOT NULL,
  comment           TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',  -- review queue (v2): pending|confirmed|rejected
  reviewer_label    SMALLINT,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status, created_at);

CREATE TABLE IF NOT EXISTS rdap_cache (
  domain        TEXT PRIMARY KEY,
  registered_at TIMESTAMPTZ,
  status        TEXT NOT NULL,         -- ok | not_found | error | unsupported_tld
  fetched_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS bloom_versions (
  id         BIGSERIAL PRIMARY KEY,
  etag       TEXT NOT NULL,
  items      INTEGER NOT NULL,
  bytes      BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
