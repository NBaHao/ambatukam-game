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

    async def create_session(
        self, token_hash: str, user_id: str, now: int, expires_at: int, *, keep: int
    ) -> None:
        """Open a session, drop this account's expired ones and keep only the newest `keep`."""
        await self._db.batch(
            [
                self._db.prepare(_INSERT_SESSION).bind(token_hash, user_id, now, expires_at),
                self._db.prepare("DELETE FROM sessions WHERE user_id = ?1 AND expires_at <= ?2").bind(
                    user_id, now
                ),
                self._db.prepare(
                    "DELETE FROM sessions WHERE user_id = ?1 AND token_hash NOT IN "
                    "(SELECT token_hash FROM sessions WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ?2)"
                ).bind(user_id, keep),
            ]
        )

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

    async def set_email(self, user_id: str, email: str | None) -> None:
        await self._db.prepare("UPDATE users SET email = ?2 WHERE id = ?1").bind(user_id, email or "").all()

    async def last_reset_at(self, user_id: str) -> int | None:
        rows = _rows(
            await self._db.prepare("SELECT MAX(created_at) AS at FROM password_resets WHERE user_id = ?1")
            .bind(user_id)
            .all()
        )
        return rows[0]["at"] if rows else None

    async def create_reset(self, token_hash: str, user_id: str, now: int, expires_at: int) -> None:
        """Store a reset link; older unused links of the account stop working."""
        await self._db.batch(
            [
                self._db.prepare(
                    "DELETE FROM password_resets "
                    "WHERE user_id = ?1 AND (used_at IS NOT NULL OR expires_at <= ?2)"
                ).bind(user_id, now),
                self._db.prepare(
                    "UPDATE password_resets SET expires_at = ?2 WHERE user_id = ?1 AND expires_at > ?2"
                ).bind(user_id, now),
                self._db.prepare(
                    "INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) "
                    "VALUES (?1, ?2, ?3, ?4)"
                ).bind(token_hash, user_id, now, expires_at),
            ]
        )

    async def use_reset(self, token_hash: str, now: int) -> str | None:
        """Mark a valid link as used and return its account id (None if unknown, used or expired)."""
        rows = _rows(
            await self._db.prepare(
                "UPDATE password_resets SET used_at = ?2 "
                "WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2 RETURNING user_id"
            )
            .bind(token_hash, now)
            .all()
        )
        return rows[0]["user_id"] if rows else None

    async def reset_password(
        self,
        user_id: str,
        pw_hash: str,
        pw_salt: str,
        pw_iter: int,
        token_hash: str,
        now: int,
        expires_at: int,
    ) -> None:
        """New password, every session ends (a thief is logged out), then one new session."""
        await self._db.batch(
            [
                self._db.prepare(
                    "UPDATE users SET pw_hash = ?2, pw_salt = ?3, pw_iter = ?4 WHERE id = ?1"
                ).bind(user_id, pw_hash, pw_salt, pw_iter),
                self._db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(user_id),
                self._db.prepare(_INSERT_SESSION).bind(token_hash, user_id, now, expires_at),
            ]
        )

    async def by_id(self, user_id: str) -> dict[str, Any] | None:
        return await self._user(f"SELECT {_USER_COLS} FROM users WHERE id = ?1", user_id)


_INSERT_MATCH = """
INSERT INTO matches (id, room, mode, duration, started_at, ended_at, winner)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULLIF(?7, ''))
ON CONFLICT (id) DO NOTHING
"""

_INSERT_MATCH_PLAYER = """
INSERT INTO match_players (match_id, pid, name, registered, strokes, result, status, detail, ended_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULLIF(?8, ''), ?9)
ON CONFLICT (match_id, pid) DO NOTHING
"""


