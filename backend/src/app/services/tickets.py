"""Room tickets: signed proof of who joins which PvP room.

The API checks the player (account cookie, or guest pid + name) once and signs a ticket. The room's
Durable Object only verifies the signature, so it never needs cookies or D1 lookups. The creator's
ticket also carries the room settings: a room comes into existence when its creator connects.
"""

import re
import secrets
from dataclasses import dataclass

from app import rules
from app.services.tokens import sign_payload, verify_payload

ROOM_CODE_RE = re.compile(rules.ROOM_CODE_PATTERN)
_KIND = "room"


@dataclass(frozen=True, slots=True)
class Ticket:
    room: str
    pid: str
    name: str
    registered: bool
    expires_ms: int
    # Only on the creator's ticket: the settings the room starts with
    mode: str | None = None
    duration: int | None = None


def new_room_code() -> str:
    return "".join(secrets.choice(rules.ROOM_CODE_ALPHABET) for _ in range(rules.ROOM_CODE_LEN))


def issue(secret: str, ticket: Ticket) -> str:
    payload: dict[str, object] = {
        "k": _KIND,
        "r": ticket.room,
        "p": ticket.pid,
        "n": ticket.name,
        "u": ticket.registered,
        "e": ticket.expires_ms,
    }
    if ticket.mode is not None:
        payload["m"], payload["d"] = ticket.mode, ticket.duration
    return sign_payload(secret, payload)


def verify(secret: str, token: str, room: str, now_ms: int) -> Ticket | None:
    """The ticket if it is genuine, for this room and not expired."""
    p = verify_payload(secret, token)
    if p is None or p.get("k") != _KIND or p.get("r") != room:
        return None
    pid, name, registered, expires = p.get("p"), p.get("n"), p.get("u"), p.get("e")
    if not (isinstance(pid, str) and isinstance(name, str) and isinstance(registered, bool)):
        return None
    if isinstance(expires, bool) or not isinstance(expires, int) or expires <= now_ms:
        return None
    mode, duration = p.get("m"), p.get("d")
    if mode is not None and not (mode in rules.PVP_MODES and rules.is_valid_duration(mode, duration)):
        return None
    return Ticket(
        room=room,
        pid=pid,
        name=name,
        registered=registered,
        expires_ms=expires,
        mode=mode if isinstance(mode, str) else None,
        duration=duration if isinstance(duration, int) else None,
    )
