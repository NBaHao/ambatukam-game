"""Cấu hình đọc từ binding của Worker (vars + secrets trong wrangler.jsonc / .dev.vars)."""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class Settings:
    token_secret: str
    turnstile_secret: str

    @classmethod
    def from_env(cls, env: Any) -> "Settings":
        return cls(
            token_secret=_require(env, "TOKEN_SECRET"),
            turnstile_secret=_require(env, "TURNSTILE_SECRET"),
        )


def _require(env: Any, name: str) -> str:
    value = getattr(env, name, None)
    if not isinstance(value, str) or not value:
        raise RuntimeError(f"{name} is not set (wrangler secret put {name}, or backend/.dev.vars locally)")
    return value
