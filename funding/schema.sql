-- One row per payment. Ko-fi and Patreon resend a webhook until they get a 200, so the id makes a resend a no-op.
CREATE TABLE IF NOT EXISTS donations (
  id TEXT PRIMARY KEY,              -- kofi:<message_id>, patreon:<member>:<lifetime cents>, manual:<uuid>
  source TEXT NOT NULL,             -- kofi | patreon | manual
  backer TEXT NOT NULL,             -- one person across payments, for the backer list
  name TEXT NOT NULL,               -- as shown: a nickname, a Patreon first name or "Anonymous"
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  at TEXT NOT NULL,                 -- ISO time, UTC
  hidden INTEGER NOT NULL DEFAULT 0, -- name left out of the list (still counts)
  void INTEGER NOT NULL DEFAULT 0    -- refunded or a test: neither counted nor listed
);
CREATE INDEX IF NOT EXISTS donations_at ON donations (at);

-- Patreon only reports a member's lifetime total; a payment is its rise since the last webhook.
CREATE TABLE IF NOT EXISTS patreon_members (
  member_id TEXT PRIMARY KEY,
  lifetime_cents INTEGER NOT NULL
);

-- key 'goals': the JSON list the CMS's Funding tab edits.
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
