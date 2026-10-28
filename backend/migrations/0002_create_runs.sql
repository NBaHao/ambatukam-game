-- Mỗi ván đã nộp điểm (id = mã ván trong token phiên chơi), để một token chỉ dùng cho một ván.
-- detail: JSON số liệu client gửi kèm { bins, fps, grip, split? } để xem lại khi điểm đáng ngờ.
CREATE TABLE IF NOT EXISTS runs (
  id         TEXT    PRIMARY KEY,
  pid        TEXT    NOT NULL,
  mode       TEXT    NOT NULL,
  duration   INTEGER NOT NULL,
  score      REAL    NOT NULL,
  strokes    INTEGER NOT NULL,
  detail     TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
