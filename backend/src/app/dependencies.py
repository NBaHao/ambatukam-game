"""FastAPI dependencies: lấy binding của Worker từ request (asgi.fetch đặt env vào scope["env"])."""

from collections.abc import Awaitable, Callable
from functools import partial
from typing import Annotated, Any

from fastapi import Depends, Request

from app.config import Settings
from app.db import ScoreRepository
from app.errors import ApiError
from app.services import turnstile

HumanVerifier = Callable[[str], Awaitable[bool]]


def get_env(request: Request) -> Any:
    return request.scope["env"]


Env = Annotated[Any, Depends(get_env)]


def get_settings(env: Env) -> Settings:
    return Settings.from_env(env)


def get_repository(env: Env) -> ScoreRepository:
    return ScoreRepository(env.DB)


def get_human_verifier(settings: Annotated[Settings, Depends(get_settings)]) -> HumanVerifier:
    return partial(turnstile.verify, settings.turnstile_secret, post_form=turnstile.workers_post_form)


def rate_limit(binding: str) -> Callable[..., Awaitable[None]]:
    """Giới hạn request theo IP bằng binding ratelimits trong wrangler.jsonc."""

    async def check(request: Request, env: Env) -> None:
        ip = request.headers.get("cf-connecting-ip", "unknown")
        outcome = await getattr(env, binding).limit({"key": ip})
        if not outcome["success"]:
            raise ApiError("rate_limited", 429)

    return check


SettingsDep = Annotated[Settings, Depends(get_settings)]
RepositoryDep = Annotated[ScoreRepository, Depends(get_repository)]
HumanVerifierDep = Annotated[HumanVerifier, Depends(get_human_verifier)]
