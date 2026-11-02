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
        "preview": "This link works for {ttl} minutes, once.",
        "title": "Reset your password",
        "hi": "Hi {name},",
        "intro": "Someone (hopefully you) asked to reset the password of your Ambatukam account {name}.",
        "button": "Choose a new password",
        "ttl": "The link works for {ttl} minutes and only once.",
        "fallback": "Button not working? Paste this link into your browser:",
        "ignore": "Didn't ask for this? Ignore this email: your password stays the same.",
    },
    "vi": {
        "subject": "Đặt lại mật khẩu Ambatukam",
        "preview": "Link dùng được {ttl} phút, một lần.",
        "title": "Đặt lại mật khẩu",
        "hi": "Chào {name},",
        "intro": "Có người (hy vọng là bạn) muốn đặt lại mật khẩu tài khoản Ambatukam {name} của bạn.",
        "button": "Chọn mật khẩu mới",
        "ttl": "Link dùng được {ttl} phút và chỉ một lần.",
        "fallback": "Nút không bấm được? Dán link này vào trình duyệt:",
        "ignore": "Không phải bạn yêu cầu? Cứ bỏ qua email này: mật khẩu vẫn giữ nguyên.",
    },
}

# Same colors as the game (frontend/src/styles/global.css). Email clients need tables and inline styles.
_BG, _PANEL, _LINE, _FG, _MUTE, _ACCENT = "#0b0b0b", "#121212", "#2a2a2a", "#f2f2f2", "#8b8b8b", "#ff3b3b"
_SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
_MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace"


def reset_email(to: str, name: str, link: str, lang: str) -> Email:
    s = {k: v.format(name=name, ttl=rules.RESET_TTL_MIN) for k, v in _TEXT.get(lang, _TEXT["en"]).items()}
    site = link.split("/reset/", 1)[0]
    text = "\n\n".join(
        [s["hi"], s["intro"], f"{s['button']}:\n{link}", s["ttl"], s["ignore"], f"Ambatukam · {site}"]
    )
    return Email(to=to, subject=s["subject"], text=text, html=_html(s, name, link, site, lang))


def _html(s: dict[str, str], name: str, link: str, site: str, lang: str) -> str:
    e = html.escape
    href = e(link, quote=True)
    intro = e(s["intro"]).replace(e(name), f'<b style="color:{_FG}">{e(name)}</b>', 1)
    p = f"margin:0 0 16px;font:16px/1.5 {_SANS};color:{_FG}"
    small = f"margin:0;font:13px/1.5 {_SANS};color:{_MUTE}"
    return f"""<!doctype html>
<html lang="{lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>{e(s["subject"])}</title></head>
<body style="margin:0;padding:0;background:{_BG}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">{e(s["preview"])}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="{_BG}"\
 style="background:{_BG}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
<tr><td style="padding:0 4px 20px;font:800 18px/1 {_MONO};letter-spacing:.12em;color:{_FG}">\
AMBATUKAM</td></tr>
<tr><td bgcolor="{_PANEL}" style="background:{_PANEL};border:1px solid {_LINE};\
border-radius:14px;padding:32px 28px">
<h1 style="margin:0 0 20px;font:800 24px/1.25 {_SANS};color:{_FG}">{e(s["title"])}</h1>
<p style="{p}">{e(s["hi"])}</p>
<p style="{p};margin-bottom:28px">{intro}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td bgcolor="{_ACCENT}" style="background:{_ACCENT};border-radius:10px">
<a href="{href}" style="display:inline-block;padding:14px 26px;font:700 16px/1 {_SANS};color:#ffffff;\
text-decoration:none;border-radius:10px">{e(s["button"])}</a></td></tr></table>
<p style="{small};margin-top:20px">{e(s["ttl"])}</p>
<div style="height:1px;background:{_LINE};margin:24px 0"></div>
<p style="{small};margin-bottom:8px">{e(s["fallback"])}</p>
<p style="margin:0;font:12px/1.5 {_MONO};word-break:break-all">\
<a href="{href}" style="color:{_MUTE};text-decoration:underline">{e(link)}</a></p>
</td></tr>
<tr><td style="padding:20px 4px 0">
<p style="{small}">{e(s["ignore"])}</p>
<p style="{small};margin-top:8px"><a href="{e(site, quote=True)}" style="color:{_MUTE}">{e(site.split("://")[-1])}</a></p>
</td></tr>
</table></td></tr></table></body></html>"""


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
