-- Consent records outlive browsing sessions so withdrawal also works after expiry.
CREATE TABLE IF NOT EXISTS collection_consents (
  receipt_hash TEXT PRIMARY KEY,
  policy_version TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  erased INTEGER NOT NULL DEFAULT 0,
  sink TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS collection_expiry ON collection_consents(expires);
CREATE TABLE IF NOT EXISTS collection_items (
  id TEXT PRIMARY KEY,
  receipt_hash TEXT NOT NULL REFERENCES collection_consents(receipt_hash) ON DELETE CASCADE,
  photo_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created INTEGER NOT NULL,
  UNIQUE(receipt_hash,photo_id)
);