class MatchRepository:
    def __init__(self, db: D1Database) -> None:
        self._db = db

    async def record(self, match: dict[str, Any]) -> None:
        """Store a finished PvP round (see services/room.py `RoomLogic.record`)."""
        mid, ended = match["id"], match["ended_at"]
        await self._db.batch(
            [
                self._db.prepare(_INSERT_MATCH).bind(
                    mid,
                    match["room"],
                    match["mode"],
                    match["duration"],
                    match["started_at"],
                    ended,
                    match["winner"] or "",
                ),
                *(
                    self._db.prepare(_INSERT_MATCH_PLAYER).bind(
                        mid,
                        p["pid"],
                        p["name"],
                        1 if p["registered"] else 0,
                        p["strokes"],
                        p["result"],
                        p["status"],
                        json.dumps(p["detail"]) if p["detail"] else "",
                        ended,
                    )
                    for p in match["players"]
                ),
            ]
        )


# ---------- Profiles ----------

# Every best score of a player, with its current rank on that board
_PROFILE_RECORDS = """
SELECT s.mode, s.duration, s.score, s.strokes,
  (SELECT COUNT(*) FROM scores o WHERE o.mode = s.mode AND o.duration = s.duration
     AND (o.score > s.score OR (o.score = s.score AND o.updated_at < s.updated_at))) + 1 AS rank,
  (SELECT COUNT(*) FROM scores o WHERE o.mode = s.mode AND o.duration = s.duration) AS total
FROM scores s WHERE s.pid = ?1
"""

_PROFILE_PVP = """
SELECT COUNT(*) AS played,
  COALESCE(SUM(result = 'win'), 0) AS wins,
  COALESCE(SUM(result = 'loss'), 0) AS losses,
  COALESCE(SUM(result = 'draw'), 0) AS draws
FROM match_players WHERE pid = ?1
"""

# Latest rounds with the opponent; the opponent's username only if they played as that account
_PROFILE_MATCHES = """
SELECT m.id, m.mode, m.duration, me.ended_at, me.result, me.status, me.strokes,
  op.name AS opp_name, op.strokes AS opp_strokes, op.status AS opp_status, u.username AS opp_username
FROM match_players me
JOIN matches m ON m.id = me.match_id
LEFT JOIN match_players op ON op.match_id = me.match_id AND op.pid != me.pid
LEFT JOIN users u ON u.pid = op.pid AND op.registered = 1
WHERE me.pid = ?1
ORDER BY me.ended_at DESC
LIMIT ?2
"""

_RECORD_KEYS = ("mode", "duration", "score", "strokes", "rank", "total")
_MATCH_KEYS = (
    "id",
    "mode",
    "duration",
    "ended_at",
    "result",
    "status",
    "strokes",
    "opp_name",
    "opp_strokes",
    "opp_status",
    "opp_username",
)


class ProfileRepository:
    def __init__(self, db: D1Database) -> None:
        self._db = db

    async def stats(self, pid: str, history: int) -> dict[str, Any]:
        """Records, PvP totals and the latest `history` PvP rounds of one player id."""
        records, pvp, matches = await self._db.batch(
            [
                self._db.prepare(_PROFILE_RECORDS).bind(pid),
                self._db.prepare(_PROFILE_PVP).bind(pid),
                self._db.prepare(_PROFILE_MATCHES).bind(pid, history),
            ]
        )
        totals = _rows(pvp)[0]
        return {
            "records": [{k: r[k] for k in _RECORD_KEYS} for r in _rows(records)],
            "pvp": {k: int(totals[k] or 0) for k in ("played", "wins", "losses", "draws")},
            "matches": [{k: r[k] for k in _MATCH_KEYS} for r in _rows(matches)],
        }


# ---------- Friends ----------

_FRIEND_ROWS = """
SELECT u.username, f.created_at, f.accepted_at, 1 AS outgoing
FROM friendships f JOIN users u ON u.id = f.addressee_id WHERE f.requester_id = ?1
UNION ALL
SELECT u.username, f.created_at, f.accepted_at, 0 AS outgoing
FROM friendships f JOIN users u ON u.id = f.requester_id WHERE f.addressee_id = ?1
"""

_BETWEEN = """
SELECT requester_id, addressee_id, accepted_at FROM friendships
WHERE (requester_id = ?1 AND addressee_id = ?2) OR (requester_id = ?2 AND addressee_id = ?1)
"""

