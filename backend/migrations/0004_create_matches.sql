-- PvP matches (challenge-link rooms). One row per round, one match_players row per player.
-- pid links a player to their scores / account (users.pid); name is how they appeared then.
CREATE TABLE IF NOT EXISTS matches (
  id         TEXT    PRIMARY KEY,  -- room code + room creation time + round
  room       TEXT    NOT NULL,
  mode       TEXT    NOT NULL,
  duration   INTEGER NOT NULL,
  started_at INTEGER NOT NULL,     -- server ms of GO
  ended_at   INTEGER NOT NULL,
  winner     TEXT                  -- pid; NULL = draw
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id   TEXT    NOT NULL,
  pid        TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  registered INTEGER NOT NULL DEFAULT 0,
  strokes    INTEGER NOT NULL,
  result     TEXT    NOT NULL,     -- win | loss | draw
  status     TEXT    NOT NULL,     -- ok | rejected (anti-cheat) | forfeit (no result in time)
  detail     TEXT,                 -- JSON: bins, fps, grip, split
  ended_at   INTEGER NOT NULL,     -- copied from matches, for "latest matches of a player"
  PRIMARY KEY (match_id, pid)
);

CREATE INDEX IF NOT EXISTS idx_match_players_pid ON match_players (pid, ended_at);
