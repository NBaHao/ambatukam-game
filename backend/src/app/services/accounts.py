"""Accounts (TETR.IO-style): register, log in, sessions, and who a submitted score belongs to."""

import hashlib
import secrets
import unicodedata
import uuid
from dataclasses import dataclass
from typing import Any

from app import rules
from app.db import UserRepository
from app.errors import ApiError
from app.services import passwords

COOKIE = "amb_sid"
DAY_MS = 86_400_000


@dataclass(frozen=True, slots=True)
class Session:
    user: dict[str, Any]
    token_hash: str
    expires_at: int


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def session_expiry(now_ms: int) -> int:
    return now_ms + rules.SESSION_DAYS * DAY_MS


def name_key(name: str) -> str:
    """How a typed name compares to usernames: NFKC folds look-alike forms (e.g. fullwidth
    letters U+FF41..) into plain ASCII, casefold ignores case."""
    return unicodedata.normalize("NFKC", name).casefold().strip()


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    """The account as its owner sees it (/api/me): never shown to anyone else."""
    return {
        "username": user["username"],
        "pid": user["pid"],
        "created_at": user["created_at"],
        "email": user.get("email") or None,
    }


async def register(
    users: UserRepository,
    kdf: passwords.Kdf,
    *,
    username: str,
    password: str,
    email: str | None,
    pid: str,
    now_ms: int,
) -> tuple[dict[str, Any], str]:
    """Create an account that takes over `pid` (and its scores). Returns (user, session token)."""
    if await users.by_username(username):
        raise ApiError("username_taken", 409)
    if await users.by_pid(pid):
        pid = str(uuid.uuid4())  # this device's pid already belongs to another account: start fresh
    pw = await passwords.hash_password(kdf, password, rules.PW_ITERATIONS)
    user = {
        "id": uuid.uuid4().hex,
        "username": username,
        "email": email,
        "pw_hash": pw.hash,
        "pw_salt": pw.salt,
        "pw_iter": pw.iterations,
        "pid": pid,
        "created_at": now_ms,
    }
    token = secrets.token_urlsafe(32)
    if not await users.create(user, token_hash(token), session_expiry(now_ms)):
        raise ApiError("username_taken", 409)  # lost a race for the same name
    return user, token


async def login(
    users: UserRepository, kdf: passwords.Kdf, *, username: str, password: str, now_ms: int
) -> tuple[dict[str, Any], str]:
    user = await users.by_username(username)
    stored = user and passwords.PasswordHash(user["pw_hash"], user["pw_salt"], user["pw_iter"])
    if not user or not stored or not await passwords.verify_password(kdf, password, stored):
        raise ApiError("bad_login", 401)
    if stored.iterations < rules.PW_ITERATIONS:
        pw = await passwords.hash_password(kdf, password, rules.PW_ITERATIONS)
        await users.update_password(user["id"], pw.hash, pw.salt, pw.iterations)
    token = secrets.token_urlsafe(32)
    await users.create_session(
        token_hash(token), user["id"], now_ms, session_expiry(now_ms), keep=rules.MAX_SESSIONS
    )
    return user, token


async def current_session(users: UserRepository, token: str | None, now_ms: int) -> Session | None:
    if not token or len(token) > 128:
        return None
    hashed = token_hash(token)
    row = await users.session_user(hashed, now_ms)
    if row is None:
        return None
    expires_at = row.pop("expires_at")
    return Session(user=row, token_hash=hashed, expires_at=expires_at)


async def score_owner(users: UserRepository, session: Session | None, pid: str, name: str) -> tuple[str, str]:
    """Which (pid, name) a submitted score is recorded under.

    Logged in: always the account's pid and username. Guest: the device pid and the typed name, but a
    pid that belongs to an account needs that account's session, and a registered username is off limits.
    """
    if session is not None:
        return session.user["pid"], session.user["username"]
    if await users.by_pid(pid):
        raise ApiError("login_required", 401)
    if await users.by_username(name_key(name)):
        raise ApiError("name_taken", 409)
    return pid, name
