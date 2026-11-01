"""Truy vấn D1. Binding `DB` được SDK Python Workers bọc lại: tham số Python tự đổi sang JS,
kết quả trả về là dict-like (đọc được cả `res.results` lẫn `row["col"]`)."""

import json
from typing import Any, Protocol

from app.rules import TOP_N


class D1Statement(Protocol):
    def bind(self, *values: Any) -> "D1Statement": ...
    async def all(self) -> Any: ...


class D1Database(Protocol):
    def prepare(self, query: str) -> D1Statement: ...
    async def batch(self, statements: list[D1Statement]) -> list[Any]: ...


# Ván ?1 đã được ghi cho đúng pid ?2 với đúng điểm ?3 / số nhát ?4
_OWNS_RUN = "EXISTS (SELECT 1 FROM runs WHERE id = ?1 AND pid = ?2 AND score = ?3 AND strokes = ?4)"

_INSERT_RUN = """
INSERT INTO runs (id, pid, mode, duration, score, strokes, detail, created_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
ON CONFLICT (id) DO NOTHING
"""

_UPSERT_SCORE = f"""
INSERT INTO scores (pid, name, mode, duration, score, strokes, updated_at)
SELECT ?2, ?5, ?6, ?7, ?3, ?4, ?8 WHERE {_OWNS_RUN}
ON CONFLICT (pid, mode, duration) DO UPDATE SET
  name = excluded.name,
  score = MAX(scores.score, excluded.score),
  strokes = CASE WHEN excluded.score > scores.score THEN excluded.strokes ELSE scores.strokes END,
  updated_at = CASE WHEN excluded.score > scores.score THEN excluded.updated_at ELSE scores.updated_at END
"""

# Tên luôn cập nhật theo lần nộp mới nhất, cho mọi chế độ của người chơi này
_RENAME = f"UPDATE scores SET name = ?5 WHERE pid = ?2 AND {_OWNS_RUN}"

_TOP = """
SELECT s.name, s.score, s.strokes, s.pid = ?3 AS me, u.id IS NOT NULL AS registered
FROM scores s LEFT JOIN users u ON u.pid = s.pid
WHERE s.mode = ?1 AND s.duration = ?2
ORDER BY s.score DESC, s.updated_at ASC
LIMIT ?4
"""

# Hạng của một người chơi: số người điểm cao hơn (hoặc bằng điểm nhưng đạt trước) + 1
_MY_RANK = """
SELECT s.name, s.score, s.strokes,
  (SELECT COUNT(*) FROM scores o WHERE o.mode = s.mode AND o.duration = s.duration
     AND (o.score > s.score OR (o.score = s.score AND o.updated_at < s.updated_at))) + 1 AS rank,
  (SELECT COUNT(*) FROM scores o WHERE o.mode = s.mode AND o.duration = s.duration) AS total
FROM scores s WHERE s.pid = ?3 AND s.mode = ?1 AND s.duration = ?2
"""


def _rows(result: Any) -> list[Any]:
    return list(result["results"] or [])


def _plain(row: Any) -> dict[str, Any]:
    return {k: row[k] for k in ("name", "score", "strokes", "rank", "total")}


class ScoreRepository:
    def __init__(self, db: D1Database) -> None:
        self._db = db

    def _my_rank(self, mode: str, duration: int, pid: str) -> D1Statement:
        return self._db.prepare(_MY_RANK).bind(mode, duration, pid)

    async def record_run(
        self,
        *,
        run_id: str,
        pid: str,
        name: str,
        mode: str,
        duration: int,
        score: float,
        strokes: int,
        detail: dict[str, Any],
        now_ms: int,
    ) -> dict[str, Any] | None:
        """Ghi ván + điểm trong một batch (một transaction của D1).

        Mỗi token là một ván. Lần nộp đầu ghi ván cho pid + điểm; nộp lại chỉ để đổi tên, phải cùng
        pid và cùng điểm. Mọi câu ghi vào scores đều kèm điều kiện đó. Trả về hạng hiện tại,
        hoặc None nếu ván này đã thuộc về người khác / điểm khác.
        """
        owns = (run_id, pid, score, strokes)
        results = await self._db.batch(
            [
                self._db.prepare(_INSERT_RUN).bind(
                    run_id, pid, mode, duration, score, strokes, json.dumps(detail), now_ms
                ),
                self._db.prepare(_UPSERT_SCORE).bind(*owns, name, mode, duration, now_ms),
                self._db.prepare(_RENAME).bind(*owns, name),
                self._db.prepare(f"SELECT {_OWNS_RUN} AS ok").bind(*owns),
                self._my_rank(mode, duration, pid),
            ]
        )
        if not _rows(results[3])[0]["ok"]:
            return None
        return _plain(_rows(results[4])[0])

    async def leaderboard(self, mode: str, duration: int, pid: str | None) -> dict[str, Any]:
        top = self._db.prepare(_TOP).bind(mode, duration, pid or "", TOP_N)
        results = await self._db.batch([top, self._my_rank(mode, duration, pid)] if pid else [top])
        entries = [
            {
                "name": r["name"],
                "score": r["score"],
                "strokes": r["strokes"],
                "me": bool(r["me"]),
                "registered": bool(r["registered"]),
            }
            for r in _rows(results[0])
        ]
        mine = _rows(results[1]) if pid else []
        return {"entries": entries, "me": _plain(mine[0]) if mine else None}