_FRIEND_COUNTS = """
SELECT
  (SELECT COUNT(*) FROM friendships
     WHERE accepted_at IS NOT NULL AND (requester_id = ?1 OR addressee_id = ?1)) AS friends,
  (SELECT COUNT(*) FROM friendships WHERE accepted_at IS NULL AND requester_id = ?1) AS outgoing
"""

# By username, for the lobby (which only knows usernames)
_FRIEND_NAMES = """
SELECT u.username FROM friendships f JOIN users u ON u.id = f.addressee_id
WHERE f.requester_id = (SELECT id FROM users WHERE username = ?1) AND f.accepted_at IS NOT NULL
UNION
SELECT u.username FROM friendships f JOIN users u ON u.id = f.requester_id
WHERE f.addressee_id = (SELECT id FROM users WHERE username = ?1) AND f.accepted_at IS NOT NULL
"""

_NAMES_BETWEEN = """
SELECT f.accepted_at FROM friendships f
JOIN users a ON a.username = ?1 JOIN users b ON b.username = ?2
WHERE (f.requester_id = a.id AND f.addressee_id = b.id) OR (f.requester_id = b.id AND f.addressee_id = a.id)
"""


class FriendRepository:
    def __init__(self, db: D1Database) -> None:
        self._db = db

    async def rows(self, uid: str) -> list[dict[str, Any]]:
        """Every friendship row of `uid`: username of the other side, created_at, accepted_at, outgoing."""
        res = await self._db.prepare(_FRIEND_ROWS).bind(uid).all()
        keys = ("username", "created_at", "accepted_at", "outgoing")
        return [{k: r[k] for k in keys} for r in _rows(res)]

    async def between(self, a: str, b: str) -> list[dict[str, Any]]:
        res = await self._db.prepare(_BETWEEN).bind(a, b).all()
        return [{k: r[k] for k in ("requester_id", "addressee_id", "accepted_at")} for r in _rows(res)]

    async def counts(self, uid: str) -> dict[str, int]:
        row = _rows(await self._db.prepare(_FRIEND_COUNTS).bind(uid).all())[0]
        return {"friends": int(row["friends"]), "outgoing": int(row["outgoing"])}

    async def create(self, requester: str, addressee: str, now: int) -> None:
        await (
            self._db.prepare(
                "INSERT INTO friendships (requester_id, addressee_id, created_at) VALUES (?1, ?2, ?3) "
                "ON CONFLICT DO NOTHING"
            )
            .bind(requester, addressee, now)
            .all()
        )

    async def accept(self, requester: str, addressee: str, now: int) -> None:
        """Accept `requester`'s request and drop a crossing request the other way, if any."""
        await self._db.batch(
            [
                self._db.prepare(
                    "UPDATE friendships SET accepted_at = ?3 "
                    "WHERE requester_id = ?1 AND addressee_id = ?2 AND accepted_at IS NULL"
                ).bind(requester, addressee, now),
                self._db.prepare(
                    "DELETE FROM friendships "
                    "WHERE requester_id = ?2 AND addressee_id = ?1 AND accepted_at IS NULL"
                ).bind(requester, addressee),
            ]
        )

    async def delete(self, a: str, b: str) -> None:
        await (
            self._db.prepare(
                "DELETE FROM friendships "
                "WHERE (requester_id = ?1 AND addressee_id = ?2) OR (requester_id = ?2 AND addressee_id = ?1)"
            )
            .bind(a, b)
            .all()
        )

    async def friend_names(self, username: str) -> list[str]:
        """Usernames of `username`'s friends (accepted only)."""
        return [r["username"] for r in _rows(await self._db.prepare(_FRIEND_NAMES).bind(username).all())]

    async def link(self, a: str, b: str) -> str | None:
        """Between two usernames: "friends", "pending" (a request either way) or None."""
        rows = _rows(await self._db.prepare(_NAMES_BETWEEN).bind(a, b).all())
        if not rows:
            return None
        return "friends" if any(r["accepted_at"] is not None for r in rows) else "pending"
