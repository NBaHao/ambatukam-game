-- Friends between accounts. One row per request: accepted_at NULL = still pending.
-- A friendship is an accepted row in either direction.
CREATE TABLE IF NOT EXISTS friendships (
  requester_id TEXT    NOT NULL,  -- users.id
  addressee_id TEXT    NOT NULL,  -- users.id
  created_at   INTEGER NOT NULL,
  accepted_at  INTEGER,
  PRIMARY KEY (requester_id, addressee_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships (addressee_id);
