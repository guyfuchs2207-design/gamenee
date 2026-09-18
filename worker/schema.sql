-- Orders stats store (Cloudflare D1 / SQLite).
-- Apply with:  npx wrangler d1 execute orders --remote --file=./schema.sql

-- Aggregate counts only. There is no per-player row and no identifier that
-- survives the request, so there is nothing here to leak.
CREATE TABLE IF NOT EXISTS results (
  puzzle_number INTEGER NOT NULL,
  bucket        TEXT    NOT NULL,  -- '0'..'6' — items placed correctly
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (puzzle_number, bucket)
);

-- One submission per client per puzzle. The IP is salted and hashed before it
-- gets here; the raw address is never written to disk.
CREATE TABLE IF NOT EXISTS submissions (
  puzzle_number INTEGER NOT NULL,
  client_hash   TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (puzzle_number, client_hash)
);

-- Supports the retention sweep; without it the delete is a full scan.
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at);
