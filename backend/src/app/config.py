"""Cấu hình đọc từ binding của Worker (vars + secrets trong wrangler.jsonc / .dev.vars)."""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class Settings:
    token_secret: str
    turnstile_secret: str
    # Optional: PvP video / voice (Cloudflare Realtime TURN). Unset = feature off
    turn_key_id: str | None = None
    turn_api_token: str | None = None
    rtc_allow_direct: bool = False  # local dev only: WebRTC without TURN (exposes IPs to the peer)
    # Optional: password reset emails through Resend. Unset = reset off
    resend_api_key: str | None = None
    mail_from: str = "Ambatukam <noreply@bahao.site>"
    # Links in emails point here (never at the request's Host header, which a client controls)
    app_origin: str = "https://ambatukam.bahao.site"
    mail_dev_log: bool = False  # local dev only: print emails to the log instead of sending them

    @classmethod
    def from_env(cls, env: Any) -> "Settings":
        return cls(
            token_secret=_require(env, "TOKEN_SECRET"),
            turnstile_secret=_require(env, "TURNSTILE_SECRET"),
            turn_key_id=_optional(env, "TURN_KEY_ID"),
            turn_api_token=_optional(env, "TURN_KEY_API_TOKEN"),
            rtc_allow_direct=_optional(env, "RTC_ALLOW_DIRECT") == "1",
            resend_api_key=_optional(env, "RESEND_API_KEY"),
            mail_from=_optional(env, "MAIL_FROM") or "Ambatukam <noreply@bahao.site>",
            app_origin=(_optional(env, "APP_ORIGIN") or "https://ambatukam.bahao.site").rstrip("/"),
            mail_dev_log=_optional(env, "MAIL_DEV_LOG") == "1",
        )


def _require(env: Any, name: str) -> str:
    value = getattr(env, name, None)
    if not isinstance(value, str) or not value:
        raise RuntimeError(f"{name} is not set (wrangler secret put {name}, or backend/.dev.vars locally)")
    return value


def _optional(env: Any, name: str) -> str | None:
    value = getattr(env, name, None)
    return value if isinstance(value, str) and value else None
