"""Password reset by email: a one-time link, valid RESET_TTL_MIN minutes.

Asking for a link never says whether the account exists or has an email (no account probing).
Using it sets the new password, ends every session of the account and logs this device in.
"""

import html
import secrets
from typing import Any

from app import rules
from app.db import UserRepository
from app.errors import ApiError
from app.services import accounts, passwords
from app.services.mailer import Email, Send

MIN_MS = 60_000

_TEXT = {
    "en": {
        "subject": "Reset your Ambatukam password",
        "body": (
            "Hi {name},\n\nSomeone (hopefully you) asked to reset the password of the Ambatukam account "
            '"{name}". Open this link within {ttl} minutes to choose a new one:\n\n{link}\n\n'
            "If it wasn't you, ignore this email: your password stays the same."
        ),
        "button": "Choose a new password",
    },
    "vi": {
        "subject": "Đặt lại mật khẩu Ambatukam",
        "body": (
            "Chào {name},\n\nCó người (hy vọng là bạn) muốn đặt lại mật khẩu tài khoản Ambatukam "
            '"{name}". Mở link này trong {ttl} phút để chọn mật khẩu mới:\n\n{link}\n\n'
            "Nếu không phải bạn, cứ bỏ qua email này: mật khẩu vẫn giữ nguyên."
        ),
        "button": "Chọn mật khẩu mới",
    },
}


def reset_email(to: str, name: str, link: str, lang: str) -> Email:
    s = _TEXT.get(lang, _TEXT["en"])
    text = s["body"].format(name=name, ttl=rules.RESET_TTL_MIN, link=link)
    paras = "".join(
        f"<p>{html.escape(p).replace(html.escape(link), _button(link, s['button']))}</p>"
        for p in text.split("\n\n")
    )
    return Email(
        to=to, subject=s["subject"], text=text, html=f'<div style="font-family:sans-serif">{paras}</div>'
    )


def _button(link: str, label: str) -> str:
    href = html.escape(link, quote=True)
    return f'<a href="{href}">{html.escape(label)}</a><br><small>{html.escape(link)}</small>'


async def request(
    users: UserRepository, send: Send, *, username: str, origin: str, lang: str, now: int
) -> None:
    """Email a reset link if the account exists and has an email. Silent either way."""
    user = await users.by_username(username)
    if not user or not user.get("email"):
        return
    last = await users.last_reset_at(user["id"])
    if last is not None and now - last < rules.RESET_GAP_SEC * 1000:
        return
    token = secrets.token_urlsafe(32)
    await users.create_reset(accounts.token_hash(token), user["id"], now, now + rules.RESET_TTL_MIN * MIN_MS)
    try:
        await send(reset_email(user["email"], user["username"], f"{origin}/reset/{token}", lang))
    except Exception as exc:
        print(f"reset: email failed: {exc!r}")  # no address or token in logs
        raise ApiError("email_failed", 502) from exc


async def complete(
    users: UserRepository, kdf: passwords.Kdf, *, token: str, password: str, now: int
) -> tuple[dict[str, Any], str]:
    """Set the new password from a valid link. Returns (user, new session token)."""
    user_id = await users.use_reset(accounts.token_hash(token), now) if 0 < len(token) <= 128 else None
    user = user_id and await users.by_id(user_id)
    if not user:
        raise ApiError("bad_reset", 400)
    pw = await passwords.hash_password(kdf, password, rules.PW_ITERATIONS)
    session = secrets.token_urlsafe(32)
    await users.reset_password(
        user["id"],
        pw.hash,
        pw.salt,
        pw.iterations,
        accounts.token_hash(session),
        now,
        accounts.session_expiry(now),
    )
    return user, session


async def change_email(
    users: UserRepository, kdf: passwords.Kdf, user: dict[str, Any], *, email: str | None, password: str
) -> None:
    """Add, change or remove the account's email. Needs the password: whoever holds a stolen session
    must not be able to point resets at their own inbox."""
    stored = passwords.PasswordHash(user["pw_hash"], user["pw_salt"], user["pw_iter"])
    if not await passwords.verify_password(kdf, password, stored):
        raise ApiError("bad_login", 401)
    await users.set_email(user["id"], email)
