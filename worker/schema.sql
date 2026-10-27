-- Mỗi người chơi (pid) giữ một dòng điểm cao nhất cho mỗi chế độ + mốc thời gian.
-- duration = 10/20/30 cho single/double, 0 cho random.
-- score: single/double = tổng nhát, random = số giây sống sót.
CREATE TABLE IF NOT EXISTS scores (
  pid        TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  mode       TEXT    NOT NULL,
  duration   INTEGER NOT NULL,
  score      REAL    NOT NULL,
  strokes    INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (pid, mode, duration)
);

CREATE INDEX IF NOT EXISTS idx_board ON scores (mode, duration, score DESC, updated_at);
