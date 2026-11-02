-- Password reset links sent by email. Only the SHA-256 of the link's token is stored; a link works
-- once, for RESET_TTL_MIN minutes.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id, created_at);
