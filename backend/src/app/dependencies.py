"""FastAPI dependencies: lấy binding của Worker từ request (asgi.fetch đặt env vào scope["env"])."""

from collections.abc import Awaitable, Callable
from functools import partial
from typing import Annotated, Any

from fastapi import Cookie, Depends, Request

from app import clock
from app.config import Settings
from app.db import ProfileRepository, ScoreRepository, UserRepository
from app.errors import ApiError
from app.services import accounts, passwords, turnstile

HumanVerifier = Callable[[str], Awaitable[bool]]


def get_env(request: Request) -> Any:
    return request.scope["env"]


Env = Annotated[Any, Depends(get_env)]


def get_settings(env: Env) -> Settings:
    return Settings.from_env(env)


def get_repository(env: Env) -> ScoreRepository:
    return ScoreRepository(env.DB)


def get_users(env: Env) -> UserRepository:
    return UserRepository(env.DB)


def get_profiles(env: Env) -> ProfileRepository:
    return ProfileRepository(env.DB)


def get_kdf() -> passwords.Kdf:
    return passwords.workers_pbkdf2


async def get_session(
    users: Annotated[UserRepository, Depends(get_users)],
    amb_sid: Annotated[str | None, Cookie()] = None,
) -> accounts.Session | None:
    """The logged-in session from the `amb_sid` cookie, or None for guests."""
    return await accounts.current_session(users, amb_sid, clock.now_ms())


def get_human_verifier(settings: Annotated[Settings, Depends(get_settings)]) -> HumanVerifier:
    return partial(turnstile.verify, settings.turnstile_secret, post_form=turnstile.workers_post_form)


def rate_limit(binding: str) -> Callable[..., Awaitable[None]]:
    """Giới hạn request theo IP bằng binding ratelimits trong wrangler.jsonc."""

    async def check(request: Request, env: Env) -> None:
        await enforce_limit(env, binding, request.headers.get("cf-connecting-ip", "unknown"))

    return check


async def enforce_limit(env: Any, binding: str, key: str) -> None:
    outcome = await getattr(env, binding).limit({"key": key})
    if not outcome["success"]:
        raise ApiError("rate_limited", 429)


SettingsDep = Annotated[Settings, Depends(get_settings)]
RepositoryDep = Annotated[ScoreRepository, Depends(get_repository)]
HumanVerifierDep = Annotated[HumanVerifier, Depends(get_human_verifier)]
UsersDep = Annotated[UserRepository, Depends(get_users)]
ProfilesDep = Annotated[ProfileRepository, Depends(get_profiles)]
KdfDep = Annotated[passwords.Kdf, Depends(get_kdf)]
SessionDep = Annotated[accounts.Session | None, Depends(get_session)]
