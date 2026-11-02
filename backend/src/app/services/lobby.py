"""Lobby socket rules (the I/O is in src/lobby_room.py): message validation and throttling.

Client -> server: {"t": "ping", "c"} | {"t": "sync"} | {"t": "invite", "to", "code", "mode", "duration"}
                  | {"t": "decline", "to", "code"} | {"t": "nudge", "to"}
                  | {"t": "queue", "mode", "duration"} | {"t": "unqueue"}
                  | {"t": "hb"} (keep-alive, answered {"t": "hb"} by the runtime itself)
Server -> client: {"t": "hello", "name", "online": [friends online]} | {"t": "online", "user", "on"}
                  | {"t": "invite", "from", "code", "mode", "duration"} | {"t": "invited", "to", "code"}
                  | {"t": "declined", "by", "code"} | {"t": "friends_changed"} | {"t": "pong", "c", "s"}
                  | {"t": "queued", "mode", "duration"}
                  | {"t": "matched", "code", "ticket", "mode", "duration", "opponent": {"name", "registered"}}
                  | {"t": "error", "code"}

Matchmaking: a player waiting for a random opponent carries {"m": mode, "d": duration, "at": ms} as "q"
in its socket attachment, so the queue survives the object hibernating. The oldest waiting player on the
same board is picked; both get a ticket for a new room (each ticket can open it, whoever comes first).
"""

import re
from typing import Any

from app import rules
from app.services.tickets import ROOM_CODE_RE

_USERNAME_RE = re.compile(rules.USERNAME_PATTERN)


def target(msg: dict[str, Any]) -> str | None:
    """The username a message is addressed to, if well-formed."""
    to = msg.get("to")
    return to if isinstance(to, str) and _USERNAME_RE.match(to) else None


def room_code(msg: dict[str, Any]) -> str | None:
    code = msg.get("code")
    return code if isinstance(code, str) and ROOM_CODE_RE.match(code) else None


def queue_board(msg: dict[str, Any]) -> tuple[str, int] | None:
    """The board (mode, duration) a matchmaking request is for, if valid."""
    mode, duration = msg.get("mode"), msg.get("duration")
    if mode not in rules.PVP_MODES or isinstance(duration, bool):
        return None
    return (mode, duration) if rules.is_valid_duration(mode, duration) else None


def invite(msg: dict[str, Any]) -> dict[str, Any] | None:
    """A well-formed PvP invite: who to, which room, and its settings (shown to the invitee)."""
    to, code, board = target(msg), room_code(msg), queue_board(msg)
    if to is None or code is None or board is None:
        return None
    return {"to": to, "code": code, "mode": board[0], "duration": board[1]}


def pick_opponent(me: dict[str, Any], others: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The player waiting longest on my board, not me (my other tabs share my pid)."""
    q = me["q"]
    waiting = [
        o
        for o in others
        if o.get("q") and o["q"]["m"] == q["m"] and o["q"]["d"] == q["d"] and o["pid"] != me["pid"]
    ]
    return min(waiting, key=lambda o: o["q"]["at"], default=None)


class Throttle:
    """At most one action per key per `gap_ms` (kept in memory: a lobby restart just resets it)."""

    def __init__(self, gap_ms: int) -> None:
        self.gap_ms = gap_ms
        self._last: dict[str, int] = {}

    def allow(self, key: str, now: int) -> bool:
        if now - self._last.get(key, -self.gap_ms) < self.gap_ms:
            return False
        self._last[key] = now
        if len(self._last) > 10_000:  # forget old keys
            cutoff = now - self.gap_ms
            self._last = {k: t for k, t in self._last.items() if t > cutoff}
        return True
