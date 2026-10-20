-- v3: Pro licences (Paddle). Only billing identifiers, never browsing data.
CREATE TABLE IF NOT EXISTS licenses (
  id                     TEXT PRIMARY KEY,              -- licence id embedded in the signed key
  key_hash               CHAR(64) NOT NULL UNIQUE,      -- sha256(key); the key itself is not stored
  plan                   TEXT NOT NULL,                 -- pro | teams
  status                 TEXT NOT NULL,                 -- active | trialing | past_due | canceled | paused
  seats                  INTEGER NOT NULL DEFAULT 1,
  expires_at             TIMESTAMPTZ NOT NULL,
  paddle_subscription_id TEXT UNIQUE,
  paddle_customer_id     TEXT,
  claim_token_hash       CHAR(64),                      -- one-time pickup of the key after checkout
  claimed_at             TIMESTAMPTZ,
  org_id                 TEXT,                          -- v4 Teams
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Pickup copy of the key, deleted on first claim (cannot re-derive a key from its hash).
CREATE TABLE IF NOT EXISTS license_pickup (
  claim_token_hash CHAR(64) PRIMARY KEY,
  license_key      TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