_USER_COLS = "id, username, email, pw_hash, pw_salt, pw_iter, pid, created_at"

# Every write of a new account is guarded by "the user row now exists": if the INSERT lost to a
# taken username, the rest of the batch does nothing.
_USER_ROW = "EXISTS (SELECT 1 FROM users WHERE id = ?1)"

_INSERT_USER = f"""
INSERT INTO users ({_USER_COLS})
VALUES (?1, ?2, NULLIF(?3, ''), ?4, ?5, ?6, ?7, ?8)
ON CONFLICT DO NOTHING
"""

_INSERT_SESSION = "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)"


_USER_KEYS = _USER_COLS.split(", ")


class UserRepository:
    def __init__(self, db: D1Database) -> None:
        self._db = db

    async def _user(self, query: str, *values: Any, extra: tuple[str, ...] = ()) -> dict[str, Any] | None:
        rows = _rows(await self._db.prepare(query).bind(*values).all())
        return {k: rows[0][k] for k in (*_USER_KEYS, *extra)} if rows else None

    async def by_username(self, username: str) -> dict[str, Any] | None:
        return await self._user(f"SELECT {_USER_COLS} FROM users WHERE username = ?1", username)

    async def by_pid(self, pid: str) -> dict[str, Any] | None:
        return await self._user(f"SELECT {_USER_COLS} FROM users WHERE pid = ?1", pid)

    async def create(self, user: dict[str, Any], token_hash: str, expires_at: int) -> bool:
        """Create the account, give its pid's scores the username and open a session, atomically.

        Returns False (and writes nothing) if the username or pid is already taken.
        """
        uid, now = user["id"], user["created_at"]
        results = await self._db.batch(
            [
                self._db.prepare(_INSERT_USER).bind(
                    uid,
                    user["username"],
                    user["email"] or "",
                    user["pw_hash"],
                    user["pw_salt"],
                    user["pw_iter"],
                    user["pid"],
                    now,
                ),
                self._db.prepare(f"UPDATE scores SET name = ?2 WHERE pid = ?3 AND {_USER_ROW}").bind(
                    uid, user["username"], user["pid"]
                ),
                self._db.prepare(
                    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) "
                    f"SELECT ?2, ?1, ?3, ?4 WHERE {_USER_ROW}"
                ).bind(uid, token_hash, now, expires_at),
                self._db.prepare(f"SELECT {_USER_ROW} AS ok").bind(uid),
            ]
        )
        return bool(_rows(results[3])[0]["ok"])

    async def create_session(self, token_hash: str, user_id: str, now: int, expires_at: int) -> None:
        await self._db.prepare(_INSERT_SESSION).bind(token_hash, user_id, now, expires_at).all()

    async def session_user(self, token_hash: str, now: int) -> dict[str, Any] | None:
        """The account behind a session token, plus `expires_at`. None if unknown or expired."""
        cols = ", ".join(f"u.{c}" for c in _USER_KEYS)
        return await self._user(
            f"SELECT {cols}, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token_hash = ?1 AND s.expires_at > ?2",
            token_hash,
            now,
            extra=("expires_at",),
        )

    async def extend_session(self, token_hash: str, expires_at: int) -> None:
        await (
            self._db.prepare("UPDATE sessions SET expires_at = ?2 WHERE token_hash = ?1")
            .bind(token_hash, expires_at)
            .all()
        )

    async def delete_session(self, token_hash: str) -> None:
        await self._db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(token_hash).all()

    async def update_password(self, user_id: str, pw_hash: str, pw_salt: str, pw_iter: int) -> None:
        await (
            self._db.prepare("UPDATE users SET pw_hash = ?2, pw_salt = ?3, pw_iter = ?4 WHERE id = ?1")
            .bind(user_id, pw_hash, pw_salt, pw_iter)
            .all()
        )
