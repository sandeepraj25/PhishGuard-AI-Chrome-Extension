-- v2: Certificate Transparency discovery, crawl queue, admin review.

CREATE TABLE IF NOT EXISTS ct_log_state (
  log_url    TEXT PRIMARY KEY,
  next_index BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Domains from new certificates that carry a brand signal (NOT every CT domain).
CREATE TABLE IF NOT EXISTS ct_candidates (
  domain       TEXT PRIMARY KEY,           -- registered domain
  first_seen   TIMESTAMPTZ NOT NULL,       -- earliest CT entry timestamp we saw
  cert_names   TEXT[] NOT NULL DEFAULT '{}',
  brand        TEXT NOT NULL,
  signal       TEXT NOT NULL,              -- host | homoglyph | edit
  log_url      TEXT NOT NULL,
  verdict      TEXT NOT NULL DEFAULT 'unreviewed'  -- unreviewed | phishing | legit
);

CREATE TABLE IF NOT EXISTS crawl_queue (
  domain      TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'pending',     -- pending | done | failed
  attempts    INTEGER NOT NULL DEFAULT 0,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crawl_results (
  domain          TEXT PRIMARY KEY,
  fetched_at      TIMESTAMPTZ NOT NULL,
  http_status     INTEGER,
  final_url       TEXT,
  html            TEXT,                    -- truncated to 500 KB
  screenshot_path TEXT,
  error           TEXT
);
