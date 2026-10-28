"""Token phiên chơi: base64url(JSON) + "." + base64url(HMAC-SHA256).

Server ký lúc bắt đầu ván (mode, duration, thời điểm, mã ván) để khi nộp điểm đối chiếu được thời lượng
thật và để mỗi token chỉ nộp được cho một ván.
"""

import base64
import binascii
import hashlib
import hmac
import json
import math
import secrets
from dataclasses import dataclass

from app.rules import is_valid_duration


@dataclass(frozen=True, slots=True)
class Session:
    mode: str
    duration: int
    started_ms: int
    run_id: str


def new_session(mode: str, duration: int, now_ms: int) -> Session:
    return Session(mode=mode, duration=duration, started_ms=now_ms, run_id=secrets.token_urlsafe(12))


def sign(secret: str, session: Session) -> str:
    payload = {"m": session.mode, "d": session.duration, "t": session.started_ms, "n": session.run_id}
    body = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    return f"{body}.{_b64url(_mac(secret, body))}"


def verify(secret: str, token: str) -> Session | None:
    body, dot, sig = token.partition(".")
    if not body or not dot or not sig:
        return None
    try:
        if not hmac.compare_digest(_unb64url(sig), _mac(secret, body)):
            return None
        p = json.loads(_unb64url(body))
    except (ValueError, binascii.Error):
        return None
    if not isinstance(p, dict):
        return None
    mode, duration, started, run_id = p.get("m"), p.get("d"), p.get("t"), p.get("n")
    if not isinstance(mode, str) or not is_valid_duration(mode, duration):
        return None
    if isinstance(started, bool) or not isinstance(started, int | float) or not math.isfinite(started):
        return None
    if not isinstance(run_id, str) or not run_id:
        return None
    return Session(mode=mode, duration=duration, started_ms=int(started), run_id=run_id)


def _mac(secret: str, body: str) -> bytes:
    return hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64url(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
