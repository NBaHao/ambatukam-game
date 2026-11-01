-- Registered accounts (TETR.IO-style): username + password, email optional.
-- Guests have no row here; they keep playing with an anonymous pid as before.
-- pid: the player id whose scores belong to this account (taken from the device that registered).
CREATE TABLE IF NOT EXISTS users (
  id         TEXT    PRIMARY KEY,
  username   TEXT    NOT NULL UNIQUE,  -- lowercase, ^[a-z0-9_-]{3,16}$
  email      TEXT,
  pw_hash    TEXT    NOT NULL,         -- PBKDF2-SHA256, hex
  pw_salt    TEXT    NOT NULL,         -- hex
  pw_iter    INTEGER NOT NULL,         -- iterations used, so they can be raised later
  pid        TEXT    NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- Login sessions. Only the SHA-256 of the cookie token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
